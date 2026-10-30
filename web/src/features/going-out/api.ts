import { supabase, unwrap } from '@/lib/supabase'
import type { Venue, VenueDeal } from '@/lib/db-types'
import type { DealFields } from './lib/draft'
import { goingOutErrorMessage } from './lib/errors'

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

export type NewDeal = DealFields & Pick<VenueDeal, 'id' | 'household_id' | 'created_by'>

/** A suggestion: pending, seen at once by the household, by everyone once approved. */
export async function addDeal(deal: NewDeal): Promise<void> {
  check(await supabase.from('venue_deals').insert({ ...deal, status: 'pending' }))
}

/** Only the household's own deals that aren't approved can change (RLS). */
export async function updateDeal(id: string, patch: Partial<DealFields>): Promise<void> {
  check(await supabase.from('venue_deals').update(patch).eq('id', id))
}

export async function deleteDeal(id: string): Promise<void> {
  check(await supabase.from('venue_deals').delete().eq('id', id))
}

export type NewVenue = Pick<Venue, 'name' | 'kind' | 'lat' | 'lng' | 'address' | 'instagram' | 'household_id' | 'created_by'>

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

/** "עדיין בתוקף?": once per 12 hours per deal; sooner is a no-op on the server. */
export async function confirmDeal(id: string): Promise<void> {
  check(await supabase.rpc('confirm_deal', { p_id: id }))
}
