import { useState } from 'react'
import { formatMonth, formatShortMonth } from '@/lib/dates'
import { formatILS } from '@/lib/money'
import { cn } from '@/lib/cn'

interface MonthlyTrendProps {
  data: { month: string; total: number }[]
}

/**
 * Household spending per month as columns (single series, one hue). Tap or
 * hover a column to read its value; the latest month is selected by default.
 */
export function MonthlyTrend({ data }: MonthlyTrendProps) {
  const [selected, setSelected] = useState(data.length - 1)
  const max = Math.max(1, ...data.map((d) => d.total))
  const current = data[selected]

  return (
    <figure className="space-y-3">
      <figcaption className="flex items-baseline justify-between">
        <span className="text-sm text-ink-2">{current ? formatMonth(current.month) : ''}</span>
        <span className="num text-xl font-semibold">{current ? formatILS(Math.round(current.total)) : ''}</span>
      </figcaption>
      <div className="flex h-36 items-end gap-2 border-b border-line" role="list">
        {data.map((d, i) => (
          <button
            key={d.month}
            type="button"
            role="listitem"
            aria-label={`${formatMonth(d.month)}: ${formatILS(Math.round(d.total))}`}
            aria-pressed={i === selected}
            onClick={() => setSelected(i)}
            onMouseEnter={() => setSelected(i)}
            onFocus={() => setSelected(i)}
            className="group flex h-full flex-1 items-end"
          >
            <span
              className={cn(
                'block w-full rounded-t-[4px] bg-viz transition-opacity',
                i === selected ? 'opacity-100 ring-2 ring-ink ring-offset-2 ring-offset-surface' : 'opacity-80',
              )}
              style={{ height: `${Math.max(2, (d.total / max) * 100)}%` }}
            />
          </button>
        ))}
      </div>
      <div className="flex gap-2 text-center text-xs text-ink-3">
        {data.map((d) => (
          <span key={d.month} className="flex-1">
            {formatShortMonth(d.month)}
          </span>
        ))}
      </div>
    </figure>
  )
}
