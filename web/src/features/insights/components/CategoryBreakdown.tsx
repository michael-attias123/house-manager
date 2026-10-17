import { formatILS } from '@/lib/money'
import { getExpenseCategory } from '@/features/expenses/lib/categories'

/** This month's spending per category: sorted horizontal bars, one hue, direct labels. */
export function CategoryBreakdown({ totals }: { totals: Record<string, number> }) {
  const rows = Object.entries(totals)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...rows.map(([, v]) => v))
  const sum = rows.reduce((s, [, v]) => s + v, 0)

  if (rows.length === 0) return <p className="text-sm text-ink-3">עוד אין הוצאות החודש</p>
  return (
    <ul className="space-y-2.5">
      {rows.map(([id, value]) => {
        const category = getExpenseCategory(id)
        return (
          <li key={id} className="space-y-1">
            <div className="flex items-baseline justify-between text-sm">
              <span>
                <span aria-hidden>{category.emoji}</span> {category.label}
              </span>
              <span className="text-ink-2">
                <span className="num text-ink">{formatILS(Math.round(value))}</span>
                <span className="num ms-2 text-xs">{Math.round((value / sum) * 100)}%</span>
              </span>
            </div>
            <div className="h-2 rounded-full bg-surface-2">
              <div className="h-2 rounded-full bg-viz" style={{ width: `${(value / max) * 100}%` }} />
            </div>
          </li>
        )
      })}
    </ul>
  )
}
