// Checks Grafana's webhook HMAC (the app-push contact point, infra/):
// X-Grafana-Alerting-Signature is the hex HMAC-SHA256, keyed with
// ALERT_WEBHOOK_SECRET, of `${timestamp}:${body}`, where timestamp is the
// X-Grafana-Alerting-Timestamp header. Grafana's docs do not say whether the
// timestamp is in seconds or milliseconds, so both are accepted.

/** How far the timestamp may be from now, either way. */
export const MAX_SKEW_MS = 5 * 60 * 1000

export type Verdict = 'ok' | 'missing' | 'stale' | 'bad-signature'

/**
 * The timestamp header in milliseconds, or null if it is not a number.
 * Below 1e12 it is read as seconds: 1e12 ms is in 2001, 1e12 s is 30,000
 * years away.
 */
export function timestampMs(raw: string): number | null {
  if (!/^\d{1,16}$/.test(raw)) return null
  const n = Number(raw)
  return n < 1e12 ? n * 1000 : n
}

/** Hex to bytes, or null if it is not an even run of hex digits. */
export function fromHex(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-fA-F]+$/.test(hex)) return null
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Equal bytes, in time that depends only on the length of `expected`: every
 * byte is compared, and a length difference is folded into the result
 * instead of returning early.
 */
export function timingSafeEqual(given: ArrayLike<number>, expected: ArrayLike<number>): boolean {
  let diff = given.length ^ expected.length
  for (let i = 0; i < expected.length; i++) {
    diff |= (i < given.length ? given[i] : 0) ^ expected[i]
  }
  return diff === 0
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ])
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)))
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

export interface SignedRequest {
  secret: string
  timestamp: string | null
  signature: string | null
  body: string
  /** Defaults to Date.now(); tests pass a fixed time. */
  nowMs?: number
}

/** Whether a webhook call really comes from our Grafana, and is recent. */
export async function verify(req: SignedRequest): Promise<Verdict> {
  if (!req.secret || !req.timestamp || !req.signature) return 'missing'
  const timestamp = req.timestamp.trim()
  const ts = timestampMs(timestamp)
  if (ts === null || Math.abs((req.nowMs ?? Date.now()) - ts) > MAX_SKEW_MS) return 'stale'
  const expected = await hmacSha256(req.secret, `${timestamp}:${req.body}`)
  const given = fromHex(req.signature.trim().replace(/^sha256=/i, '')) ?? new Uint8Array(0)
  return timingSafeEqual(given, expected) ? 'ok' : 'bad-signature'
}
