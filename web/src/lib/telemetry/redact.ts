// Free text that leaves the browser (error messages, paths) goes through
// here first. Telemetry is an allow-list: callers send known fields only, and
// whatever free text remains is stripped of anything that could name a person,
// a household or what they bought.

export const MAX_LENGTH = 200

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const URL_LIKE = /\b(?:https?|wss?):\/\/[^\s"'<>()[\]{}]+/gi
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
// Postgres quotes values ("…", '…'); people write “…” and „…”.
const QUOTED = /"[^"]*"|'[^']*'|“[^”]*”|„[^”“]*[”“]|«[^»]*»/g
// Postgres `details`: Key (household_id, name)=(…, חלב) already exists.
const PARENTHESISED = /\([^()]*\)/g
// One or more Hebrew words, with the spaces and marks between them.
const HEBREW = /[֐-׿יִ-ﭏ]+(?:[\s\-־׳״'"]+[֐-׿יִ-ﭏ]+)*/g
const NUMBER = /\b\d{2,}\b/g

function decode(path: string): string {
  try {
    return decodeURIComponent(path)
  } catch {
    return path
  }
}

/** Origin and path only: no query string (PostgREST filters, `?code=`) and no hash. */
export function stripUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.protocol === 'blob:' || u.protocol === 'data:') return `${u.protocol}[url]`
    return u.origin + decode(u.pathname)
  } catch {
    return '[url]'
  }
}

function redactText(text: string): string {
  return text
    .replace(EMAIL, '[email]')
    .replace(UUID, '[id]')
    .replace(QUOTED, '[str]')
    .replace(PARENTHESISED, '[str]')
    .replace(HEBREW, '[he]')
    .replace(NUMBER, '[n]')
}

/** Free text, made safe to send. */
export function redact(value: unknown): string {
  const text = typeof value === 'string' ? value : value == null ? '' : String(value)
  // URLs first: their query strings go, and their paths are then redacted like
  // any other text (the origin is kept as is).
  let out = ''
  let last = 0
  for (const match of text.matchAll(URL_LIKE)) {
    out += redactText(text.slice(last, match.index))
    const stripped = stripUrl(match[0])
    const slash = stripped.indexOf('/', stripped.indexOf('//') + 2)
    out += slash < 0 ? stripped : stripped.slice(0, slash) + redactText(stripped.slice(slash))
    last = match.index + match[0].length
  }
  out += redactText(text.slice(last))
  return out.length > MAX_LENGTH ? out.slice(0, MAX_LENGTH - 1) + '…' : out
}

/** A URL reduced to origin + redacted path (stack frames, span URLs, the page). */
export function redactUrl(url: string): string {
  return redact(stripUrl(url))
}
