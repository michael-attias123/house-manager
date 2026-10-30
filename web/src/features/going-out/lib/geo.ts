export interface LatLng {
  lat: number
  lng: number
}

/** The city: distances fall back to its center when the phone's location can't be used. */
export const BEER_SHEVA = {
  center: { lat: 31.252, lng: 34.7915 },
  bbox: { south: 31.2, west: 34.73, north: 31.3, east: 34.86 },
} as const

const EARTH_RADIUS_KM = 6371.0088
const rad = (deg: number) => (deg * Math.PI) / 180

/** Great-circle distance (haversine). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function inBeerSheva(p: LatLng): boolean {
  const { south, west, north, east } = BEER_SHEVA.bbox
  return p.lat >= south && p.lat <= north && p.lng >= west && p.lng <= east
}

/** A place's position, or null when it was added without one. */
export function venuePoint(v: { lat: number | null; lng: number | null }): LatLng | null {
  return v.lat == null || v.lng == null ? null : { lat: v.lat, lng: v.lng }
}

/** [value, unit]: ['350', 'מ׳'], ['1.2', 'ק״מ']. The UI wraps the value in `.num`. */
export function distanceParts(km: number): [string, string] {
  const meters = Math.round(km * 100) * 10
  if (meters < 1000) return [String(Math.max(10, meters)), 'מ׳']
  const tenths = Math.round(km * 10) / 10
  if (tenths < 10) return [tenths.toFixed(1), 'ק״מ']
  return [String(Math.round(km)), 'ק״מ']
}

/** "350 מ׳", "1.2 ק״מ". */
export function formatDistance(km: number): string {
  return distanceParts(km).join(' ')
}
