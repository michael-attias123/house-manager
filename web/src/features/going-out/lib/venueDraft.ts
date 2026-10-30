// The place form's fields, their check, and the columns they become.
import type { Venue, VenueKind } from '@/lib/db-types'
import { venuePoint, type LatLng } from './geo'

export interface VenueDraft {
  name: string
  kind: VenueKind
  address: string
  instagram: string
  // Shown to an admin only; kept as they are otherwise.
  website: string
  phone: string
  /** The OSM opening_hours string. */
  openingHours: string
  /** The saved location, if any. */
  point: LatLng | null
}

export const NAME_MIN = 2

export function emptyVenueDraft(name = ''): VenueDraft {
  return { name, kind: 'bar', address: '', instagram: '', website: '', phone: '', openingHours: '', point: null }
}

export function venueDraftFrom(v: Venue): VenueDraft {
  return {
    name: v.name,
    kind: v.kind,
    address: v.address ?? '',
    instagram: v.instagram ?? '',
    website: v.website ?? '',
    phone: v.phone ?? '',
    openingHours: v.opening_hours ?? '',
    point: venuePoint(v),
  }
}

export const venueNameOk = (d: VenueDraft) => d.name.trim().length >= NAME_MIN

export type VenueFields = Pick<
  Venue,
  'name' | 'kind' | 'lat' | 'lng' | 'address' | 'instagram' | 'website' | 'phone' | 'opening_hours'
>

const text = (s: string) => s.trim() || null

/** The columns to save, at `point` (the form decides: kept, the phone's, or none). */
export function venueFields(d: VenueDraft, point: LatLng | null): VenueFields {
  return {
    name: d.name.trim(),
    kind: d.kind,
    lat: point?.lat ?? null,
    lng: point?.lng ?? null,
    address: text(d.address),
    instagram: text(d.instagram),
    website: text(d.website),
    phone: text(d.phone),
    opening_hours: text(d.openingHours),
  }
}

/** What a household writes itself: a new place, or an edit of its own suggestion. */
export function memberVenueFields(f: VenueFields) {
  const { name, kind, lat, lng, address, instagram } = f
  return { name, kind, lat, lng, address, instagram }
}

/** admin_update_venue's arguments. */
export function adminVenueArgs(id: number, f: VenueFields) {
  return {
    p_id: id,
    p_name: f.name,
    p_kind: f.kind,
    p_address: f.address,
    p_opening_hours: f.opening_hours,
    p_website: f.website,
    p_phone: f.phone,
    p_instagram: f.instagram,
    p_lat: f.lat,
    p_lng: f.lng,
  }
}
