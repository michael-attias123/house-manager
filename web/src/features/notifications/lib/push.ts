// Web Push in the browser: what this device can do, and the pieces that
// subscribing needs. Pure functions; the browser is passed in for tests.

export type PushSupport = 'unsupported' | 'ios-needs-install' | 'ready'

/** The parts of the browser that decide whether push can work here. */
export interface PushEnv {
  userAgent: string
  platform: string
  maxTouchPoints: number
  /** Opened from the Home Screen icon (an installed PWA), not a browser tab. */
  standalone: boolean
  serviceWorker: boolean
  pushManager: boolean
  notification: boolean
}

interface StandaloneWindow {
  matchMedia?: (query: string) => { matches: boolean }
  navigator: object
}

export function isStandalone(win: StandaloneWindow = window): boolean {
  try {
    // navigator.standalone: Safari on iOS; display-mode: everyone else.
    const { standalone } = win.navigator as { standalone?: boolean }
    return standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true
  } catch {
    return false
  }
}

/** iPhone, iPod or iPad. iPadOS reports itself as a Mac, but one with touch. */
export function isIOS(env: Pick<PushEnv, 'userAgent' | 'platform' | 'maxTouchPoints'>): boolean {
  return (
    /iPhone|iPad|iPod/.test(env.userAgent) ||
    (env.platform === 'MacIntel' && env.maxTouchPoints > 1)
  )
}

export function browserPushEnv(): PushEnv {
  return {
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints ?? 0,
    standalone: isStandalone(),
    serviceWorker: 'serviceWorker' in navigator,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
  }
}

/**
 * On iPhone, push exists only in the app opened from the Home Screen (iOS
 * 16.4+); a Safari tab has no PushManager at all, so it gets install
 * instructions rather than "unsupported".
 */
export function pushSupport(env: PushEnv = browserPushEnv()): PushSupport {
  if (isIOS(env) && !env.standalone) return 'ios-needs-install'
  if (!env.serviceWorker || !env.pushManager || !env.notification) return 'unsupported'
  return 'ready'
}

/** The VAPID public key (base64url, as web-push prints it) as applicationServerKey. */
export function urlBase64ToUint8Array(base64url: string): Uint8Array<ArrayBuffer> {
  const trimmed = base64url.trim()
  const base64 = (trimmed + '='.repeat((4 - (trimmed.length % 4)) % 4))
    .replace(/-/g, '+')
    .replace(/_/g, '/')
  const raw = atob(base64)
  const bytes = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i)
  return bytes
}

/** Whether an existing subscription was made with this key (it changes if the VAPID keys are replaced). */
export function sameKey(current: ArrayBuffer | null | undefined, key: Uint8Array): boolean {
  if (!current || current.byteLength !== key.length) return false
  const bytes = new Uint8Array(current)
  return bytes.every((b, i) => b === key[i])
}

/** What save_push_subscription() takes. */
export interface PushSubscriptionInput {
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
}

export function subscriptionToRow(
  subscription: PushSubscriptionJSON | { toJSON(): PushSubscriptionJSON },
  userAgent: string | null = null,
): PushSubscriptionInput {
  const json = 'toJSON' in subscription ? subscription.toJSON() : subscription
  const { endpoint, keys } = json
  if (!endpoint || !keys?.p256dh || !keys?.auth)
    throw new Error('הדפדפן לא החזיר את פרטי ההרשמה להתראות')
  return {
    endpoint,
    p256dh: keys.p256dh,
    auth: keys.auth,
    user_agent: userAgent ? userAgent.slice(0, 300) : null,
  }
}
