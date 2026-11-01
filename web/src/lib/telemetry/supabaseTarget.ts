// What a Supabase request was for, without anything it carried: PostgREST
// puts filter values (ids, item names) in the query string, so only the table,
// function or auth endpoint is kept. Spans are named after it.

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/

function clean(segment: string | undefined): string | null {
  if (!segment) return null
  let name: string
  try {
    name = decodeURIComponent(segment)
  } catch {
    return null
  }
  return NAME.test(name) && name.length <= 63 ? name : null
}

/**
 * `rest:<table>`, `rpc:<fn>` or `auth:<endpoint>` for a Supabase Data API or
 * Auth URL, null for anything else. With `base` (the project URL), the
 * request must also go to that project.
 */
export function supabaseTarget(url: string, base?: string): string | null {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (base) {
    try {
      if (u.origin !== new URL(base).origin) return null
    } catch {
      return null
    }
  }
  const [, area, version, first, second] = u.pathname.split('/')
  if (version !== 'v1') return null
  if (area === 'rest') {
    if (first === 'rpc') {
      const fn = clean(second)
      return fn && `rpc:${fn}`
    }
    const table = clean(first)
    return table && `rest:${table}`
  }
  if (area === 'auth') {
    const endpoint = clean(first)
    return endpoint && `auth:${endpoint}`
  }
  return null
}
