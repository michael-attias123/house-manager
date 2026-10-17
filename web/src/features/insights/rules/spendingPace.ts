import { addMonths, monthKey } from '@/lib/dates'
import { formatILS } from '@/lib/money'
import { getExpenseCategory } from '@/features/expenses/lib/categories'
import { percentChange, totalsByCategory } from '../lib/aggregate'
import type { Insight, InsightRule } from '../types'

/** Month-to-date spending vs the same days last month, overall and per category. */
export const spendingPace: InsightRule = {
  id: 'spending-pace',
  evaluate: ({ today, expenses }) => {
    const day = today.slice(8, 10)
    const thisMonth = monthKey(today)
    const lastMonth = monthKey(addMonths(today, -1))
    const thisFilter = (d: string) => monthKey(d) === thisMonth && d.slice(8, 10) <= day
    const lastFilter = (d: string) => monthKey(d) === lastMonth && d.slice(8, 10) <= day

    const current = totalsByCategory(expenses, thisFilter)
    const previous = totalsByCategory(expenses, lastFilter)
    const sum = (t: Record<string, number>) => Object.values(t).reduce((s, v) => s + v, 0)
    const total = sum(current)
    const previousTotal = sum(previous)
    const insights: Insight[] = []

    const change = percentChange(total, previousTotal)
    if (change !== null && change >= 20 && total - previousTotal >= 200) {
      insights.push({
        id: 'spending-pace:up',
        tone: 'warning',
        icon: '📈',
        title: `הוצאתם ${change}% יותר מאשר באותה תקופה בחודש שעבר`,
        body: `${formatILS(total)} מתחילת החודש, לעומת ${formatILS(previousTotal)} עד אותו יום בחודש הקודם.`,
        link: { to: '/expenses', label: 'להוצאות' },
        priority: 65,
      })
    } else if (change !== null && change <= -15 && previousTotal - total >= 150) {
      insights.push({
        id: 'spending-pace:down',
        tone: 'good',
        icon: '👏',
        title: `הוצאתם ${-change}% פחות מאשר באותה תקופה בחודש שעבר`,
        body: `${formatILS(total)} מתחילת החודש, לעומת ${formatILS(previousTotal)}.`,
        priority: 35,
      })
    }

    const jumps = Object.entries(current)
      .map(([category, amount]) => ({ category, amount, prev: previous[category] ?? 0 }))
      .filter((c) => c.prev > 0 && c.amount - c.prev >= 150 && (percentChange(c.amount, c.prev) ?? 0) >= 30)
      .sort((a, b) => b.amount - b.prev - (a.amount - a.prev))
    if (jumps[0]) {
      const c = jumps[0]
      const category = getExpenseCategory(c.category)
      insights.push({
        id: `spending-pace:category:${c.category}`,
        tone: 'tip',
        icon: category.emoji,
        title: `${category.label}: ${formatILS(c.amount)} מתחילת החודש`,
        body: `${percentChange(c.amount, c.prev)}% יותר מבאותה תקופה בחודש שעבר (${formatILS(c.prev)}).`,
        priority: 55,
      })
    }
    return insights
  },
}
