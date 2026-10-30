// Is the place open? A small reader for the OSM opening_hours forms that
// Be'er Sheva's places use (the opening_hours npm package is LGPL, so the app
// keeps its own): weekday rules, several ranges, ranges past midnight, 24/7,
// off, and quoted comments. Anything else reads as "unknown", never "closed",
// so missing or odd hours never hide a place.
import { WEEKDAY_LABELS } from '@/lib/dates'
import { clockTime, jerusalemClock } from './schedule'

export type OpenStatus = 'open' | 'closed' | 'unknown'

export interface OpenState {
  state: OpenStatus
  /** When open: 'HH:MM', unless it never closes (24/7). */
  closesAt?: string
  /** When closed: the next opening ('HH:MM') and in how many days (0 = today). */
  opensAt?: string
  opensInDays?: number
}

/** One weekday. Ranges are minutes from that day's midnight; an end past 1440 runs into the next day. */
export interface DayHours {
  ranges: [number, number][]
  /** No times: a comment only, or `unknown`. */
  unknown: boolean
  comment: string | null
}

/** Sunday … Saturday. */
export type WeekHours = DayHours[]

const DAY_INDEX: Record<string, number> = { Su: 0, Mo: 1, Tu: 2, We: 3, Th: 4, Fr: 5, Sa: 6 }
const DAY = '(?:Mo|Tu|We|Th|Fr|Sa|Su)'
const DAY_ITEM = `(?:${DAY}(?:\\s*-\\s*${DAY})?|PH|SH)`
const TIME = '\\d{1,2}:\\d{2}'
const RANGE = `${TIME}\\s*-\\s*${TIME}`
const RULE = new RegExp(
  `^(?:(${DAY_ITEM}(?:\\s*,\\s*${DAY_ITEM})*)(?:\\s+|$))?` +
    `(?:(24/7|${RANGE}(?:\\s*,\\s*${RANGE})*)\\s*)?` +
    `(?:(open|closed|off|unknown)\\s*)?` +
    `(?:"([^"]*)")?$`,
)
// ", " that starts another rule ("Mo-Fr 09:00-17:00, Sa 10:00-14:00"), not
// one inside a day list ("Mo-We, Su") or a list of times ("12:00-16:30, 21:00-02:00").
const ADDITIONAL = new RegExp(`(?<=\\d|"|\\bopen|\\bclosed|\\boff|\\bunknown)\\s*,\\s*(?=(?:${DAY}|PH|SH)\\b)`)

const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]

/** Splits on `sep` outside quoted comments. */
function splitOutsideQuotes(text: string, sep: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  for (const ch of text) {
    if (ch === '"') quoted = !quoted
    if (ch === sep && !quoted) {
      parts.push(current)
      current = ''
    } else current += ch
  }
  parts.push(current)
  return parts
}

function parseDays(list: string): number[] {
  const days = new Set<number>()
  for (const item of list.split(',').map((s) => s.trim())) {
    if (item === 'PH' || item === 'SH') continue // holidays: can't tell when, so the rule is left out
    const [from, to] = item.split('-').map((s) => DAY_INDEX[s.trim()])
    if (to === undefined) {
      days.add(from)
      continue
    }
    for (let d = from; ; d = (d + 1) % 7) {
      days.add(d)
      if (d === to) break
    }
  }
  return [...days]
}

function parseRanges(list: string): [number, number][] | null {
  const ranges: [number, number][] = []
  for (const range of list.split(',')) {
    const [start, end] = range.split('-').map((t) => {
      const [h, m] = t.trim().split(':').map(Number)
      return h > 24 || m > 59 ? NaN : h * 60 + m
    })
    if (!(start < 1440) || !(end <= 1440)) return null
    ranges.push([start, end > start ? end : end + 1440])
  }
  return ranges
}

/** The week, or null when the text isn't one of the forms this reader knows. */
export function parseOpeningHours(text: string | null | undefined): WeekHours | null {
  const source = text?.trim()
  if (!source || source.includes('||')) return null
  const week: WeekHours = ALL_DAYS.map(() => ({ ranges: [], unknown: false, comment: null }))
  for (const rule of splitOutsideQuotes(source, ';')) {
    const parts = rule.trim() ? rule.trim().split(ADDITIONAL) : []
    for (const [i, part] of parts.entries()) {
      const m = part.trim().match(RULE)
      if (!m || !part.trim()) return null
      const [, dayList, times, modifier, comment] = m
      let days = ALL_DAYS
      if (dayList) {
        days = parseDays(dayList)
        if (days.length === 0) continue // a holiday-only rule ("PH off")
      }
      let plan: DayHours
      if (modifier === 'off' || modifier === 'closed') plan = { ranges: [], unknown: false, comment: comment ?? null }
      else if (modifier === 'unknown' || (!times && !modifier && comment !== undefined))
        plan = { ranges: [], unknown: true, comment: comment ?? null }
      else if (times === '24/7' || !times) plan = { ranges: [[0, 1440]], unknown: false, comment: comment ?? null }
      else {
        const ranges = parseRanges(times)
        if (!ranges) return null
        plan = { ranges, unknown: false, comment: comment ?? null }
      }
      for (const d of days) {
        // A later rule replaces what earlier ones said about its days; one
        // after ", " (an additional rule) adds to it.
        const day = week[d]
        if (i === 0 || plan.unknown || plan.ranges.length === 0) week[d] = { ...plan, ranges: [...plan.ranges] }
        else week[d] = { ranges: [...day.ranges, ...plan.ranges], unknown: false, comment: day.comment ?? plan.comment }
      }
    }
  }
  return week
}

/** A day whose hours are unknown leaves the night after it unknown too, until this hour. */
const UNKNOWN_NIGHT_END = 6 * 60

/** Open, closed or unknown at `now` (Be'er Sheva time). */
export function openState(text: string | null | undefined, now: Date): OpenState {
  const week = parseOpeningHours(text)
  if (!week) return { state: 'unknown' }
  const clock = jerusalemClock(now)
  // Yesterday (its ranges past midnight) through a week ahead, in minutes from now.
  const open: [number, number][] = []
  const unknown: [number, number][] = []
  for (let k = -1; k <= 7; k++) {
    const day = week[(((clock.weekday + k) % 7) + 7) % 7]
    const base = k * 1440 - clock.minutes
    for (const [s, e] of day.ranges) open.push([base + s, base + e])
    if (day.unknown) unknown.push([base, base + 1440 + UNKNOWN_NIGHT_END])
  }
  open.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of open) {
    const last = merged[merged.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  const covering = merged.find(([s, e]) => s <= 0 && e > 0)
  if (covering) {
    // Open for the whole window: it never closes.
    if (covering[1] >= 7 * 1440 - clock.minutes) return { state: 'open' }
    return { state: 'open', closesAt: clockTime(clock.minutes + covering[1]) }
  }
  if (unknown.some(([s, e]) => s <= 0 && e > 0)) return { state: 'unknown' }
  const next = merged.find(([s]) => s > 0)
  // An unknown day before the next opening: it may open sooner, so say nothing.
  if (!next || unknown.some(([s]) => s > 0 && s < next[0])) return { state: 'closed' }
  const at = clock.minutes + next[0]
  return { state: 'closed', opensAt: clockTime(at), opensInDays: Math.floor(at / 1440) }
}

/** One day for display: times go in `.num`, the note is text ("סגור", a comment). */
export interface DayLine {
  day: string
  times: string | null
  note: string | null
}

function dayLine(day: DayHours, index: number): DayLine {
  const label = WEEKDAY_LABELS[index]
  const [first] = day.ranges
  if (day.ranges.length === 1 && first[0] === 0 && first[1] === 1440) {
    return { day: label, times: null, note: day.comment ? `כל היממה · ${day.comment}` : 'כל היממה' }
  }
  if (day.ranges.length > 0) {
    const times = day.ranges.map(([s, e]) => `${clockTime(s)}–${clockTime(e)}`).join(', ')
    return { day: label, times, note: day.comment }
  }
  if (day.unknown) return { day: label, times: null, note: day.comment ?? 'לא ידוע' }
  return { day: label, times: null, note: day.comment ? `סגור · ${day.comment}` : 'סגור' }
}

/** Today's hours; null when the text can't be read. */
export function todayHours(text: string | null | undefined, now: Date): DayLine | null {
  const week = parseOpeningHours(text)
  const today = jerusalemClock(now).weekday
  return week ? dayLine(week[today], today) : null
}

/** The week from Sunday, one line a day; null when the text can't be read. */
export function weekLines(text: string | null | undefined): DayLine[] | null {
  const week = parseOpeningHours(text)
  return week ? week.map(dayLine) : null
}
