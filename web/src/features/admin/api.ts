import { supabase } from '@/lib/supabase'
import type { AdminHousehold, AdminUser, AllowedEmail, IngestRun } from '@/lib/db-types'
import { adminErrorMessage, normalizeEmail } from './lib/admin'

// The admin_* RPCs (20261021000300_admin.sql) check is_admin() on the server;
// these only call them and turn their errors into Hebrew.
async function call<T>(name: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(name, args)
  if (error) throw new Error(adminErrorMessage(error.message))
  return data as T
}

export async function fetchIsAdmin(): Promise<boolean> {
  return (await call<boolean | null>('is_admin')) === true
}

export async function fetchAllowedEmails(): Promise<AllowedEmail[]> {
  return (await call<AllowedEmail[] | null>('admin_list_allowed_emails')) ?? []
}

export async function addAllowedEmail(email: string, note: string): Promise<AllowedEmail> {
  return call<AllowedEmail>('admin_add_allowed_email', { p_email: normalizeEmail(email), p_note: note.trim() || null })
}

export async function removeAllowedEmail(email: string): Promise<void> {
  await call('admin_remove_allowed_email', { p_email: email })
}

export async function fetchAdminHouseholds(): Promise<AdminHousehold[]> {
  const rows = (await call<AdminHousehold[] | null>('admin_list_households')) ?? []
  return rows.map((h) => ({
    ...h,
    members: h.members ?? [],
    expense_count: Number(h.expense_count),
    bill_count: Number(h.bill_count),
    chore_count: Number(h.chore_count),
    list_item_count: Number(h.list_item_count),
  }))
}

export async function deleteHousehold(householdId: string): Promise<void> {
  await call('admin_delete_household', { p_household_id: householdId })
}

export async function removeMember(householdId: string, userId: string): Promise<void> {
  await call('admin_remove_member', { p_household_id: householdId, p_user_id: userId })
}

export async function fetchAdminUsers(): Promise<AdminUser[]> {
  const rows = (await call<AdminUser[] | null>('admin_list_users')) ?? []
  return rows.map((u) => ({ ...u, household_names: u.household_names ?? [] }))
}

export async function deleteUser(userId: string): Promise<void> {
  await call('admin_delete_user', { p_user_id: userId })
}

/** ingest_runs is readable by every signed-in user; newest first. */
export async function fetchIngestRuns(limit = 10): Promise<IngestRun[]> {
  const { data, error } = await supabase
    .from('ingest_runs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(adminErrorMessage(error.message))
  return data as IngestRun[]
}
