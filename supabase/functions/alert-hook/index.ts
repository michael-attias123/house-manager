// Turns Grafana alerts into admin push notifications: the app-push contact
// point (infra/, observability/alerting/policies.yaml) posts here, and each
// alert is queued for the admins by notify_admins_from_alert()
// (supabase/migrations/20261107000100_alert_notify.sql), with the usual admin
// pref and quiet hours. Email is the other, immediate channel.
//
// Deployed with --no-verify-jwt: Grafana has no Supabase JWT, so the HMAC
// signature (verify.ts) is the only check.
//
// Secrets: ALERT_WEBHOOK_SECRET (infra/, the secrets module). Without it the
// function answers 503. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'
import { verify } from './verify.ts'

/** The fields of Grafana's webhook payload that are used. */
interface GrafanaAlert {
  status?: string
  fingerprint?: string
  startsAt?: string
  labels?: Record<string, string>
  annotations?: Record<string, string>
}

/** The contact point sends at most 10 alerts per call (max_alerts). */
const MAX_ALERTS = 10
const MAX_BODY_CHARS = 256 * 1024

interface AlertNotification {
  title: string
  body: string
  dedup: string
}

/**
 * The notification for one alert, or null if the alert is malformed. One per
 * firing episode and one when it is resolved: the dedup key has the
 * fingerprint, the start time and the status.
 */
function toNotification(alert: GrafanaAlert): AlertNotification | null {
  const status = alert.status === 'resolved' ? 'resolved' : alert.status === 'firing' ? 'firing' : null
  const fingerprint = typeof alert.fingerprint === 'string' && /^[A-Za-z0-9]{1,64}$/.test(alert.fingerprint)
    ? alert.fingerprint
    : null
  const started = typeof alert.startsAt === 'string' ? new Date(alert.startsAt) : null
  if (!status || !fingerprint || !started || Number.isNaN(started.getTime())) return null

  const summary = (alert.annotations?.summary_he ?? '').trim() || (alert.labels?.alertname ?? '').trim() || 'התראת ניטור'
  return status === 'firing'
    ? { title: summary.slice(0, 100), body: 'הפרטים נשלחו במייל', dedup: `alert:${fingerprint}:${started.toISOString()}:firing` }
    : {
      title: `נפתר: ${summary}`.slice(0, 100),
      body: 'ההתראה נסגרה',
      dedup: `alert:${fingerprint}:${started.toISOString()}:resolved`,
    }
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 })
  const secret = Deno.env.get('ALERT_WEBHOOK_SECRET')
  if (!secret) return new Response('not configured', { status: 503 })

  const body = await req.text()
  if (body.length > MAX_BODY_CHARS) return new Response('too large', { status: 413 })
  const verdict = await verify({
    secret,
    timestamp: req.headers.get('x-grafana-alerting-timestamp'),
    signature: req.headers.get('x-grafana-alerting-signature'),
    body,
  })
  if (verdict !== 'ok') return new Response('unauthorized', { status: 401 })

  let alerts: GrafanaAlert[]
  try {
    const payload = JSON.parse(body) as { alerts?: unknown }
    alerts = Array.isArray(payload.alerts) ? (payload.alerts as GrafanaAlert[]).slice(0, MAX_ALERTS) : []
  } catch {
    return new Response('bad payload', { status: 400 })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!url || !key) throw new Error('missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

    let queued = 0
    let skipped = 0
    for (const alert of alerts) {
      const n = alert && typeof alert === 'object' ? toNotification(alert) : null
      if (!n) {
        skipped++
        continue
      }
      const { data, error } = await db.rpc('notify_admins_from_alert', {
        p_title: n.title,
        p_body: n.body,
        p_dedup: n.dedup,
      })
      if (error) throw new Error(`notify_admins_from_alert: ${error.code ?? 'error'}`)
      queued += Number(data ?? 0)
    }
    // Counts only: the payload holds alert text and is never logged.
    console.log(`alert-hook: ${alerts.length} alerts, ${queued} notifications queued, ${skipped} skipped`)
    return Response.json({ alerts: alerts.length, queued, skipped })
  } catch (error) {
    console.error('alert-hook failed:', error instanceof Error ? error.message : 'unknown error')
    // A 5xx makes Grafana retry the call.
    return Response.json({ error: 'failed' }, { status: 500 })
  }
})
