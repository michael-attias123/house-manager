// The Google sign-in comes back to `/?code=…` (PKCE). supabase-js exchanges the
// code only if this browser's storage still holds the verifier saved when the
// sign-in started; when it does not (the redirect landed in Safari instead of
// the home-screen app, storage is blocked, ...) it skips the URL silently and
// the login page simply reappears. These helpers name what went wrong.

export type AuthCallback =
  | { kind: 'code' }
  | { kind: 'error'; code: string; description: string }
  // Implicit-flow tokens: a sign-in started by an older cached build.
  | { kind: 'tokens' }

const AUTH_PARAMS = ['code', 'error', 'error_code', 'error_description', 'sb', 'sb_flow_id']

function urlParams(url: URL): URLSearchParams {
  // supabase-js reads both; query parameters win over the fragment.
  const params = new URLSearchParams(url.hash.slice(1))
  url.searchParams.forEach((value, key) => params.set(key, value))
  return params
}

export function readAuthCallback(href: string): AuthCallback | null {
  const params = urlParams(new URL(href))
  const error = params.get('error') ?? params.get('error_code')
  if (error || params.get('error_description')) {
    return {
      kind: 'error',
      code: params.get('error_code') ?? error ?? 'unknown',
      description: params.get('error_description') ?? '',
    }
  }
  if (params.get('code')) return { kind: 'code' }
  if (params.get('access_token')) return { kind: 'tokens' }
  return null
}

/** The URL without the sign-in parameters, so a refresh does not replay them. */
export function withoutAuthParams(href: string): string {
  const url = new URL(href)
  for (const key of AUTH_PARAMS) url.searchParams.delete(key)
  url.hash = ''
  return url.pathname + url.search
}

export interface SignInFailure {
  message: string
  /** Short technical tag shown under the message, for reporting the problem. */
  detail: string
}

interface InitError {
  name?: string
  code?: string
  message: string
}

interface Environment {
  storageWritable: boolean
  standalone: boolean
}

export function diagnoseSignIn(
  callback: AuthCallback,
  initError: InitError | null,
  env: Environment,
): SignInFailure {
  const where = env.standalone ? 'home-screen app' : 'browser'
  const tag = (reason: string) => `${reason} · ${where}`

  if (callback.kind === 'error') {
    // The allowed_emails trigger refused the new account; Supabase Auth
    // reports it as a generic database error.
    if (/database error saving new user|email not allowed/i.test(callback.description)) {
      return {
        message: 'הכתובת הזו לא מורשית להיכנס לאפליקציה. אפשר לבקש מבעלי הבית להוסיף אותה.',
        detail: tag('not on allowed_emails'),
      }
    }
    if (callback.code === 'access_denied') {
      return { message: 'הכניסה בוטלה במסך של Google. אפשר לנסות שוב.', detail: tag(callback.code) }
    }
    return {
      message: 'Google או Supabase החזירו שגיאה, והכניסה לא הושלמה.',
      detail: tag(`${callback.code}: ${callback.description}`),
    }
  }

  if (callback.kind === 'tokens') {
    return {
      message: 'הכניסה התחילה בגרסה קודמת של האפליקציה, שהתעדכנה בינתיים. נסו שוב.',
      detail: tag('implicit tokens'),
    }
  }

  if (initError) {
    switch (initError.code) {
      case 'flow_state_expired':
        return {
          message: 'עברו יותר מ-5 דקות מהלחיצה על הכניסה ועד החזרה מ-Google. נסו שוב.',
          detail: tag(initError.code),
        }
      case 'flow_state_not_found':
        return { message: 'קוד הכניסה כבר נוצל או שפג תוקפו. נסו שוב.', detail: tag(initError.code) }
    }
    if (initError.name === 'AuthRetryableFetchError') {
      return {
        message: 'לא הצלחנו להגיע לשרת כדי להשלים את הכניסה. כדאי לבדוק את החיבור ולנסות שוב.',
        detail: tag(initError.message),
      }
    }
    return {
      message: 'הכניסה לא הושלמה.',
      detail: tag(`${initError.code ?? initError.name ?? 'error'}: ${initError.message}`),
    }
  }

  // A code but no exchange attempt: the verifier is not in this storage.
  if (!env.storageWritable) {
    return {
      message:
        'הדפדפן חוסם שמירת נתונים באתר, ובלי זה אי אפשר להשלים את הכניסה. באייפון זה קורה כשההגדרה „חסימת כל העוגיות” של ספארי פעילה.',
      detail: tag('storage blocked'),
    }
  }
  return {
    message:
      'החזרה מ-Google הגיעה לחלון אחר מזה שבו הכניסה התחילה, ולכן היא לא הושלמה. באייפון זה קורה כשמתחילים מהאייקון במסך הבית או מתוך אפליקציה אחרת. נסו שוב מהחלון הזה.',
    detail: tag('no code verifier'),
  }
}

// In-app browsers built on an embedded web view, which Google refuses to sign
// in from ("Error 403: disallowed_useragent").
const EMBEDDED_BROWSER = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|\bLine\/|Snapchat|musical_ly|BytedanceWebview|MicroMessenger/i

export function isEmbeddedBrowser(userAgent: string): boolean {
  return EMBEDDED_BROWSER.test(userAgent)
}
