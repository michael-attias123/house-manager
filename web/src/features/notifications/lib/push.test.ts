import {
  isIOS,
  isStandalone,
  pushSupport,
  sameKey,
  subscriptionToRow,
  urlBase64ToUint8Array,
  type PushEnv,
} from './push'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'

const full: PushEnv = {
  userAgent: ANDROID,
  platform: 'Linux armv81',
  maxTouchPoints: 5,
  standalone: false,
  serviceWorker: true,
  pushManager: true,
  notification: true,
}

describe('push support', () => {
  it('recognises iPhones and iPads, including iPadOS posing as a Mac', () => {
    expect(isIOS({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 })).toBe(true)
    expect(isIOS({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
    expect(isIOS({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(isIOS({ userAgent: ANDROID, platform: 'Linux armv81', maxTouchPoints: 5 })).toBe(false)
  })

  it('needs the Home Screen app on iOS, even where Safari has no PushManager', () => {
    const safariTab = { ...full, userAgent: IPHONE, platform: 'iPhone', pushManager: false }
    expect(pushSupport(safariTab)).toBe('ios-needs-install')
    expect(pushSupport({ ...safariTab, standalone: true, pushManager: true })).toBe('ready')
    // Installed, but older than iOS 16.4.
    expect(pushSupport({ ...safariTab, standalone: true })).toBe('unsupported')
  })

  it('works in an Android or desktop browser tab', () => {
    expect(pushSupport(full)).toBe('ready')
    expect(pushSupport({ ...full, userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(
      'ready',
    )
    expect(pushSupport({ ...full, serviceWorker: false })).toBe('unsupported')
    expect(pushSupport({ ...full, notification: false })).toBe('unsupported')
  })

  it('detects the installed app', () => {
    const win = (standalone: boolean | undefined, media: boolean) => ({
      navigator: { standalone },
      matchMedia: () => ({ matches: media }),
    })
    expect(isStandalone(win(true, false))).toBe(true)
    expect(isStandalone(win(undefined, true))).toBe(true)
    expect(isStandalone(win(false, false))).toBe(false)
    // jsdom and old browsers have no matchMedia.
    expect(isStandalone({ navigator: {} })).toBe(false)
  })
})

describe('subscribing', () => {
  // A real VAPID public key: 65 bytes, uncompressed P-256 point.
  const key =
    'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U'

  it('decodes a base64url VAPID key', () => {
    const bytes = urlBase64ToUint8Array(key)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBe(65)
    expect(bytes[0]).toBe(0x04)
    // "-" and "_" are base64url for "+" and "/"; padding is optional.
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff])
    expect([...urlBase64ToUint8Array(' AQID\n')]).toEqual([1, 2, 3])
  })

  it('tells whether a subscription used the current key', () => {
    const bytes = urlBase64ToUint8Array(key)
    expect(sameKey(bytes.slice().buffer, bytes)).toBe(true)
    const other = bytes.slice()
    other[10] ^= 1
    expect(sameKey(other.buffer, bytes)).toBe(false)
    expect(sameKey(null, bytes)).toBe(false)
    expect(sameKey(new ArrayBuffer(3), bytes)).toBe(false)
  })

  it('turns a PushSubscription into the row the server stores', () => {
    const json = {
      endpoint: 'https://fcm.googleapis.com/fcm/send/abc',
      keys: { p256dh: 'BPk', auth: 'q1w' },
    }
    expect(subscriptionToRow({ toJSON: () => json }, 'x'.repeat(400))).toEqual({
      endpoint: json.endpoint,
      p256dh: 'BPk',
      auth: 'q1w',
      user_agent: 'x'.repeat(300),
    })
    expect(subscriptionToRow(json).user_agent).toBeNull()
    expect(() => subscriptionToRow({ endpoint: json.endpoint, keys: { p256dh: 'BPk' } })).toThrow()
    expect(() => subscriptionToRow({ keys: json.keys })).toThrow()
  })
})
