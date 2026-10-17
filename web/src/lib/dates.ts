/** Dates are ISO calendar days ("2026-10-17") in the device's local time zone. */
export type ISODate = string

export function toISO(d: Date): ISODate {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function parseISO(s: ISODate): Date {
  const [y, m, d] = s.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function todayISO(now: Date = new Date()): ISODate {
  return toISO(now)
}

export function addDays(s: ISODate, days: number): ISODate {
  const d = parseISO(s)
  d.setDate(d.getDate() + days)
  return toISO(d)
}

/** Adds months, clamping to the last day of shorter months (Jan 31 + 1 → Feb 28). */
export function addMonths(s: ISODate, months: number): ISODate {
  const d = parseISO(s)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + months)
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, lastDay))
  return toISO(d)
}

export function diffDays(a: ISODate, b: ISODate): number {
  return Math.round((parseISO(a).getTime() - parseISO(b).getTime()) / 86_400_000)
}

export function weekday(s: ISODate): number {
  return parseISO(s).getDay()
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a > b ? a : b
}

export function monthKey(s: ISODate): string {
  return s.slice(0, 7)
}

export function startOfMonth(s: ISODate): ISODate {
  return `${s.slice(0, 7)}-01`
}

const dayFormatter = new Intl.DateTimeFormat('he-IL', { weekday: 'short', day: 'numeric', month: 'short' })
const monthFormatter = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' })
const shortMonthFormatter = new Intl.DateTimeFormat('he-IL', { month: 'short' })

export function formatDay(s: ISODate): string {
  return dayFormatter.format(parseISO(s))
}

export function formatMonth(key: string): string {
  return monthFormatter.format(parseISO(`${key}-01`))
}

export function formatShortMonth(key: string): string {
  return shortMonthFormatter.format(parseISO(`${key}-01`))
}

export const WEEKDAY_LABELS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳']

/** "היום", "מחר", "בעוד 3 ימים", "לפני יומיים"... */
export function relativeDay(s: ISODate, today: ISODate = todayISO()): string {
  const diff = diffDays(s, today)
  if (diff === 0) return 'היום'
  if (diff === 1) return 'מחר'
  if (diff === -1) return 'אתמול'
  if (diff === 2) return 'מחרתיים'
  if (diff === -2) return 'שלשום'
  if (diff > 0) return `בעוד ${diff} ימים`
  return `לפני ${-diff} ימים`
}
