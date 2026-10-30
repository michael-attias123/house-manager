import { supabase, unwrap } from '@/lib/supabase'
import type { Venue, VenueDeal, VenueFavorite } from '@/lib/db-types'
import { adminDealArgs, type DealFields } from './lib/draft'
import { goingOutErrorMessage } from './lib/errors'
import { adminVenueArgs, memberVenueFields, type VenueFields } from './lib/venueDraft'

/** unwrap(), with the server's error in Hebrew. */
function check<T>(result: { data: T; error: { message: string } | null }): T {
  if (result.error) throw new Error(goingOutErrorMessage(result.error.message))
  return result.data
}

// RLS decides what comes back: the global catalog (not hidden) plus this
// household's own suggestions; approved deals plus this household's.

export async function fetchVenues(): Promise<Venue[]> {
  return unwrap(await supabase.from('venues').select('*').order('name')) as Venue[]
}

export async function fetchDeals(): Promise<VenueDeal[]> {
  return unwrap(await supabase.from('venue_deals').select('*').order('created_at')) as VenueDeal[]
}

export async function fetchFavorites(householdId: string): Promise<number[]> {
  const rows = unwrap(
    await supabase.from('venue_favorites').select('venue_id').eq('household_id', householdId),
  ) as Pick<VenueFavorite, 'venue_id'>[]
  return rows.map((r) => r.venue_id)
}

export async function addFavorite(householdId: string, venueId: number): Promise<void> {
  check(
    await supabase
      .from('venue_favorites')
      .upsert({ household_id: householdId, venue_id: venueId }, { onConflict: 'household_id,venue_id', ignoreDuplicates: true }),
  )
}

export async function removeFavorite(householdId: string, venueId: number): Promise<void> {
  check(await supabase.from('venue_favorites').delete().eq('household_id', householdId).eq('venue_id', venueId))
}

export type NewDeal = DealFields & Pick<VenueDeal, 'id' | 'household_id' | 'created_by'>

/** A suggestion: pending, seen at once by the household, by everyone once approved. */
export async function addDeal(deal: NewDeal): Promise<void> {
  check(await supabase.from('venue_deals').insert({ ...deal, status: 'pending' }))
}

/** Several suggestions at once (the AI import): pending, like addDeal. */
export async function addDeals(deals: NewDeal[]): Promise<void> {
  check(await supabase.from('venue_deals').insert(deals.map((d) => ({ ...d, status: 'pending' }))))
}

/** An admin's import: approved for everyone at once, all or nothing (admin_add_deals). */
export async function adminAddDeals(deals: DealFields[]): Promise<number> {
  return check(await supabase.rpc('admin_add_deals', { p_deals: deals })) as number
}

/**
 * Only the household's own deals that aren't approved can change (RLS). A
 * rejected one goes back to pending on the server, its review note kept.
 */
export async function updateDeal(id: string, patch: Partial<DealFields>): Promise<void> {
  check(await supabase.from('venue_deals').update(patch).eq('id', id))
}

export async function deleteDeal(id: string): Promise<void> {
  check(await supabase.from('venue_deals').delete().eq('id', id))
}

export type NewVenue = ReturnType<typeof memberVenueFields> & Pick<Venue, 'household_id' | 'created_by'>

/** A place the household adds: pending until an admin approves it. */
export async function addVenue(venue: NewVenue): Promise<Venue> {
  return check(
    await supabase
      .from('venues')
      .insert({ ...venue, source: 'community', status: 'pending' })
      .select()
      .single(),
  ) as Venue
}

/** The household's own suggested place, while not approved (RLS); rejected → pending again, like a deal. */
export async function updateVenue(id: number, fields: VenueFields): Promise<void> {
  check(await supabase.from('venues').update(memberVenueFields(fields)).eq('id', id))
}

/** Its deals go with it (on delete cascade). */
export async function deleteVenue(id: number): Promise<void> {
  check(await supabase.from('venues').delete().eq('id', id))
}

export interface MySuggestionRows {
  venues: Venue[]
  deals: VenueDeal[]
}

/**
 * "ההצעות שלי": every deal the household wrote, and every place it added,
 * including approved ones (suggested_household_id stays after approval).
 */
export async function fetchMySuggestions(householdId: string): Promise<MySuggestionRows> {
  const [deals, venues] = await Promise.all([
    supabase.from('venue_deals').select('*').eq('household_id', householdId).order('created_at', { ascending: false }),
    supabase
      .from('venues')
      .select('*')
      .or(`household_id.eq.${householdId},suggested_household_id.eq.${householdId}`)
      .order('created_at', { ascending: false }),
  ])
  return { deals: check(deals) as VenueDeal[], venues: check(venues) as Venue[] }
}

// Admin edits (security definer, is_admin() on the server). Any status; the
// status stays as it is.

export async function adminUpdateDeal(id: string, fields: DealFields): Promise<void> {
  check(await supabase.rpc('admin_update_deal', adminDealArgs(id, fields)))
}

export async function adminUpdateVenue(id: number, fields: VenueFields): Promise<void> {
  check(await supabase.rpc('admin_update_venue', adminVenueArgs(id, fields)))
}

export async function adminDeleteDeal(id: string): Promise<void> {
  check(await supabase.rpc('admin_delete_deal', { p_id: id }))
}

export async function adminHideVenue(id: number, hidden: boolean): Promise<void> {
  check(await supabase.rpc('admin_hide_venue', { p_id: id, p_hidden: hidden }))
}

/** "עדיין בתוקף?": once per 12 hours per deal; sooner is a no-op on the server. */
export async function confirmDeal(id: string): Promise<void> {
  check(await supabase.rpc('confirm_deal', { p_id: id }))
}
