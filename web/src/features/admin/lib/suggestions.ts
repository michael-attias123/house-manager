import { parseISO, WEEKDAY_LABELS, type ISODate } from '@/lib/dates'

// The going-out unions (VenueKind, DealKind, SuggestionStatus in db-types.ts),
// spelled out here so this tab does not depend on the going-out screens.
type VenueKind = 'bar' | 'pub' | 'restaurant' | 'cafe' | 'nightclub' | 'other'
type DealKind = 'happy_hour' | 'special_day' | 'event'
type SuggestionStatus = 'approved' | 'pending' | 'rejected'

/**
 * A row of admin_list_suggestions() (20261101000100_going_out.sql): a pending
 * deal (with its place), or a pending place a household added. Oldest first.
 */
export interface AdminSuggestion {
  item_type: 'deal' | 'venue'
  /** Null on a venue row. */
  deal_id: string | null
  venue_id: number
  venue_name: string
  venue_kind: VenueKind
  venue_status: SuggestionStatus
  venue_lat: number | null
  venue_lng: number | null
  venue_address: string | null
  // The deal's columns; null on a venue row.
  title: string | null
  deal_kind: DealKind | null
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  weekdays: number[] | null
  /** 'HH:MM:SS'; both null = whenever the place is open. */
  starts_at: string | null
  ends_at: string | null
  valid_from: ISODate | null
  valid_until: ISODate | null
  note: string | null
  household_id: string | null
  household_name: string | null
  created_at: string
  /** For a pending place: an approved one with the same normalized name or within 50 m. */
  similar_venue_id: number | null
  similar_venue_name: string | null
}

export const VENUE_KIND_LABELS: Record<VenueKind, string> = {
  bar: 'בר',
  pub: 'פאב',
  restaurant: 'מסעדה',
  cafe: 'בית קפה',
  nightclub: 'מועדון',
  other: 'מקום',
}

export const VENUE_KIND_EMOJI: Record<VenueKind, string> = {
  bar: '🍸',
  pub: '🍺',
  restaurant: '🍽️',
  cafe: '☕',
  nightclub: '🎶',
  other: '📍',
}

export const DEAL_KIND_LABELS: Record<DealKind, string> = {
  happy_hour: 'Happy hour',
  special_day: 'יום מיוחד',
  event: 'אירוע חד־פעמי',
}

export const DEAL_KIND_EMOJI: Record<DealKind, string> = {
  happy_hour: '🍻',
  special_day: '📅',
  event: '⭐',
}

/** "א׳ ג׳ ה׳", or "כל יום" for none or all seven. */
export function formatWeekdays(weekdays: readonly number[] | null | undefined): string {
  const days = [...new Set(weekdays ?? [])].filter((d) => d >= 0 && d <= 6).sort()
  if (days.length === 0 || days.length === 7) return 'כל יום'
  return days.map((d) => WEEKDAY_LABELS[d]).join(' ')
}

const hhmm = (time: string) => time.slice(0, 5)

/** "19:00–23:00", "22:00–02:00 עד למחרת", or "כל שעות הפתיחה" without times. */
export function formatHours(startsAt: string | null, endsAt: string | null): string {
  if (startsAt && endsAt) {
    const range = `${hhmm(startsAt)}–${hhmm(endsAt)}`
    return endsAt < startsAt ? `${range} עד למחרת` : range
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

/** Days, hours and dates of a deal row, joined by " · ". An event on a date has no days. */
export function dealSchedule(
  s: Pick<AdminSuggestion, 'deal_kind' | 'weekdays' | 'starts_at' | 'ends_at' | 'valid_from' | 'valid_until'>,
): string {
  const oneOff = s.deal_kind === 'event' && !s.weekdays?.length && (s.valid_from || s.valid_until)
  return [oneOff ? null : formatWeekdays(s.weekdays), formatHours(s.starts_at, s.ends_at), formatValidity(s.valid_from, s.valid_until)]
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

/** Opens the spot in Waze, to check where a suggested place is. */
export function wazeUrl(lat: number, lng: number): string {
  return `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`
}
