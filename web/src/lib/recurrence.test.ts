import { nextDueAfterCompletion, nextOccurrence } from './recurrence'

describe('recurrence', () => {
  it('finds the next weekly occurrence', () => {
    // 2026-10-18 is a Sunday; rule: Sunday and Wednesday.
    const rule = { kind: 'weekly' as const, weekdays: [0, 3] }
    expect(nextOccurrence(rule, '2026-10-18')).toBe('2026-10-21')
    expect(nextOccurrence(rule, '2026-10-21')).toBe('2026-10-25')
  })

  it('handles every-n-days, monthly and once', () => {
    expect(nextOccurrence({ kind: 'every_n_days', days: 3 }, '2026-10-30')).toBe('2026-11-02')
    expect(nextOccurrence({ kind: 'monthly' }, '2026-01-31')).toBe('2026-02-28')
    expect(nextOccurrence({ kind: 'once' }, '2026-10-17')).toBeNull()
  })

  it('counts late completion from today and early completion from the due date', () => {
    const rule = { kind: 'every_n_days' as const, days: 7 }
    expect(nextDueAfterCompletion(rule, '2026-10-10', '2026-10-17')).toBe('2026-10-24')
    expect(nextDueAfterCompletion(rule, '2026-10-20', '2026-10-17')).toBe('2026-10-27')
  })

})
