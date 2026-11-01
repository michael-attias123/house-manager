// deno test supabase/functions/alert-hook
import { assert, assertEquals } from 'jsr:@std/assert@1.0.19'
import { fromHex, hmacSha256, MAX_SKEW_MS, timestampMs, timingSafeEqual, toHex, verify } from './verify.ts'

const SECRET = 'test-secret-that-is-at-least-32-characters'
const BODY = '{"status":"firing","alerts":[{"status":"firing","fingerprint":"3f2a1b0c9d8e7f60"}]}'
const NOW_MS = Date.UTC(2026, 10, 1, 10, 0, 0)
const NOW_S = String(Math.floor(NOW_MS / 1000))

async function sign(timestamp: string, body = BODY, secret = SECRET): Promise<string> {
  return toHex(await hmacSha256(secret, `${timestamp}:${body}`))
}

Deno.test('the HMAC is the standard one (RFC 4231 test case 2)', async () => {
  assertEquals(
    toHex(await hmacSha256('Jefe', 'what do ya want for nothing?')),
    '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
  )
})

Deno.test('a good signature passes', async () => {
  const signature = await sign(NOW_S)
  assertEquals(await verify({ secret: SECRET, timestamp: NOW_S, signature, body: BODY, nowMs: NOW_MS }), 'ok')
  // Upper-case hex and a sha256= prefix are the same signature.
  assertEquals(
    await verify({ secret: SECRET, timestamp: NOW_S, signature: `sha256=${signature.toUpperCase()}`, body: BODY, nowMs: NOW_MS }),
    'ok',
  )
})

Deno.test('a bad signature fails', async () => {
  const signature = await sign(NOW_S)
  const check = (over: { signature?: string; body?: string; secret?: string; timestamp?: string }) =>
    verify({ secret: SECRET, timestamp: NOW_S, signature, body: BODY, nowMs: NOW_MS, ...over })
  assertEquals(await check({ body: BODY.replace('firing', 'resolved') }), 'bad-signature')
  assertEquals(await check({ secret: `${SECRET}x` }), 'bad-signature')
  assertEquals(await check({ signature: await sign(NOW_S, BODY, 'another-secret') }), 'bad-signature')
  // Signed over the body alone, without the timestamp.
  assertEquals(await check({ signature: toHex(await hmacSha256(SECRET, BODY)) }), 'bad-signature')
  // Another timestamp, still fresh, with the old signature.
  assertEquals(await check({ timestamp: String(Number(NOW_S) + 1) }), 'bad-signature')
  assertEquals(await check({ signature: signature.slice(0, -2) }), 'bad-signature')
  assertEquals(await check({ signature: `${signature}00` }), 'bad-signature')
  assertEquals(await check({ signature: 'not hex at all' }), 'bad-signature')
  assertEquals(await check({ signature: '' }), 'missing')
  assertEquals(await check({ secret: '' }), 'missing')
  assertEquals(await verify({ secret: SECRET, timestamp: null, signature, body: BODY, nowMs: NOW_MS }), 'missing')
})

Deno.test('a stale or future timestamp fails, even when correctly signed', async () => {
  for (const offsetMs of [-MAX_SKEW_MS - 1000, MAX_SKEW_MS + 1000, -24 * 60 * 60 * 1000]) {
    const ts = String(Math.floor((NOW_MS + offsetMs) / 1000))
    assertEquals(
      await verify({ secret: SECRET, timestamp: ts, signature: await sign(ts), body: BODY, nowMs: NOW_MS }),
      'stale',
      `offset ${offsetMs} ms`,
    )
  }
  for (const ts of ['', 'abc', '-1', '1.5', '17300000000000000000']) {
    assertEquals(
      await verify({ secret: SECRET, timestamp: ts || ' ', signature: await sign(ts), body: BODY, nowMs: NOW_MS }),
      'stale',
      `timestamp "${ts}"`,
    )
  }
  // Within the window, either way.
  const ts = String(Math.floor((NOW_MS - MAX_SKEW_MS + 5000) / 1000))
  assertEquals(await verify({ secret: SECRET, timestamp: ts, signature: await sign(ts), body: BODY, nowMs: NOW_MS }), 'ok')
})

Deno.test('the timestamp may be in seconds or milliseconds', async () => {
  assertEquals(timestampMs(NOW_S), NOW_MS)
  assertEquals(timestampMs(String(NOW_MS)), NOW_MS)
  assertEquals(timestampMs('x'), null)
  const ms = String(NOW_MS - 2000)
  assertEquals(await verify({ secret: SECRET, timestamp: ms, signature: await sign(ms), body: BODY, nowMs: NOW_MS }), 'ok')
  // Milliseconds read as seconds would be far in the future, and the reverse
  // far in the past: a stale one in milliseconds is still caught.
  const oldMs = String(NOW_MS - MAX_SKEW_MS - 1000)
  assertEquals(
    await verify({ secret: SECRET, timestamp: oldMs, signature: await sign(oldMs), body: BODY, nowMs: NOW_MS }),
    'stale',
  )
})

Deno.test('hex decoding', () => {
  assertEquals(fromHex('00ff10'), new Uint8Array([0, 255, 16]))
  assertEquals(fromHex('0'), null)
  assertEquals(fromHex('zz'), null)
  assertEquals(fromHex(''), null)
})

/** An array that counts reads of its elements. */
function counted(values: number[]): { bytes: ArrayLike<number>; reads: () => number } {
  let reads = 0
  const bytes = new Proxy(values, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) reads++
      return Reflect.get(target, prop, receiver)
    },
  })
  return { bytes, reads: () => reads }
}

Deno.test('the comparison is constant-time: every byte is read wherever the first difference is', () => {
  const expected = Array.from({ length: 32 }, (_, i) => (i * 37 + 11) % 256)
  const cases: [string, number[], boolean][] = [
    ['equal', [...expected], true],
    ['first byte differs', [expected[0] ^ 1, ...expected.slice(1)], false],
    ['last byte differs', [...expected.slice(0, 31), expected[31] ^ 1], false],
    ['every byte differs', expected.map((b) => b ^ 0xff), false],
    ['shorter', expected.slice(0, 31), false],
    ['longer', [...expected, 0], false],
    ['empty', [], false],
  ]
  for (const [name, given, same] of cases) {
    const e = counted(expected)
    const g = counted(given)
    assertEquals(timingSafeEqual(g.bytes, e.bytes), same, name)
    // The work depends only on the expected length, never on the content.
    assertEquals(e.reads(), expected.length, `${name}: expected bytes read`)
    assert(g.reads() === Math.min(given.length, expected.length), `${name}: given bytes read ${g.reads()}`)
  }
})
