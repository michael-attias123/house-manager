import type { BillPayment } from '@/lib/db-types'
import { advanceDueDate, billStatus, monthlyCost, suggestedAmount } from './bills'

describe('bills', () => {
  it('advances due dates like the database does', () => {
    expect(advanceDueDate('2026-01-15', 'bimonthly')).toBe('2026-03-15')
    expect(advanceDueDate('2026-11-30', 'quarterly')).toBe('2027-02-28')
    expect(advanceDueDate('2026-10-01', 'yearly')).toBe('2027-10-01')
  })

  it('normalises to a monthly cost', () => {
    expect(monthlyCost({ amount: 600, frequency: 'bimonthly' })).toBe(300)
    expect(monthlyCost({ amount: null, frequency: 'monthly' })).toBe(0)
  })

  it('knows overdue and due soon', () => {
    expect(billStatus({ next_due_date: '2026-10-16' }, '2026-10-17')).toBe('overdue')
    expect(billStatus({ next_due_date: '2026-10-20' }, '2026-10-17')).toBe('due_soon')
    expect(billStatus({ next_due_date: '2026-11-20' }, '2026-10-17')).toBe('upcoming')
  })

  it('suggests the recent average for variable bills', () => {
    const payments = [300, 330, 360].map((amount) => ({ amount }) as BillPayment)
    expect(suggestedAmount({ amount: null, amount_type: 'variable' }, payments)).toBe(330)
    expect(suggestedAmount({ amount: 4500, amount_type: 'fixed' }, payments)).toBe(4500)
    expect(suggestedAmount({ amount: 250, amount_type: 'variable' }, [])).toBe(250)
  })
})
