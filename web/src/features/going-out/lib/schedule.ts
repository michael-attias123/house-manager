// When a deal is on. Pure: `now` comes from the caller, and every rule is
// read on the Asia/Jerusalem clock, whatever the phone's time zone.
import type { VenueDeal } from '@/lib/db-types'
import { addDays, diffDays, relativeDay, weekday, WEEKDAY_LABELS, type ISODate } from '@/lib/dates'

export interface Clock {
  /** The calendar day in Be'er Sheva. */
  day: ISODate
  /** Minutes since midnight there. */
  minutes: number
  /** 0 = Sunday … 6 = Saturday. */
  weekday: number
}

const clockFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Jerusalem',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

export function jerusalemClock(now: Date): Clock {
  const part = Object.fromEntries(clockFormat.formatToParts(now).map((p) => [p.type, p.value]))
  const day = `${part.year}-${part.month}-${part.day}`
  return { day, minutes: Number(part.hour) * 60 + Number(part.minute), weekday: weekday(day) }
}

/** 'HH:MM' or 'HH:MM:SS' → minutes since midnight; null when empty or malformed. */
export function parseTime(value: string | null | undefined): number | null {
  const m = value?.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return null
  const minutes = Number(m[1]) * 60 + Number(m[2])
  return Number(m[1]) <= 24 && Number(m[2]) < 60 && minutes <= 1440 ? minutes : null
}

/** Minutes → 'HH:MM' on the clock face (1500 → '01:00'). */
export function clockTime(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

/** '19:00:00' → '19:00'. */
export function shortTime(value: string | null): string | null {
  const minutes = parseTime(value)
  return minutes == null ? null : clockTime(minutes)
}

/** Starts within this many minutes → "בהמשך הערב". */
export const LATER_MINUTES = 4 * 60

/**
 * active: on right now. later: starts within LATER_MINUTES. upcoming: later
 * today, beyond that. today_over: it was on today and ended. not_today: no
 * night of it today (another weekday, outside its dates, or expired).
 */
export type DealState = 'active' | 'later' | 'upcoming' | 'today_over' | 'not_today'

export interface DealWindow {
  state: DealState
  /** 'HH:MM'; both null for a deal that runs whenever the place is open. */
  start: string | null
  end: string | null
  /** Minutes from now to the start of the night in question (negative once it started). */
  startsIn: number | null
  /** Its last date has passed. */
  expired: boolean
}

type Schedule = Pick<VenueDeal, 'weekdays' | 'starts_at' | 'ends_at' | 'valid_from' | 'valid_until'>

/** Does the deal have a night that starts on `day`? Empty weekdays = every day. */
export function runsOn(deal: Schedule, day: ISODate): boolean {
  if (deal.valid_from && day < deal.valid_from) return false
  if (deal.valid_until && day > deal.valid_until) return false
  return deal.weekdays.length === 0 || deal.weekdays.includes(weekday(day))
}

/**
 * Where the deal stands at `now`. A night that crosses midnight belongs to
 * the day it started: Tuesday 22:00–02:00 is still on at 01:00 on Wednesday,
 * and its dates and weekdays are Tuesday's.
 */
export function dealWindow(deal: Schedule, now: Date): DealWindow {
  const clock = jerusalemClock(now)
  const startMin = parseTime(deal.starts_at)
  const endMin = parseTime(deal.ends_at)
  const expired = deal.valid_until != null && clock.day > deal.valid_until

  if (startMin == null) {
    return runsOn(deal, clock.day)
      ? { state: 'active', start: null, end: null, startsIn: null, expired: false }
      : { state: 'not_today', start: null, end: null, startsIn: null, expired }
  }

  let length = (endMin ?? 1440) - startMin
  if (length <= 0) length += 1440
  const start = clockTime(startMin)
  const end = clockTime(startMin + length)
  // Yesterday's night may still be on; tomorrow's may start within the hours ahead.
  const nights = [-1, 0, 1]
    .filter((k) => runsOn(deal, addDays(clock.day, k)))
    .map((k) => ({ k, from: k * 1440 + startMin - clock.minutes }))
  const current = nights.find((n) => n.from <= 0 && n.from + length > 0)
  if (current) return { state: 'active', start, end, startsIn: current.from, expired: false }
  const next = nights.find((n) => n.from > 0)
  if (next && next.from <= LATER_MINUTES) return { state: 'later', start, end, startsIn: next.from, expired: false }
  if (next?.k === 0) return { state: 'upcoming', start, end, startsIn: next.from, expired: false }
  if (nights.some((n) => n.k === 0)) return { state: 'today_over', start, end, startsIn: null, expired: false }
  return { state: 'not_today', start, end, startsIn: null, expired }
}

/** "כל יום", or the weekdays in order: "א׳ ג׳ ה׳". */
export function daysLabel(weekdays: number[]): string {
  const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort((a, b) => a - b)
  if (days.length === 0 || days.length === 7) return 'כל יום'
  return days.map((d) => WEEKDAY_LABELS[d]).join(' ')
}

/** Ends earlier on the clock than it starts: runs past midnight. */
export function crossesMidnight(starts: string | null, ends: string | null): boolean {
  const s = parseTime(starts)
  const e = parseTime(ends)
  return s != null && e != null && e < s && e !== 0
}

const DAY_MS = 86_400_000

/** "No one has confirmed it for a while": after this many days, say so. */
export const STALE_DAYS = 60

export function isStale(deal: Pick<VenueDeal, 'last_confirmed_at'>, now: Date): boolean {
  return now.getTime() - new Date(deal.last_confirmed_at).getTime() > STALE_DAYS * DAY_MS
}

/** confirm_deal counts once per 12 hours per deal; a tap sooner does nothing. */
export function canConfirm(deal: Pick<VenueDeal, 'last_confirmed_at'>, now: Date): boolean {
  return now.getTime() - new Date(deal.last_confirmed_at).getTime() >= DAY_MS / 2
}

/** "אומת היום", "אומת אתמול", "אומת לפני 3 ימים". */
export function confirmedLabel(deal: Pick<VenueDeal, 'last_confirmed_at'>, now: Date): string {
  const today = jerusalemClock(now).day
  const day = jerusalemClock(new Date(deal.last_confirmed_at)).day
  return `אומת ${relativeDay(day > today ? today : day, today)}`
}

/** Days from today (Be'er Sheva) to an ISO day. */
export function daysUntil(day: ISODate, now: Date): number {
  return diffDays(day, jerusalemClock(now).day)
}
