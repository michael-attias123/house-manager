// The events the app reports itself, and the only attributes each may carry.
// Values are fixed enums or codes, never user data; sanitize.ts drops any
// other event or attribute. No Faro imports here: the demo stub uses the types.

export const APP_EVENTS = {
  /** A realtime channel status other than SUBSCRIBED. Never the topic (it holds the household id). */
  realtime_status: ['status', 'table'],
  /** A sign-in that did not complete: the error code only. */
  sign_in_failed: ['code'],
} as const

export type AppEventName = keyof typeof APP_EVENTS
export type AppEventAttributes<N extends AppEventName> = Record<
  (typeof APP_EVENTS)[N][number],
  string
>

export function appEventAttributes(name: string): readonly string[] | undefined {
  return Object.hasOwn(APP_EVENTS, name) ? APP_EVENTS[name as AppEventName] : undefined
}

/** Where reportError was called from. */
export type ErrorSource = 'error_boundary' | 'route_error'
