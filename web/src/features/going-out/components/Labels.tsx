import type { SuggestionStatus, VenueDeal } from '@/lib/db-types'
import { cn } from '@/lib/cn'
import { formatDay, WEEKDAY_LABELS } from '@/lib/dates'
import { distanceParts } from '../lib/geo'
import type { OpenState } from '../lib/hours'
import { statusTag } from '../lib/kinds'
import { daysLabel, jerusalemClock, type DealWindow } from '../lib/schedule'

/** "350 מ׳", or "מיקום לא ידוע" for a place without a location. */
export function Distance({ km }: { km: number | null }) {
  if (km == null) return <>מיקום לא ידוע</>
  const [value, unit] = distanceParts(km)
  return (
    <>
      <span className="num">{value}</span> {unit}
    </>
  )
}

/** "ממתין לאישור" / "לא אושר" on the household's own suggestions. */
export function StatusTag({ status, className }: { status: SuggestionStatus; className?: string }) {
  const tag = statusTag(status)
  if (!tag) return null
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium',
        status === 'pending'
          ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
          : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
        className,
      )}
    >
      {tag}
    </span>
  )
}

/** "פתוח עד 01:00" / "סגור · נפתח 18:00" / "שעות לא ידועות". */
export function OpenLabel({ open, now }: { open: OpenState; now: Date }) {
  if (open.state === 'open') {
    return open.closesAt ? (
      <>
        פתוח עד <span className="num">{open.closesAt}</span>
      </>
    ) : (
      <>פתוח</>
    )
  }
  if (open.state === 'closed') {
    if (!open.opensAt) return <>סגור</>
    const days = open.opensInDays ?? 0
    const when =
      days === 0 ? '' : days === 1 ? 'מחר ' : `ביום ${WEEKDAY_LABELS[(jerusalemClock(now).weekday + days) % 7]} `
    return (
      <>
        סגור · נפתח {when}
        <span className="num">{open.opensAt}</span>
      </>
    )
  }
  return <>שעות לא ידועות</>
}

export const openTone = (open: OpenState) =>
  open.state === 'open' ? 'text-brand-700 dark:text-brand-200' : 'text-ink-3'

/** The days a deal runs: "א׳ ג׳ ה׳" / "כל יום", or an event's date. */
export function DealDays({ deal }: { deal: Pick<VenueDeal, 'kind' | 'weekdays' | 'valid_from'> }) {
  if (deal.kind === 'event' && deal.valid_from) return <>{formatDay(deal.valid_from)}</>
  return <>{daysLabel(deal.weekdays)}</>
}

/** On a chip: "עד 21:00" while on, "מ־19:00" before, otherwise the days. */
export function DealWhen({ deal, window }: { deal: VenueDeal; window: DealWindow }) {
  if (window.state === 'active') {
    return window.end ? (
      <>
        עד <span className="num">{window.end}</span>
      </>
    ) : (
      <>היום</>
    )
  }
  if ((window.state === 'later' || window.state === 'upcoming') && window.start) {
    return (
      <>
        מ־<span className="num">{window.start}</span>
      </>
    )
  }
  return <DealDays deal={deal} />
}
