// When Supabase Auth rejects a Google sign-in it redirects back to the app
// with the error in the query string and again in the hash: error,
// error_code, error_description (plus an empty `sb` marker in the hash).
const ERROR_PARAMS = ['error', 'error_code', 'error_description']

export interface AuthRedirectError {
  description: string
  /** The sign-up was refused by the allowed_emails trigger. */
  notAllowed: boolean
  /** The same URL without the error params. */
  cleanUrl: string
}

export function readAuthRedirectError(href: string): AuthRedirectError | null {
  const url = new URL(href)
  const hash = new URLSearchParams(url.hash.slice(1))
  const hasError = (p: URLSearchParams) => ERROR_PARAMS.some((k) => p.has(k))
  const inQuery = hasError(url.searchParams)
  const inHash = hasError(hash)
  if (!inQuery && !inHash) return null

  const params = inQuery ? url.searchParams : hash
  const description =
    params.get('error_description') || params.get('error') || params.get('error_code') || ''

  for (const k of ERROR_PARAMS) url.searchParams.delete(k)
  if (inHash) {
    for (const k of [...ERROR_PARAMS, 'sb']) hash.delete(k)
    url.hash = hash.toString()
  }

  return {
    description,
    // The trigger's exception reaches the app as a generic database error.
    notAllowed: /database error saving new user|email not allowed/i.test(description),
    cleanUrl: url.toString(),
  }
}
