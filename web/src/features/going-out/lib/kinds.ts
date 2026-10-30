import type { DealKind, SuggestionStatus, VenueKind } from '@/lib/db-types'

export const VENUE_KINDS: { value: VenueKind; label: string; emoji: string }[] = [
  { value: 'bar', label: 'בר', emoji: '🍸' },
  { value: 'pub', label: 'פאב', emoji: '🍺' },
  { value: 'restaurant', label: 'מסעדה', emoji: '🍽️' },
  { value: 'cafe', label: 'בית קפה', emoji: '☕' },
  { value: 'nightclub', label: 'מועדון', emoji: '🎶' },
  { value: 'other', label: 'אחר', emoji: '📍' },
]

export const DEAL_KINDS: { value: DealKind; label: string; emoji: string }[] = [
  { value: 'happy_hour', label: 'Happy hour', emoji: '🍻' },
  { value: 'special_day', label: 'יום מיוחד', emoji: '📅' },
  { value: 'event', label: 'אירוע חד־פעמי', emoji: '⭐' },
]

export const venueKind = (kind: VenueKind) => VENUE_KINDS.find((k) => k.value === kind) ?? VENUE_KINDS[5]
export const dealKind = (kind: DealKind) => DEAL_KINDS.find((k) => k.value === kind) ?? DEAL_KINDS[0]

/** The filter chips: bars include pubs and clubs; "other" shows only under "הכל". */
export type KindFilter = 'all' | 'bars' | 'restaurants' | 'cafes'

export const KIND_FILTERS: { value: KindFilter; label: string; kinds: VenueKind[] | null }[] = [
  { value: 'all', label: 'הכל', kinds: null },
  { value: 'bars', label: 'ברים', kinds: ['bar', 'pub', 'nightclub'] },
  { value: 'restaurants', label: 'מסעדות', kinds: ['restaurant'] },
  { value: 'cafes', label: 'בתי קפה', kinds: ['cafe'] },
]

/**
 * Shown on the going-out screens: anything but a rejected suggestion. The
 * household's pending ones show like the rest, without a tag; their status
 * is in "ההצעות שלי".
 */
export const isShown = (row: { status: SuggestionStatus }) => row.status !== 'rejected'
