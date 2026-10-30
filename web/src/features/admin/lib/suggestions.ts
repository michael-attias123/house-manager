import type { DealKind, SuggestionStatus, VenueKind } from '@/lib/db-types'
import type { ISODate } from '@/lib/dates'
import type { DealFields } from '@/features/going-out/lib/draft'
import type { VenueDraft } from '@/features/going-out/lib/venueDraft'

/**
 * A row of admin_list_suggestions() (20261101000100_going_out.sql): a pending
 * deal (with its place), or a pending place a household added. Oldest first.
 */
export interface AdminSuggestion {
  item_type: 'deal' | 'venue'
  /** Null on a venue row. */
  deal_id: string | null
  venue_id: number
  venue_name: string
  venue_kind: VenueKind
  venue_status: SuggestionStatus
  venue_lat: number | null
  venue_lng: number | null
  venue_address: string | null
  // The deal's columns; null on a venue row.
  title: string | null
  deal_kind: DealKind | null
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  weekdays: number[] | null
  /** 'HH:MM:SS'; both null = whenever the place is open. */
  starts_at: string | null
  ends_at: string | null
  valid_from: ISODate | null
  valid_until: ISODate | null
  note: string | null
  household_id: string | null
  household_name: string | null
  created_at: string
  /** For a pending place: an approved one with the same normalized name or within 50 m. */
  similar_venue_id: number | null
  similar_venue_name: string | null
  // The rest of the place, so an admin edit keeps what the row doesn't show.
  venue_opening_hours: string | null
  venue_website: string | null
  venue_phone: string | null
  venue_instagram: string | null
}

/** A deal row as the deal form's starting values (call on a deal row only). */
export function suggestionDealFields(s: AdminSuggestion): DealFields {
  return {
    venue_id: s.venue_id,
    title: s.title ?? '',
    kind: s.deal_kind ?? 'happy_hour',
    weekdays: s.weekdays ?? [],
    starts_at: s.starts_at,
    ends_at: s.ends_at,
    valid_from: s.valid_from,
    valid_until: s.valid_until,
    note: s.note,
  }
}

/** The row's place as the place form's starting values. */
export function suggestionVenueDraft(s: AdminSuggestion): VenueDraft {
  return {
    name: s.venue_name,
    kind: s.venue_kind,
    address: s.venue_address ?? '',
    instagram: s.venue_instagram ?? '',
    website: s.venue_website ?? '',
    phone: s.venue_phone ?? '',
    openingHours: s.venue_opening_hours ?? '',
    point: s.venue_lat != null && s.venue_lng != null ? { lat: s.venue_lat, lng: s.venue_lng } : null,
  }
}
