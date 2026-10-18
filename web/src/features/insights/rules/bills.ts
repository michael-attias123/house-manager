import { diffDays } from '@/lib/dates'
import { formatILS } from '@/lib/money'
import { monthlyCost } from '@/features/bills/lib/bills'
import { lastMonths, totalsByMonth } from '../lib/aggregate'
import type { Insight, InsightRule } from '../types'

export const overdueBills: InsightRule = {
  id: 'overdue-bills',
  evaluate: ({ today, bills }) =>
    bills
      .filter((b) => !b.auto_create && b.next_due_date < today)
      .map((b) => ({
        id: `overdue-bill:${b.id}`,
        tone: 'warning' as const,
        icon: b.icon ?? '🧾',
        title: `${b.name} — עבר מועד התשלום`,
        body: `היה אמור להשתלם לפני ${diffDays(today, b.next_due_date)} ימים. שילמתם? סמנו "שולם".`,
        link: { to: '/bills', label: 'לחשבונות' },
        priority: 90,
      })),
}

/** A variable bill whose latest amount is well above its own average. */
export const billSpike: InsightRule = {
  id: 'bill-spike',
  evaluate: ({ bills, billPayments }) => {
    const insights: Insight[] = []
    for (const bill of bills.filter((b) => b.amount_type === 'variable')) {
      const payments = billPayments
        .filter((p) => p.bill_id === bill.id)
        .sort((a, b) => b.due_date.localeCompare(a.due_date))
      if (payments.length < 3) continue
      const [latest, ...rest] = payments
      const previous = rest.slice(0, 5).map((p) => Number(p.amount))
      const average = previous.reduce((s, a) => s + a, 0) / previous.length
      const pct = Math.round(((Number(latest.amount) - average) / average) * 100)
      if (pct >= 25) {
        insights.push({
          id: `bill-spike:${bill.id}:${latest.due_date}`,
          tone: 'warning',
          icon: bill.icon ?? '🧾',
          title: `החשבון האחרון של ${bill.name} גבוה ב-${pct}% מהממוצע`,
          body: `${formatILS(Number(latest.amount))} לעומת ממוצע של ${formatILS(Math.round(average))}. שווה לבדוק אם משהו השתנה.`,
          link: { to: '/bills', label: 'לחשבונות' },
          priority: 70,
        })
      }
    }
    return insights
  },
}

/** How much of the monthly spend is locked into recurring bills. */
export const fixedCosts: InsightRule = {
  id: 'fixed-costs',
  evaluate: ({ today, bills, expenses }) => {
    const monthly = bills.reduce((s, b) => s + monthlyCost(b), 0)
    if (monthly <= 0) return []
    const fullMonths = lastMonths(today, 4).slice(0, 3)
    const totals = totalsByMonth(expenses, fullMonths).filter((m) => m.total > 0)
    const average = totals.length ? totals.reduce((s, m) => s + m.total, 0) / totals.length : 0
    const share = average > 0 ? Math.round((monthly / average) * 100) : null
    return [
      {
        id: 'fixed-costs',
        tone: 'info',
        icon: '🔁',
        title: `הוצאות קבועות: ~${formatILS(Math.round(monthly))} בחודש`,
        body:
          share !== null && share <= 100
            ? `בערך ${share}% מההוצאות החודשיות שלכם. מנוי שלא משתמשים בו? זה המקום לחסוך.`
            : 'מנוי שלא משתמשים בו? זה המקום לחסוך.',
        link: { to: '/bills', label: 'לחשבונות' },
        priority: 20,
      },
    ]
  },
}
