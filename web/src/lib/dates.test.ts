import { addDays, addMonths, diffDays, relativeDay, weekday } from './dates'

describe('dates', () => {
  it('adds months and clamps to month end', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28')
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29')
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15')
    expect(addMonths('2026-03-31', -1)).toBe('2026-02-28')
  })

  it('adds days across month and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-03-27', 1)).toBe('2026-03-28')
    expect(diffDays('2026-11-01', '2026-10-25')).toBe(7)
  })

  it('knows weekdays (0 = Sunday)', () => {
    expect(weekday('2026-10-18')).toBe(0)
    expect(weekday('2026-10-17')).toBe(6)
  })

  it('describes relative days in Hebrew', () => {
    expect(relativeDay('2026-10-17', '2026-10-17')).toBe('היום')
    expect(relativeDay('2026-10-18', '2026-10-17')).toBe('מחר')
    expect(relativeDay('2026-10-22', '2026-10-17')).toBe('בעוד 5 ימים')
    expect(relativeDay('2026-10-14', '2026-10-17')).toBe('לפני 3 ימים')
  })
})
