import { dealSchedule, formatAgo, formatHours, formatValidity, formatWeekdays } from './suggestions'

describe('formatWeekdays', () => {
  it('lists days in week order, as Hebrew letters', () => {
    expect(formatWeekdays([4, 0, 2])).toBe('א׳ ג׳ ה׳')
    expect(formatWeekdays([6])).toBe('ש׳')
    expect(formatWeekdays([2, 2])).toBe('ג׳')
  })

  it('says every day for none or all seven', () => {
    expect(formatWeekdays([])).toBe('כל יום')
    expect(formatWeekdays(null)).toBe('כל יום')
    expect(formatWeekdays([0, 1, 2, 3, 4, 5, 6])).toBe('כל יום')
  })
})

describe('formatHours', () => {
  it('shows a range without seconds', () => {
    expect(formatHours('19:00:00', '23:00:00')).toBe('19:00–23:00')
  })

  it('marks a deal that crosses midnight', () => {
    expect(formatHours('22:00:00', '02:00:00')).toBe('22:00–02:00 עד למחרת')
  })

  it('falls back to the opening hours, or one end', () => {
    expect(formatHours(null, null)).toBe('כל שעות הפתיחה')
    expect(formatHours('17:30:00', null)).toBe('מ־17:30')
    expect(formatHours(null, '21:00:00')).toBe('עד 21:00')
  })
})

describe('formatValidity', () => {
  it('formats one day, a range and open ends', () => {
    expect(formatValidity('2026-11-05', '2026-11-05')).toBe('ב־5.11.2026')
    expect(formatValidity('2026-11-01', '2026-11-30')).toBe('1.11.2026–30.11.2026')
    expect(formatValidity('2026-11-01', null)).toBe('מ־1.11.2026')
    expect(formatValidity(null, '2026-12-31')).toBe('עד 31.12.2026')
    expect(formatValidity(null, null)).toBeNull()
  })
})

describe('dealSchedule', () => {
  const deal = { deal_kind: 'special_day' as const, weekdays: [2], starts_at: '19:00:00', ends_at: '23:00:00', valid_from: null, valid_until: null }

  it('joins days, hours and dates', () => {
    expect(dealSchedule(deal)).toBe('ג׳ · 19:00–23:00')
    expect(dealSchedule({ ...deal, weekdays: [], valid_until: '2026-12-31' })).toBe('כל יום · 19:00–23:00 · עד 31.12.2026')
  })

  it('leaves out the days of a one-off event', () => {
    expect(
      dealSchedule({ deal_kind: 'event', weekdays: [], starts_at: '21:00:00', ends_at: '01:00:00', valid_from: '2026-11-05', valid_until: '2026-11-05' }),
    ).toBe('21:00–01:00 עד למחרת · ב־5.11.2026')
  })
})

describe('formatAgo', () => {
  const now = new Date('2026-10-30T20:00:00Z')
  const ago = (ms: number) => formatAgo(new Date(now.getTime() - ms).toISOString(), now)

  it('counts minutes, hours and days', () => {
    expect(ago(20_000)).toBe('לפני רגע')
    expect(ago(-60_000)).toBe('לפני רגע')
    expect(ago(60_000)).toBe('לפני דקה')
    expect(ago(5 * 60_000)).toBe('לפני 5 דקות')
    expect(ago(60 * 60_000)).toBe('לפני שעה')
    expect(ago(2.5 * 3_600_000)).toBe('לפני 2 שעות')
    expect(ago(30 * 3_600_000)).toBe('לפני יום')
    expect(ago(3 * 86_400_000)).toBe('לפני 3 ימים')
  })
})
