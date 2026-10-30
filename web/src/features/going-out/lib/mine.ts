// "ההצעות שלי": the household's suggested deals and places, by status. Pure.
import type { SuggestionStatus, Venue, VenueDeal } from '@/lib/db-types'

export interface MySuggestion {
  /** Unique across both kinds: 'deal:<uuid>' / 'venue:<id>'. */
  key: string
  status: SuggestionStatus
  /** The place: the suggested one, or the deal's. Null when it can't be seen any more (hidden). */
  venue: Venue | null
  /** Null for a suggested place. */
  deal: VenueDeal | null
  /** The admin's note: on a rejected one, or kept from the last rejection while it waits again. */
  reviewNote: string | null
  createdAt: string
}

export const STATUSES: SuggestionStatus[] = ['pending', 'approved', 'rejected']

/**
 * The household's suggestions, newest first. `mine` comes from
 * fetchMySuggestions; `catalog` (every place the household sees) names the
 * places of deals at places it didn't add.
 */
export function mySuggestions(mine: { venues: Venue[]; deals: VenueDeal[] }, catalog: Venue[]): MySuggestion[] {
  const places = new Map([...catalog, ...mine.venues].map((v) => [v.id, v]))
  const items: MySuggestion[] = [
    ...mine.venues.map((v) => ({
      key: `venue:${v.id}`,
      status: v.status,
      venue: v,
      deal: null,
      reviewNote: v.review_note,
      createdAt: v.created_at,
    })),
    ...mine.deals.map((d) => ({
      key: `deal:${d.id}`,
      status: d.status,
      venue: places.get(d.venue_id) ?? null,
      deal: d,
      reviewNote: d.review_note,
      createdAt: d.created_at,
    })),
  ]
  return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function groupByStatus(items: MySuggestion[]): Record<SuggestionStatus, MySuggestion[]> {
  const groups: Record<SuggestionStatus, MySuggestion[]> = { pending: [], approved: [], rejected: [] }
  for (const item of items) groups[item.status].push(item)
  return groups
}

const WORDS: Record<SuggestionStatus, [one: string, many: string]> = {
  pending: ['ממתינה', 'ממתינות'],
  approved: ['אושרה', 'אושרו'],
  rejected: ['לא אושרה', 'לא אושרו'],
}

/** The Settings card's line, as [count, word] parts: "2 ממתינות · 1 לא אושרה". Empty when there's nothing. */
export function summaryParts(groups: Record<SuggestionStatus, MySuggestion[]>): [number, string][] {
  return STATUSES.filter((s) => groups[s].length > 0).map((s) => {
    const n = groups[s].length
    return [n, WORDS[s][n === 1 ? 0 : 1]]
  })
}

export interface AdminReply {
  /** "תגובת המנהל" / "התגובה הקודמת של המנהל"; null when the text says it all. */
  label: string | null
  text: string
}

/** The highlighted box: what the admin said, if anything was said or decided. */
export function adminReply(item: Pick<MySuggestion, 'status' | 'reviewNote'>): AdminReply | null {
  const note = item.reviewNote?.trim() || null
  if (item.status === 'rejected') return note ? { label: 'תגובת המנהל', text: note } : { label: null, text: 'לא אושר, בלי הערה' }
  if (!note) return null
  // Sent again after a rejection: the note stays until the next review.
  return { label: item.status === 'pending' ? 'התגובה הקודמת של המנהל' : 'תגובת המנהל', text: note }
}

/** Only a suggestion that isn't approved yet can change (RLS). */
export const canEdit = (item: Pick<MySuggestion, 'status'>) => item.status !== 'approved'
