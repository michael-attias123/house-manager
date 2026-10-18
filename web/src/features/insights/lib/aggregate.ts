import { addMonths, monthKey, type ISODate } from '@/lib/dates'
import { fromAgorot, toAgorot } from '@/lib/money'
import type { ExpenseWithShares } from '@/features/expenses/api'

/** The last `count` month keys, oldest first, ending with today's month. */
export function lastMonths(today: ISODate, count: number): string[] {
  return Array.from({ length: count }, (_, i) => monthKey(addMonths(`${monthKey(today)}-01`, i - count + 1)))
}

export function totalsByMonth(expenses: Pick<ExpenseWithShares, 'expense_date' | 'amount'>[], months: string[]) {
  const totals = new Map(months.map((m) => [m, 0]))
  for (const e of expenses) {
    const key = monthKey(e.expense_date)
    if (totals.has(key)) totals.set(key, totals.get(key)! + toAgorot(Number(e.amount)))
  }
  return months.map((month) => ({ month, total: fromAgorot(totals.get(month)!) }))
}

export function totalsByCategory(
  expenses: Pick<ExpenseWithShares, 'expense_date' | 'amount' | 'category'>[],
  filter: (date: ISODate) => boolean,
): Record<string, number> {
  const totals: Record<string, number> = {}
  for (const e of expenses) {
    if (!filter(e.expense_date)) continue
    totals[e.category] = (totals[e.category] ?? 0) + toAgorot(Number(e.amount))
  }
  return Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, fromAgorot(v)]))
}

export function percentChange(current: number, previous: number): number | null {
  if (previous <= 0) return null
  return Math.round(((current - previous) / previous) * 100)
}
