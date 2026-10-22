// Delivers due rows of public.notification_outbox as Web Push messages
// (supabase/migrations/20261022000100_notifications.sql).
//
// Called by the database (request_push_send(), through pg_net) after every
// insert into the outbox and every 10 minutes, with the x-push-secret
// header. Deployed with --no-verify-jwt, so that header is the only check.
//
// Secrets (supabase secrets set ..., docs/setup.md): PUSH_SECRET,
// VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT. SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
// @deno-types="npm:@types/web-push@3.6.4"
import webpush from 'npm:web-push@3.6.7'

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

/** Sends one notification to each of the user's devices. */
async function deliver(n: Claimed, delivered: Set<string>, gone: Set<string>): Promise<Result> {
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
  let retry = false
  outcomes.forEach((outcome, i) => {
    const endpoint = n.subscriptions[i].endpoint
    if (outcome.status === 'fulfilled') {
      delivered.add(endpoint)
      return
    }
    const status = statusOf(outcome.reason)
    // The browser unsubscribed or the app was removed: forget the device.
    if (status === 404 || status === 410) gone.add(endpoint)
    else retry = true
    errors.push(describe(outcome.reason))
  })
  const sentSomewhere = outcomes.some((o) => o.status === 'fulfilled')
  return {
    id: n.id,
    // Not retried once a device got it, so no device sees it twice.
    ok: sentSomewhere || !retry,
    error: errors.length ? errors.join('; ').slice(0, 500) : undefined,
  }
}

Deno.serve(async (req) => {
  const secret = Deno.env.get('PUSH_SECRET')
  if (!secret || !(await sameSecret(req.headers.get('x-push-secret') ?? '', secret))) {
    return new Response('unauthorized', { status: 401 })
  }

  try {
    webpush.setVapidDetails(env('VAPID_SUBJECT'), env('VAPID_PUBLIC_KEY'), env('VAPID_PRIVATE_KEY'))
    const db = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    let sent = 0
    let failed = 0
    for (let i = 0; i < MAX_BATCHES; i++) {
      const { data, error } = await db.rpc('claim_push_batch', { p_limit: BATCH })
      if (error) throw new Error(`claim_push_batch: ${error.message}`)
      const batch = (data ?? []) as Claimed[]
      if (batch.length === 0) break

      const delivered = new Set<string>()
      const gone = new Set<string>()
      const results = await Promise.all(batch.map((n) => deliver(n, delivered, gone)))
      const finish = await db.rpc('finish_push_batch', {
        p_results: results,
        p_delivered: [...delivered],
        p_gone: [...gone],
      })
      if (finish.error) throw new Error(`finish_push_batch: ${finish.error.message}`)

      sent += results.filter((r) => r.ok).length
      failed += results.filter((r) => !r.ok).length
      if (batch.length < BATCH) break
    }
    console.log(`send-push: ${sent} done, ${failed} to retry`)
    return Response.json({ sent, failed })
  } catch (error) {
    console.error('send-push failed:', error)
    return Response.json({ error: describe(error) }, { status: 500 })
  }
})
