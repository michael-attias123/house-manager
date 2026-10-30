import { venueKind } from '../lib/kinds'
import type { VenueItem } from '../lib/rank'
import { DealChip } from './DealChip'
import { Distance, OpenLabel, openTone, StatusTag } from './Labels'

const SHOWN_DEALS = 2

/** A place in a list; the whole card opens its page. */
export function VenueCard({ item, now, onOpen }: { item: VenueItem; now: Date; onOpen: () => void }) {
  const { venue, deals } = item
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
          <div className="flex items-center gap-2">
            <span className="truncate font-semibold">{venue.name}</span>
            <StatusTag status={venue.status} />
          </div>
          <p className="text-xs text-ink-2">
            {kind.label} · <Distance km={item.distanceKm} />
          </p>
        </div>
        <span className={`shrink-0 text-xs ${openTone(item.open)}`}>
          <OpenLabel open={item.open} now={now} />
        </span>
      </div>
      {deals.length > 0 && (
        <div className="space-y-1">
          {deals.slice(0, SHOWN_DEALS).map((view) => (
            <DealChip key={view.deal.id} view={view} />
          ))}
          {deals.length > SHOWN_DEALS && (
            <p className="text-xs text-ink-3">
              ועוד <span className="num">{deals.length - SHOWN_DEALS}</span>
            </p>
          )}
        </div>
      )}
    </button>
  )
}
