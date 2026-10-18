import { Link } from 'react-router-dom'
import { cn } from '@/lib/cn'
import type { Insight } from '../types'

const toneStyles: Record<Insight['tone'], { className: string; label: string }> = {
  warning: { className: 'border-s-amber-500', label: 'לתשומת לב' },
  tip: { className: 'border-s-brand-600', label: 'טיפ' },
  good: { className: 'border-s-emerald-500', label: 'כל הכבוד' },
  info: { className: 'border-s-slate-400', label: 'לידיעה' },
}

export function InsightCard({ insight }: { insight: Insight }) {
  const tone = toneStyles[insight.tone]
  return (
    <article className={cn('flex gap-3 rounded-2xl border border-line border-s-4 bg-surface p-3', tone.className)}>
      <span className="text-2xl" aria-hidden>
        {insight.icon}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-xs text-ink-3">{tone.label}</p>
        <h3 className="font-medium leading-snug">{insight.title}</h3>
        {insight.body && <p className="text-sm text-ink-2">{insight.body}</p>}
        {insight.link && (
          <Link to={insight.link.to} className="inline-block text-sm font-medium text-brand-700 dark:text-brand-200">
            {insight.link.label} ←
          </Link>
        )}
      </div>
    </article>
  )
}
