// The deal form's fields, their checks, and the row they become.
import type { DealKind, VenueDeal } from '@/lib/db-types'
import type { ISODate } from '@/lib/dates'
import { parseTime, shortTime } from './schedule'

export interface DealDraft {
  venueId: number | null
  title: string
  kind: DealKind
  /** Empty = every day. Not used for an event. */
  weekdays: number[]
  /** "כל שעות הפתיחה": no times. */
  allHours: boolean
  /** 'HH:MM' or ''. */
  startsAt: string
  endsAt: string
  /** An event's date, or the last day of any other deal; ''. */
  date: ISODate | ''
  note: string
}

export const TITLE_MIN = 2
export const TITLE_MAX = 60
export const NOTE_MAX = 200

export function emptyDraft(venueId: number | null = null): DealDraft {
  return { venueId, title: '', kind: 'happy_hour', weekdays: [], allHours: false, startsAt: '', endsAt: '', date: '', note: '' }
}

export function draftFromDeal(deal: VenueDeal): DealDraft {
  return {
    venueId: deal.venue_id,
    title: deal.title,
    kind: deal.kind,
    weekdays: [...deal.weekdays],
    allHours: deal.starts_at == null,
    startsAt: shortTime(deal.starts_at) ?? '',
    endsAt: shortTime(deal.ends_at) ?? '',
    date: (deal.kind === 'event' ? deal.valid_from : deal.valid_until) ?? '',
    note: deal.note ?? '',
  }
}

export type DraftError =
  | 'venue_missing'
  | 'title_short'
  | 'title_long'
  | 'days_missing'
  | 'hours_missing'
  | 'hours_equal'
  | 'date_missing'
  | 'date_past'
  | 'note_long'

export type DraftField = 'venue' | 'title' | 'days' | 'hours' | 'date' | 'note'

/** At most one error per field; empty when the draft can be saved. */
export function validateDraft(d: DealDraft, today: ISODate): Partial<Record<DraftField, DraftError>> {
  const errors: Partial<Record<DraftField, DraftError>> = {}
  const title = d.title.trim()
  if (d.venueId == null) errors.venue = 'venue_missing'
  if (title.length < TITLE_MIN) errors.title = 'title_short'
  else if (title.length > TITLE_MAX) errors.title = 'title_long'
  if (d.kind === 'special_day' && d.weekdays.length === 0) errors.days = 'days_missing'
  if (!d.allHours) {
    const s = parseTime(d.startsAt)
    const e = parseTime(d.endsAt)
    if (s == null || e == null) errors.hours = 'hours_missing'
    else if (s % 1440 === e % 1440) errors.hours = 'hours_equal'
  }
  if (d.kind === 'event' && !d.date) errors.date = 'date_missing'
  else if (d.date && d.date < today) errors.date = 'date_past'
  if (d.note.trim().length > NOTE_MAX) errors.note = 'note_long'
  return errors
}

export type DealFields = Pick<
  VenueDeal,
  'venue_id' | 'title' | 'kind' | 'weekdays' | 'starts_at' | 'ends_at' | 'valid_from' | 'valid_until' | 'note'
>

/** The columns to save; call only after validateDraft found nothing. */
export function draftToFields(d: DealDraft): DealFields {
  const event = d.kind === 'event'
  const weekdays = event ? [] : [...new Set(d.weekdays)].sort((a, b) => a - b)
  return {
    venue_id: d.venueId!,
    title: d.title.trim(),
    kind: d.kind,
    weekdays: weekdays.length === 7 ? [] : weekdays,
    starts_at: d.allHours ? null : d.startsAt,
    ends_at: d.allHours ? null : d.endsAt,
    valid_from: event ? d.date || null : null,
    valid_until: d.date || null,
    note: d.note.trim() || null,
  }
}
