// The home screen card's numbers. Schedule only: the card never loads the
// opening-hours reader, so it doesn't know whether a place is open.
import type { Venue, VenueDeal } from '@/lib/db-types'
import { distanceKm, venuePoint, type LatLng } from './geo'
import { isShown } from './kinds'
import { dealWindow, type DealWindow } from './schedule'

export interface TonightDeal {
  venue: Venue
  deal: VenueDeal
  window: DealWindow
  distanceKm: number | null
}

export interface Tonight {
  active: number
  later: number
  /** The nearest deal on now; else the next to start. */
  pick: TonightDeal | null
}

export function tonight(venues: Venue[], deals: VenueDeal[], origin: LatLng, now: Date): Tonight {
  const byId = new Map(venues.filter((v) => !v.hidden && isShown(v)).map((v) => [v.id, v]))
  const all: TonightDeal[] = []
  for (const deal of deals) {
    const venue = byId.get(deal.venue_id)
    if (!venue || !isShown(deal)) continue
    const point = venuePoint(venue)
    all.push({ venue, deal, window: dealWindow(deal, now), distanceKm: point ? distanceKm(origin, point) : null })
  }
  const on = all.filter((d) => d.window.state === 'active')
  const later = all.filter((d) => d.window.state === 'later')
  const upcoming = all.filter((d) => d.window.state === 'upcoming')
  const nearest = (a: TonightDeal, b: TonightDeal) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
  const soonest = (a: TonightDeal, b: TonightDeal) => a.window.startsIn! - b.window.startsIn! || nearest(a, b)
  const pick = on.sort(nearest)[0] ?? later.sort(soonest)[0] ?? upcoming.sort(soonest)[0] ?? null
  return { active: on.length, later: later.length, pick }
}
