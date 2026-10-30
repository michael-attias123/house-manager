import { Star } from 'lucide-react'
import { isPerk, venueKind } from '../lib/kinds'
import type { VenueItem } from '../lib/rank'
import { DealChip } from './DealChip'
import { Distance, OpenLabel, openTone } from './Labels'

const SHOWN_DEALS = 2

/** A place in a list; the whole card opens its page. */
export function VenueCard({ item, now, onOpen }: { item: VenueItem; now: Date; onOpen: () => void }) {
  const { venue, memberCard } = item
  const deals = item.deals.filter((d) => !isPerk(d.deal))
  const kind = venueKind(venue.kind)
  return (
    <button
      type="button"
      onClick={onOpen}
      className="block w-full space-y-2 rounded-2xl border border-line bg-surface p-3 text-start active:bg-surface-2"
    >
      <div className="flex items-start gap-2">
        <span className="text-xl leading-6" aria-hidden>
          {kind.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1 font-semibold">
            <span className="truncate">{venue.name}</span>
            {item.favorite && (
              <Star size={14} className="shrink-0 fill-amber-400 text-amber-500" aria-label="במועדפים" />
            )}
          </p>
          <p className="text-xs text-ink-2">
            {kind.label} · <Distance km={item.distanceKm} />
          </p>
        </div>
        <span className={`shrink-0 text-xs ${openTone(item.open)}`}>
          <OpenLabel open={item.open} now={now} />
        </span>
      </div>
      {(deals.length > 0 || memberCard) && (
        <div className="space-y-1">
          {deals.slice(0, SHOWN_DEALS).map((view) => (
            <DealChip key={view.deal.id} view={view} />
          ))}
          {deals.length > SHOWN_DEALS && (
            <p className="text-xs text-ink-3">
              ועוד <span className="num">{deals.length - SHOWN_DEALS}</span>
            </p>
          )}
          {memberCard && (
            <span className="flex min-w-0 items-center gap-1.5 rounded-lg bg-surface-2 px-2 py-1 text-sm">
              <span aria-hidden>💳</span>
              <span className="shrink-0 text-ink-2">כרטיס חבר:</span>
              <span className="min-w-0 truncate">{memberCard.deal.title}</span>
            </span>
          )}
        </div>
      )}
    </button>
  )
}
