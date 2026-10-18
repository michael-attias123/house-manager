import type { InsightData } from '../types'
import type { ExpenseWithShares } from '@/features/expenses/api'
import type { BillPayment, ChoreCompletion, FrequentItem } from '@/lib/db-types'
import { runInsightRules } from '../engine'
import { billSpike } from './bills'
import { choreBalance, settleUp } from './household'
import { runningLow } from './runningLow'
import { spendingPace } from './spendingPace'
import { INSIGHT_RULES } from '.'

const empty: InsightData = {
  today: '2026-10-17',
  userId: 'a',
  members: [
    { household_id: 'h', user_id: 'a', display_name: 'מיכאל', color: '#000', default_share_pct: 50, joined_at: '' },
    { household_id: 'h', user_id: 'b', display_name: 'שירן', color: '#000', default_share_pct: 50, joined_at: '' },
  ],
  expenses: [],
  balances: {},
  bills: [],
  billPayments: [],
  frequentItems: [],
  listItems: [],
  chores: [],
  completions: [],
  priceChanges: [],
  stores: [],
}

const expense = (date: string, amount: number, category = 'groceries') =>
  ({ expense_date: date, amount, category, expense_shares: [] }) as unknown as ExpenseWithShares

describe('insight rules', () => {
  it('produce nothing without data', () => {
    expect(runInsightRules(INSIGHT_RULES, empty)).toEqual([])
  })

  it('notices faster spending than last month', () => {
    const data = {
      ...empty,
      expenses: [expense('2026-10-05', 900, 'eating_out'), expense('2026-09-05', 300, 'eating_out')],
    }
    const ids = spendingPace.evaluate(data).map((i) => i.id)
    expect(ids).toContain('spending-pace:up')
    expect(ids).toContain('spending-pace:category:eating_out')
  })

  it('ignores last month spending after today’s day of month', () => {
    const data = { ...empty, expenses: [expense('2026-10-05', 500), expense('2026-09-25', 2000)] }
    expect(spendingPace.evaluate(data)).toEqual([])
  })

  it('suggests items that are probably running low', () => {
    const milk: FrequentItem = {
      household_id: 'h',
      normalized_name: 'חלב',
      name: 'חלב',
      category: 'dairy',
      barcode: null,
      times_bought: 5,
      first_bought_at: '2026-09-01T10:00:00Z',
      last_bought_at: '2026-10-09T10:00:00Z',
      // ~9.5 days apart, last bought 8 days ago → not yet.
    }
    expect(runningLow.evaluate({ ...empty, frequentItems: [milk] })).toEqual([])
    expect(runningLow.evaluate({ ...empty, today: '2026-10-20', frequentItems: [milk] })[0]?.title).toBe(
      'כנראה נגמר לכם חלב',
    )
  })

  it('flags a bill far above its average', () => {
    const bill = { id: 'e', name: 'חשמל', amount_type: 'variable', icon: '💡' } as InsightData['bills'][number]
    const payments = [
      { bill_id: 'e', due_date: '2026-09-01', amount: 600 },
      { bill_id: 'e', due_date: '2026-07-01', amount: 400 },
      { bill_id: 'e', due_date: '2026-05-01', amount: 420 },
    ] as BillPayment[]
    expect(billSpike.evaluate({ ...empty, bills: [bill], billPayments: payments })[0]?.title).toMatch('46%')
  })

  it('suggests settling large balances and balancing chores', () => {
    expect(settleUp.evaluate({ ...empty, balances: { a: 450, b: -450 } })[0]?.title).toMatch('450')
    const completions = Array.from({ length: 8 }, (_, i) => ({
      done_by: i < 7 ? 'b' : 'a',
      done_on: '2026-10-10',
    })) as ChoreCompletion[]
    expect(choreBalance.evaluate({ ...empty, completions })[0]?.title).toMatch('88%')
  })
})
