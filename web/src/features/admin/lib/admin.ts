import type { AdminHouseholdMember, IngestRun } from '@/lib/db-types'

/** Same pattern as admin_add_allowed_email() in 20261021000300_admin.sql. */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normalizeEmail(email))
}

// Server error → Hebrew. Matched by substring, so the PostgREST wrapping and
// the demo's plain messages both work.
const ERRORS: [string, string][] = [
  ['admin only', 'הפעולה זמינה רק עם הרשאת ניהול.'],
  ['permission denied', 'הפעולה זמינה רק עם הרשאת ניהול.'],
  ['cannot remove your own email', 'אי אפשר להסיר את הכתובת שלך.'],
  ['allowlist cannot be empty', 'זו הכתובת האחרונה ברשימה. רשימה ריקה פותחת את ההרשמה לכולם.'],
  ['invalid email', 'הכתובת לא נראית תקינה.'],
  ['cannot delete your own household', 'אי אפשר למחוק את הבית שלך מכאן.'],
  ['cannot remove yourself', 'אי אפשר להסיר את עצמך.'],
  ['cannot delete your own account', 'אי אפשר למחוק את החשבון שלך.'],
  ['cannot delete an admin', 'אי אפשר למחוק חשבון עם הרשאת ניהול.'],
  ['placeholder has history', 'יש רישומים על השם הזה. אפשר למחוק את כל הבית.'],
  ['venue not approved', 'המקום עוד לא אושר. קודם מאשרים אותו.'],
  ['not found', 'לא נמצא, אולי כבר נמחק.'],
]

export function adminErrorMessage(message: string): string {
  return ERRORS.find(([key]) => message.includes(key))?.[1] ?? message
}

/** A household with no real, still existing account in it. */
export function hasActiveMember(members: AdminHouseholdMember[]): boolean {
  return members.some((m) => !m.is_placeholder && m.email != null)
}

export type MemberStatus = 'active' | 'placeholder' | 'deleted'

export function memberStatus(member: AdminHouseholdMember): MemberStatus {
  if (member.is_placeholder) return 'placeholder'
  return member.email == null ? 'deleted' : 'active'
}

export interface IngestProblem {
  chain: string
  /** Branch name (or code); absent when the whole chain failed. */
  store?: string
  error: string
}

export interface IngestSummary {
  storesOk: number
  storesFailed: number
  items: number
  problems: IngestProblem[]
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * ingest_runs.stats, as house_ingest writes it:
 * {chain_id: {stores: {store_code: {name, items, ...} | {name, error}}, error?}}.
 * Tolerates anything else (an empty object, a run that never finished).
 */
export function summarizeIngest(stats: IngestRun['stats'] | null | undefined): IngestSummary {
  const summary: IngestSummary = { storesOk: 0, storesFailed: 0, items: 0, problems: [] }
  if (!isObject(stats)) return summary
  for (const [chain, chainStats] of Object.entries(stats)) {
    if (!isObject(chainStats)) continue
    if (typeof chainStats.error === 'string') summary.problems.push({ chain, error: chainStats.error })
    const stores = isObject(chainStats.stores) ? chainStats.stores : {}
    for (const [code, store] of Object.entries(stores)) {
      if (!isObject(store)) continue
      if (typeof store.error === 'string') {
        summary.storesFailed++
        summary.problems.push({ chain, store: typeof store.name === 'string' ? store.name : code, error: store.error })
      } else {
        summary.storesOk++
        summary.items += Number(store.items) || 0
      }
    }
  }
  return summary
}

export const INGEST_STATUS_LABELS: Record<IngestRun['status'], string> = {
  ok: 'הצליח',
  partial: 'חלקי',
  failed: 'נכשל',
  running: 'רץ עכשיו',
}

// The errors house_ingest writes into stats; anything else is shown as is.
const INGEST_ERRORS: Record<string, string> = {
  'no PriceFull file': 'אין קובץ מחירים',
  'no stores found in city (or Stores file unavailable)': 'לא נמצאו סניפים בעיר, או שקובץ הסניפים לא זמין',
}

export function ingestErrorLabel(error: string): string {
  return INGEST_ERRORS[error] ?? error
}

/** The noun after a count: "1 הוצאה", "3 הוצאות". */
export function countWord(n: number, one: string, many: string): string {
  return n === 1 ? one : many
}

const dateFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })
const dateTimeFormat = new Intl.DateTimeFormat('he-IL', {
  day: 'numeric',
  month: 'numeric',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
})

/** Digits only ("17.10.2026"), so it can sit in a <span className="num">. */
export function formatDate(timestamp: string | null | undefined): string {
  return timestamp ? dateFormat.format(new Date(timestamp)) : '—'
}

export function formatDateTime(timestamp: string | null | undefined): string {
  return timestamp ? dateTimeFormat.format(new Date(timestamp)) : '—'
}
