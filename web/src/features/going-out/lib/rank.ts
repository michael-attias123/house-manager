// The main screen's sections. Pure: the venues and deals come in already
// filtered by RLS (the global catalog plus this household's suggestions).
// A household's pending suggestions show like any other; rejected ones only
// in "ההצעות שלי".
import type { Venue, VenueDeal } from '@/lib/db-types'
import { distanceKm, venuePoint, type LatLng } from './geo'
import { openState, type OpenState } from './hours'
import { isShown, KIND_FILTERS, type KindFilter } from './kinds'
import { dealWindow, jerusalemClock, LATER_MINUTES, parseTime, type DealState, type DealWindow } from './schedule'

export interface Filters {
  kind: KindFilter
  dealsOnly: boolean
}

export const NO_FILTERS: Filters = { kind: 'all', dealsOnly: false }

export interface DealView {
  deal: VenueDeal
  window: DealWindow
}

export interface VenueItem {
  venue: Venue
  /** From the origin; null for a place without a location. */
  distanceKm: number | null
  open: OpenState
  /** The card's deals: on now first; expired ones left out. */
  deals: DealView[]
  /** In "later": minutes until the first start. */
  startsIn: number | null
}

export interface Sections {
  now: VenueItem[]
  later: VenueItem[]
  all: VenueItem[]
}

const STATE_ORDER: Record<DealState, number> = { active: 0, later: 1, upcoming: 2, today_over: 3, not_today: 4 }


function byWhen(a: DealView, b: DealView) {
  return (
    STATE_ORDER[a.window.state] - STATE_ORDER[b.window.state] ||
    (a.window.startsIn ?? 0) - (b.window.startsIn ?? 0) ||
    a.deal.title.localeCompare(b.deal.title, 'he')
  )
}

export function dealViews(deals: VenueDeal[], now: Date): DealView[] {
  return deals.map((deal) => ({ deal, window: dealWindow(deal, now) }))
}

/**
 * A card's deals, and the place page's list: by when they're on (active,
 * later, other days). Rejected and expired ones are left out.
 */
export function sheetDeals(deals: VenueDeal[], now: Date): DealView[] {
  return dealViews(deals.filter(isShown), now)
    .filter((d) => !d.window.expired)
    .sort(byWhen)
}

/** Minutes from now until a closed place opens, when that's known. */
function opensIn(open: OpenState, now: Date): number | null {
  const at = parseTime(open.opensAt)
  if (open.state !== 'closed' || at == null || open.opensInDays == null) return null
  return open.opensInDays * 1440 + at - jerusalemClock(now).minutes
}

const nearestFirst = (a: VenueItem, b: VenueItem) =>
  (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity) || a.venue.name.localeCompare(b.venue.name, 'he')

const OPEN_ORDER = { open: 0, unknown: 1, closed: 2 }

export function buildSections(
  venues: Venue[],
  deals: VenueDeal[],
  origin: LatLng,
  now: Date,
  filters: Filters = NO_FILTERS,
): Sections {
  const byVenue = new Map<number, VenueDeal[]>()
  for (const d of deals.filter(isShown)) byVenue.set(d.venue_id, [...(byVenue.get(d.venue_id) ?? []), d])
  const kinds = KIND_FILTERS.find((f) => f.value === filters.kind)?.kinds ?? null

  const items: VenueItem[] = venues
    .filter((v) => !v.hidden && isShown(v) && (!kinds || kinds.includes(v.kind)))
    .map((venue) => {
      const point = venuePoint(venue)
      return {
        venue,
        distanceKm: point ? distanceKm(origin, point) : null,
        open: openState(venue.opening_hours, now),
        deals: sheetDeals(byVenue.get(venue.id) ?? [], now),
        startsIn: null,
      }
    })
    .filter((item) => !filters.dealsOnly || item.deals.length > 0)

  // Unknown hours never hide a place: only one known to be closed is left out.
  const onNow = items
    .filter((i) => i.open.state !== 'closed' && i.deals.some((d) => d.window.state === 'active'))
    .sort(nearestFirst)
  const inNow = new Set(onNow.map((i) => i.venue.id))

  const later: VenueItem[] = []
  for (const item of items) {
    if (inNow.has(item.venue.id)) continue
    const starts = item.deals
      .filter((d) => d.window.state === 'later')
      .map((d) => d.window.startsIn!)
      // Same rule as "now", at the start time: left out only if known to be closed then.
      .filter((m) => openState(item.venue.opening_hours, new Date(now.getTime() + m * 60_000)).state !== 'closed')
    // A deal for all of today's opening hours, at a place that opens soon.
    const opening = opensIn(item.open, now)
    if (
      opening != null &&
      opening <= LATER_MINUTES &&
      item.deals.some((d) => d.window.state === 'active' && d.window.start == null)
    ) {
      starts.push(opening)
    }
    if (starts.length > 0) later.push({ ...item, startsIn: Math.min(...starts) })
  }
  later.sort((a, b) => a.startsIn! - b.startsIn! || nearestFirst(a, b))

  const all = [...items].sort(
    (a, b) =>
      Number(a.distanceKm == null) - Number(b.distanceKm == null) ||
      OPEN_ORDER[a.open.state] - OPEN_ORDER[b.open.state] ||
      nearestFirst(a, b),
  )
  return { now: onNow, later, all }
}
