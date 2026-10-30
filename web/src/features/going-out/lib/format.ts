// A deal's schedule and a suggestion's age as plain text, for the lists of
// suggestions (features/admin and "ההצעות שלי"). Numbers are left in the text;
// <Nums> isolates them for RTL.
import type { VenueDeal } from '@/lib/db-types'
import { parseISO, type ISODate } from '@/lib/dates'
import { crossesMidnight, daysLabel } from './schedule'

const hhmm = (time: string) => time.slice(0, 5)

/** "19:00–23:00", "22:00–02:00 עד למחרת" (not when it ends at midnight), or "כל שעות הפתיחה" without times. */
export function formatHours(startsAt: string | null, endsAt: string | null): string {
  if (startsAt && endsAt) {
    const range = `${hhmm(startsAt)}–${hhmm(endsAt)}`
    return crossesMidnight(startsAt, endsAt) ? `${range} עד למחרת` : range
  }
  if (startsAt) return `מ־${hhmm(startsAt)}`
  if (endsAt) return `עד ${hhmm(endsAt)}`
  return 'כל שעות הפתיחה'
}

const dayFormat = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'numeric', year: 'numeric' })
const day = (iso: ISODate) => dayFormat.format(parseISO(iso))

/** "ב־5.11.2026" (one day), "1.11.2026–30.11.2026", "מ־…", "עד …"; null without dates. */
export function formatValidity(from: ISODate | null, until: ISODate | null): string | null {
  if (from && until) return from === until ? `ב־${day(from)}` : `${day(from)}–${day(until)}`
  if (from) return `מ־${day(from)}`
  if (until) return `עד ${day(until)}`
  return null
}

export type ScheduleFields = Pick<VenueDeal, 'kind' | 'starts_at' | 'ends_at' | 'valid_from' | 'valid_until'> & {
  weekdays: readonly number[] | null
}

/** Days, hours and dates of a deal, joined by " · ". An event on a date has no days. */
export function dealSchedule(s: ScheduleFields): string {
  const oneOff = s.kind === 'event' && !s.weekdays?.length && (s.valid_from || s.valid_until)
  return [oneOff ? null : daysLabel([...(s.weekdays ?? [])]), formatHours(s.starts_at, s.ends_at), formatValidity(s.valid_from, s.valid_until)]
    .filter(Boolean)
    .join(' · ')
}

/** "לפני רגע", "לפני 5 דקות", "לפני שעה", "לפני 2 שעות", "לפני 3 ימים". */
export function formatAgo(timestamp: string, now: Date = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(timestamp).getTime()) / 60_000)
  if (minutes < 1) return 'לפני רגע'
  if (minutes < 60) return minutes === 1 ? 'לפני דקה' : `לפני ${minutes} דקות`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return hours === 1 ? 'לפני שעה' : `לפני ${hours} שעות`
  const days = Math.floor(hours / 24)
  return days === 1 ? 'לפני יום' : `לפני ${days} ימים`
}
