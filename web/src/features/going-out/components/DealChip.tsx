import { dealKind } from '../lib/kinds'
import type { DealView } from '../lib/rank'
import { DealWhen } from './Labels'

/** 🍻 Happy hour · עד 21:00. */
export function DealChip({ view }: { view: DealView }) {
  const { deal, window } = view
  const on = window.state === 'active'
  return (
    <span className="flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-sm">
      <span aria-hidden>{dealKind(deal.kind).emoji}</span>
      <span className="min-w-0 truncate">{deal.title}</span>
      <span className={on ? 'shrink-0 text-brand-700 dark:text-brand-200' : 'shrink-0 text-ink-3'}>
        · <DealWhen deal={deal} window={window} />
      </span>
    </span>
  )
}
