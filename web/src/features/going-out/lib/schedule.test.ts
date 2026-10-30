import type { VenueDeal } from '@/lib/db-types'
import {
  canConfirm,
  confirmedLabel,
  crossesMidnight,
  daysLabel,
  dealWindow,
  isStale,
  jerusalemClock,
  shortTime,
} from './schedule'

// November 2026 is UTC+2 in Israel; 2026-11-03 is a Tuesday.
const at = (local: string, offset = '+02:00') => new Date(`${local}:00${offset}`)

type Schedule = Pick<VenueDeal, 'weekdays' | 'starts_at' | 'ends_at' | 'valid_from' | 'valid_until'>
const deal = (extra: Partial<Schedule> = {}): Schedule => ({
  weekdays: [],
  starts_at: null,
  ends_at: null,
  valid_from: null,
  valid_until: null,
  ...extra,
})

const tuesdayWine = deal({ weekdays: [2], starts_at: '19:00:00', ends_at: '23:00:00' })
const tuesdayNight = deal({ weekdays: [2], starts_at: '22:00:00', ends_at: '02:00:00' })

describe('jerusalemClock', () => {
  it('reads Be’er Sheva time, summer and winter', () => {
    expect(jerusalemClock(new Date('2026-11-03T22:30:00Z'))).toEqual({ day: '2026-11-04', minutes: 30, weekday: 3 })
    expect(jerusalemClock(at('2026-07-07T20:00', '+03:00'))).toEqual({ day: '2026-07-07', minutes: 1200, weekday: 2 })
  })
})

describe('dealWindow', () => {
  it('is on Tuesday at 20:00', () => {
    expect(dealWindow(tuesdayWine, at('2026-11-03T20:00'))).toMatchObject({
      state: 'active',
      start: '19:00',
      end: '23:00',
      startsIn: -60,
    })
  })

  it('reads summer time on the Israeli clock too', () => {
    expect(dealWindow(tuesdayWine, at('2026-07-07T20:00', '+03:00')).state).toBe('active')
  })

  it('keeps a night past midnight on the day it started', () => {
    expect(dealWindow(tuesdayNight, at('2026-11-04T01:00'))).toMatchObject({ state: 'active', end: '02:00' })
    expect(dealWindow(tuesdayNight, at('2026-11-04T03:00')).state).toBe('not_today')
    // Monday night is not a Tuesday deal, even after midnight: tonight's starts at 22:00.
    expect(dealWindow(tuesdayNight, at('2026-11-03T01:00'))).toMatchObject({ state: 'upcoming', startsIn: 1260 })
  })

  it('is over after it ended today', () => {
    expect(dealWindow(tuesdayWine, at('2026-11-03T23:30')).state).toBe('today_over')
  })

  it('is later within four hours of the start, and upcoming beyond', () => {
    expect(dealWindow(tuesdayWine, at('2026-11-03T15:01'))).toMatchObject({ state: 'later', startsIn: 239 })
    expect(dealWindow(tuesdayWine, at('2026-11-03T15:00'))).toMatchObject({ state: 'later', startsIn: 240 })
    expect(dealWindow(tuesdayWine, at('2026-11-03T14:59'))).toMatchObject({ state: 'upcoming', startsIn: 241 })
  })

  it("counts tomorrow's early start as later tonight", () => {
    const early = deal({ weekdays: [3], starts_at: '01:00', ends_at: '03:00' })
    expect(dealWindow(early, at('2026-11-03T23:00'))).toMatchObject({ state: 'later', startsIn: 120 })
  })

  it('treats empty weekdays as every day', () => {
    const daily = deal({ starts_at: '17:00', ends_at: '19:00' })
    for (const day of ['2026-11-01', '2026-11-04', '2026-11-07']) {
      expect(dealWindow(daily, at(`${day}T18:00`)).state).toBe('active')
    }
  })

  it('runs a one-off event on its date only', () => {
    const jazz = deal({ starts_at: '21:00', ends_at: '23:30', valid_from: '2026-11-05', valid_until: '2026-11-05' })
    expect(dealWindow(jazz, at('2026-11-05T22:00')).state).toBe('active')
    expect(dealWindow(jazz, at('2026-11-04T22:00')).state).toBe('not_today')
    expect(dealWindow(jazz, at('2026-11-06T22:00'))).toMatchObject({ state: 'not_today', expired: true })
  })

  it('expires after valid_until, but finishes its last night', () => {
    const lastNight = { ...tuesdayNight, valid_until: '2026-11-03' }
    expect(dealWindow(lastNight, at('2026-11-04T01:00'))).toMatchObject({ state: 'active', expired: false })
    expect(dealWindow(lastNight, at('2026-11-10T20:00'))).toMatchObject({ state: 'not_today', expired: true })
    expect(dealWindow({ ...tuesdayWine, valid_from: '2026-11-10' }, at('2026-11-03T20:00')).state).toBe('not_today')
  })

  it('is on all day when it has no hours', () => {
    const students = deal({ weekdays: [0, 1, 2, 3, 4] })
    expect(dealWindow(students, at('2026-11-03T08:00'))).toEqual({
      state: 'active',
      start: null,
      end: null,
      startsIn: null,
      expired: false,
    })
    expect(dealWindow(students, at('2026-11-06T08:00')).state).toBe('not_today')
  })

  it('reads an end of midnight as the end of the day', () => {
    const late = deal({ starts_at: '22:00', ends_at: '00:00' })
    expect(dealWindow(late, at('2026-11-03T23:59'))).toMatchObject({ state: 'active', end: '00:00' })
    expect(dealWindow(late, at('2026-11-04T00:00')).state).not.toBe('active')
  })
})

describe('labels', () => {
  it('names the days in order, or every day', () => {
    expect(daysLabel([])).toBe('כל יום')
    expect(daysLabel([4, 0, 2])).toBe('א׳ ג׳ ה׳')
    expect(daysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('כל יום')
  })

  it('shortens times and spots a night past midnight', () => {
    expect(shortTime('19:00:00')).toBe('19:00')
    expect(shortTime(null)).toBeNull()
    expect(crossesMidnight('21:00', '01:00')).toBe(true)
    expect(crossesMidnight('17:00', '19:00')).toBe(false)
    expect(crossesMidnight('22:00', '00:00')).toBe(false)
  })
})

describe('confirmation', () => {
  const now = at('2026-11-03T20:00')
  const confirmed = (daysAgo: number) => ({
    last_confirmed_at: new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  })

  it('warns after 60 days without a confirmation', () => {
    expect(isStale(confirmed(59), now)).toBe(false)
    expect(isStale(confirmed(61), now)).toBe(true)
  })

  it('counts a confirmation once per 12 hours', () => {
    expect(canConfirm(confirmed(0.4), now)).toBe(false)
    expect(canConfirm(confirmed(0.6), now)).toBe(true)
  })

  it('says how long ago', () => {
    expect(confirmedLabel(confirmed(0), now)).toBe('אומת היום')
    expect(confirmedLabel(confirmed(1), now)).toBe('אומת אתמול')
    expect(confirmedLabel(confirmed(3), now)).toBe('אומת לפני 3 ימים')
  })
})
