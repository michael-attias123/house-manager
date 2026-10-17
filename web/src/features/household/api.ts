import { supabase, unwrap } from '@/lib/supabase'
import type { Household, HouseholdMember } from '@/lib/db-types'

export async function fetchMyHousehold(userId: string): Promise<Household | null> {
  const rows = unwrap(
    await supabase
      .from('household_members')
      .select('joined_at, households(*)')
      .eq('user_id', userId)
      .order('joined_at')
      .limit(1),
  ) as unknown as { households: Household }[]
  return rows[0]?.households ?? null
}

export async function fetchMembers(householdId: string): Promise<HouseholdMember[]> {
  return unwrap(
    await supabase
      .from('household_members')
      .select('*')
      .eq('household_id', householdId)
      .order('joined_at'),
  ) as HouseholdMember[]
}

export async function createHousehold(name: string, displayName: string): Promise<Household> {
  return unwrap(
    await supabase.rpc('create_household', { p_name: name, p_display_name: displayName }),
  ) as Household
}

export async function joinHousehold(inviteCode: string, displayName: string): Promise<Household> {
  const result = await supabase.rpc('join_household', {
    p_invite_code: inviteCode,
    p_display_name: displayName,
  })
  if (result.error?.message.includes('invalid invite code')) {
    throw new Error('קוד ההזמנה לא נמצא. כדאי לבדוק אותו שוב.')
  }
  return unwrap(result) as Household
}

export async function updateMember(
  householdId: string,
  userId: string,
  patch: Partial<Pick<HouseholdMember, 'display_name' | 'color' | 'default_share_pct'>>,
) {
  unwrap(
    await supabase
      .from('household_members')
      .update(patch)
      .eq('household_id', householdId)
      .eq('user_id', userId),
  )
}

export async function renameHousehold(householdId: string, name: string) {
  unwrap(await supabase.from('households').update({ name }).eq('id', householdId))
}

export async function regenerateInviteCode(householdId: string): Promise<string> {
  return unwrap(
    await supabase.rpc('regenerate_invite_code', { p_household_id: householdId }),
  ) as string
}
