import { supabase, unwrap } from '@/lib/supabase'
import type { Chore, ChoreCompletion } from '@/lib/db-types'
import type { ISODate } from '@/lib/dates'
import type { ChoreUpdate } from './lib/chores'

export async function fetchChores(householdId: string): Promise<Chore[]> {
  return unwrap(
    await supabase
      .from('chores')
      .select('*')
      .eq('household_id', householdId)
      .eq('active', true)
      .order('next_due'),
  ) as Chore[]
}

export async function fetchCompletions(householdId: string, since: ISODate): Promise<ChoreCompletion[]> {
  return unwrap(
    await supabase
      .from('chore_completions')
      .select('*')
      .eq('household_id', householdId)
      .gte('done_on', since)
      .order('done_on', { ascending: false }),
  ) as ChoreCompletion[]
}

export type ChoreInput = Omit<Chore, 'id' | 'active'> & { id?: string }

export async function saveChore(input: ChoreInput): Promise<void> {
  const { id, ...fields } = input
  if (id) unwrap(await supabase.from('chores').update(fields).eq('id', id))
  else unwrap(await supabase.from('chores').insert(fields))
}

export async function archiveChore(id: string): Promise<void> {
  unwrap(await supabase.from('chores').update({ active: false }).eq('id', id))
}

export async function completeChore(chore: Chore, update: ChoreUpdate, doneBy: string, doneOn: ISODate) {
  unwrap(
    await supabase
      .from('chore_completions')
      .insert({ chore_id: chore.id, household_id: chore.household_id, done_by: doneBy, done_on: doneOn }),
  )
  unwrap(await supabase.from('chores').update(update).eq('id', chore.id))
}
