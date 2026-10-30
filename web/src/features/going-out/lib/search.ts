import type { Venue } from '@/lib/db-types'
import { normName } from '@/features/prices/lib/normalize'
import { distanceKm, venuePoint, type LatLng } from './geo'
import type { VenueItem } from './rank'

/** Same rules as SQL public.norm_name, which the server's duplicate check uses too. */
export const venueKey = (name: string) => normName(name)

/**
 * How well a name matches a normalized query: 0 starts with it, 1 has a word
 * that starts with it, 2 contains it; null for no match.
 */
export function matchRank(name: string, q: string): 0 | 1 | 2 | null {
  const key = venueKey(name)
  if (key.startsWith(q)) return 0
  if (` ${key}`.includes(` ${q}`)) return 1
  return key.includes(q) ? 2 : null
}

/** Places to pick from: names that start with the query, then ones that contain it. */
export function searchVenues(venues: Venue[], query: string, limit = 8): Venue[] {
  const q = venueKey(query)
  const pickable = venues.filter((v) => v.status !== 'rejected' && !v.hidden)
  if (!q) return []
  const scored = pickable
    .map((v) => ({ v, rank: matchRank(v.name, q) }))
    .filter((s): s is { v: Venue; rank: 0 | 1 | 2 } => s.rank != null)
  scored.sort((a, b) => a.rank - b.rank || a.v.name.localeCompare(b.v.name, 'he'))
  return scored.slice(0, limit).map((s) => s.v)
}

/**
 * The main screen's search: by name, then by street or cuisine (OSM's
 * "pizza;italian" counts word by word); the better match first, then the
 * nearer place.
 */
export function searchItems(items: VenueItem[], query: string): VenueItem[] {
  const q = venueKey(query)
  if (!q) return []
  const rankOf = ({ venue }: VenueItem) => {
    const byName = matchRank(venue.name, q)
    if (byName != null) return byName
    const other = [venue.address, ...(venue.cuisine?.split(/[;,]/) ?? [])]
    return other.some((text) => text && matchRank(text, q) != null) ? 3 : null
  }
  return items
    .map((item) => ({ item, rank: rankOf(item) }))
    .filter((s): s is { item: VenueItem; rank: number } => s.rank != null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        (a.item.distanceKm ?? Infinity) - (b.item.distanceKm ?? Infinity) ||
        a.item.venue.name.localeCompare(b.item.venue.name, 'he'),
    )
    .map((s) => s.item)
}

/** "Within this" counts as the same spot when adding a place. */
export const SAME_SPOT_KM = 0.05

/** A place in the catalog that looks like the new one: the same name, or within 50 m. */
export function findSimilar(venues: Venue[], name: string, point: LatLng | null): Venue | null {
  const key = venueKey(name)
  const candidates = venues.filter((v) => v.status !== 'rejected' && !v.hidden)
  const sameName = key ? candidates.find((v) => venueKey(v.name) === key) : undefined
  if (sameName) return sameName
  if (!point) return null
  let best: { v: Venue; km: number } | null = null
  for (const v of candidates) {
    const p = venuePoint(v)
    if (!p) continue
    const km = distanceKm(point, p)
    if (km <= SAME_SPOT_KM && (!best || km < best.km)) best = { v, km }
  }
  return best?.v ?? null
}

/** An Instagram handle or link → a link. */
export function instagramUrl(value: string): string {
  const v = value.trim()
  if (/^https?:\/\//i.test(v)) return v
  return `https://instagram.com/${encodeURIComponent(v.replace(/^@/, '').replace(/\/+$/, ''))}`
}

/** A website as typed in OSM ("example.com") → a link. */
export function websiteUrl(value: string): string {
  const v = value.trim()
  return /^https?:\/\//i.test(v) ? v : `https://${v}`
}

export function wazeUrl(p: LatLng): string {
  return `https://waze.com/ul?ll=${p.lat},${p.lng}&navigate=yes`
}

export function mapsUrl(p: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`
}
