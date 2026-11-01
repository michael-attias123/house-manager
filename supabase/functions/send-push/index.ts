// Delivers due rows of public.notification_outbox as Web Push messages
// (supabase/migrations/20261022000100_notifications.sql).
//
// Called by the database (request_push_send(), through pg_net) after every
// insert into the outbox and every 10 minutes, with the x-push-secret
// header. Deployed with --no-verify-jwt, so that header is the only check.
//
// Secrets (supabase secrets set ..., docs/setup.md): PUSH_SECRET,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. OTLP_ENDPOINT and
// OTLP_BASIC_AUTH (optional) turn on spans (../_shared/otel.ts).
//
// Spans: send-push.run (batches, done, retry, gone; linked to the traces
// that queued the notifications), claim_push_batch, finish_push_batch, and
// deliver per notification (devices, push service hosts, status codes).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'
import { flush, getTracer, inSpan, linkFromTraceparent, markError, type Span, startSpan } from '../_shared/otel.ts'

interface Subscription {
  endpoint: string
  p256dh: string
  auth: string
}

interface Claimed {
  id: number
  title: string
  body: string
  url: string
  tag: string
  /** The W3C traceparent of the request that queued it (ids only), if any. */
  trace_parent?: string | null
  subscriptions: Subscription[]
}

interface Result {
  id: number
  /** Done: delivered to at least one device, or no device left to try. Otherwise retried. */
  ok: boolean
  error?: string
}

const BATCH = 100
const MAX_BATCHES = 5

const tracer = getTracer('send-push')

function env(name: string): string {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`missing secret ${name}`)
  return value
}

/** Compares without leaking the secret's length or contents through timing. */
async function sameSecret(given: string, expected: string): Promise<boolean> {
  const digest = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
  const [a, b] = await Promise.all([digest(given), digest(expected)])
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]
  return diff === 0
}

function statusOf(error: unknown): number | undefined {
  return typeof error === 'object' && error !== null && 'statusCode' in error
    ? Number((error as { statusCode: unknown }).statusCode)
    : undefined
}

function describe(error: unknown): string {
  const status = statusOf(error)
  const message = error instanceof Error ? error.message : String(error)
  return status ? `${status} ${message}` : message
}

/** The push service (fcm.googleapis.com, web.push.apple.com, ...). The rest of the endpoint identifies the device. */
function hostOf(endpoint: string): string {
  try {
    return new URL(endpoint).host
  } catch {
    return 'invalid'
  }
}

/** Sends one notification to each of the user's devices. */
async function deliver(n: Claimed, delivered: Set<string>, gone: Set<string>, parent: Span): Promise<Result> {
  const span = startSpan(tracer, 'deliver', { 'push.devices': n.subscriptions.length }, parent)
  try {
    if (n.subscriptions.length === 0) return { id: n.id, ok: true, error: 'no device' }
    const payload = JSON.stringify({ title: n.title, body: n.body, url: n.url, tag: n.tag })
    const outcomes = await Promise.allSettled(
      n.subscriptions.map((s) =>
        webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          // A phone that is off for the night still gets it in the morning.
          TTL: 24 * 60 * 60,
          urgency: 'normal',
        }),
      ),
    )
    const errors: string[] = []
    const hosts: string[] = []
    const codes: number[] = []
    let retry = false
    outcomes.forEach((outcome, i) => {
      const endpoint = n.subscriptions[i].endpoint
      hosts.push(hostOf(endpoint))
      if (outcome.status === 'fulfilled') {
        codes.push(outcome.value.statusCode)
        delivered.add(endpoint)
        return
      }
      const status = statusOf(outcome.reason)
      // 0: no HTTP answer (network error, timeout).
      codes.push(status ?? 0)
      // The browser unsubscribed or the app was removed: forget the device.
      if (status === 404 || status === 410) gone.add(endpoint)
      else retry = true
      errors.push(describe(outcome.reason))
    })
    const sentSomewhere = outcomes.some((o) => o.status === 'fulfilled')
    const result: Result = {
      id: n.id,
      // Not retried once a device got it, so no device sees it twice.
      ok: sentSomewhere || !retry,
      error: errors.length ? errors.join('; ').slice(0, 500) : undefined,
    }
    span.setAttributes({
      'push.hosts': [...new Set(hosts)].sort(),
      'push.status_codes': codes,
      // "<host> <status>" per device, for status codes by host.
      'push.outcomes': hosts.map((host, i) => `${host} ${codes[i]}`),
      'push.ok': result.ok,
    })
    return result
  } finally {
    span.end()
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_SECRET')
  if (!secret || !(await sameSecret(req.headers.get('x-push-secret') ?? '', secret))) {
    // No span: the uptime check calls without the secret every 15 minutes.
    return new Response('unauthorized', { status: 401 })
  }

  const run = startSpan(tracer, 'send-push.run')
  let batches = 0
  let sent = 0
  let failed = 0
  let goneCount = 0
  const linked = new Set<string>()
  try {
    webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    for (let i = 0; i < MAX_BATCHES; i++) {
      const batch = await inSpan(tracer, 'claim_push_batch', run, async (span) => {
        const { data, error } = await db.rpc('claim_push_batch', { p_limit: BATCH })
        if (error) throw new Error(`claim_push_batch: ${error.message}`)
        const claimed = (data ?? []) as Claimed[]
        span.setAttribute('push.claimed', claimed.length)
        return claimed
      })
      if (batch.length === 0) break
      batches++

      // Links to the traces that queued these notifications (a partner's
      // save in the browser), each once.
      for (const n of batch) {
        const link = n.trace_parent && !linked.has(n.trace_parent) ? linkFromTraceparent(n.trace_parent) : null
        if (link && n.trace_parent) {
          linked.add(n.trace_parent)
          run.addLink(link)
        }
      }

      const delivered = new Set<string>()
      const gone = new Set<string>()
      const results = await Promise.all(batch.map((n) => deliver(n, delivered, gone, run)))
      await inSpan(tracer, 'finish_push_batch', run, async (span) => {
        span.setAttributes({ 'push.results': results.length, 'push.delivered': delivered.size, 'push.gone': gone.size })
        const finish = await db.rpc('finish_push_batch', {
          p_results: results,
          p_delivered: [...delivered],
          p_gone: [...gone],
        })
        if (finish.error) throw new Error(`finish_push_batch: ${finish.error.message}`)
      })

      sent += results.filter((r) => r.ok).length
      failed += results.filter((r) => !r.ok).length
      goneCount += gone.size
      if (batch.length < BATCH) break
    }
    console.log(`send-push: ${sent} done, ${failed} to retry`)
    return Response.json({ sent, failed })
  } catch (error) {
    markError(run, error)
    console.error('send-push failed:', error)
    return Response.json({ error: describe(error) }, { status: 500 })
  } finally {
    run.setAttributes({ 'push.batches': batches, 'push.done': sent, 'push.retry': failed, 'push.gone': goneCount })
    run.end()
    flush()
  }
})
