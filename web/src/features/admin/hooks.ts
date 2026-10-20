import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { householdKeys, useHousehold } from '@/features/household/HouseholdProvider'
import {
  addAllowedEmail,
  deleteHousehold,
  deleteUser,
  fetchAdminHouseholds,
  fetchAdminUsers,
  fetchAllowedEmails,
  fetchIngestRuns,
  fetchIsAdmin,
  removeAllowedEmail,
  removeMember,
} from './api'

// Everything under ['admin', ...] is left out of the offline cache (main.tsx).
export const adminKeys = {
  all: ['admin'] as const,
  emails: ['admin', 'emails'] as const,
  households: ['admin', 'households'] as const,
  users: ['admin', 'users'] as const,
  ingest: ['admin', 'ingest'] as const,
}

/** Only decides what to show: the server checks is_admin() on every admin call. */
export function useIsAdmin() {
  const { user } = useHousehold()
  return useQuery({
    queryKey: ['is-admin', user.id],
    // Any error (offline, migration not run yet) counts as "not admin".
    queryFn: () => fetchIsAdmin().catch(() => false),
    staleTime: 10 * 60_000,
  })
}

export function useAllowedEmails() {
  return useQuery({ queryKey: adminKeys.emails, queryFn: fetchAllowedEmails })
}

export function useAdminHouseholds() {
  return useQuery({ queryKey: adminKeys.households, queryFn: fetchAdminHouseholds })
}

export function useAdminUsers() {
  return useQuery({ queryKey: adminKeys.users, queryFn: fetchAdminUsers })
}

export function useIngestRuns() {
  return useQuery({ queryKey: adminKeys.ingest, queryFn: () => fetchIngestRuns() })
}

function useInvalidate() {
  const queryClient = useQueryClient()
  return (...keys: readonly (readonly string[])[]) =>
    Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey })))
}

export function useAddAllowedEmail() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ email, note }: { email: string; note: string }) => addAllowedEmail(email, note),
    onSuccess: () => invalidate(adminKeys.emails, adminKeys.users),
  })
}

export function useRemoveAllowedEmail() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: removeAllowedEmail,
    onSuccess: () => invalidate(adminKeys.emails, adminKeys.users),
  })
}

export function useDeleteHousehold() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: deleteHousehold,
    onSuccess: () => invalidate(adminKeys.households, adminKeys.users),
  })
}

/** Also refreshes the admin's own household: its members and invite code may change. */
function useOwnHouseholdKeys() {
  const { household, user } = useHousehold()
  return [householdKeys.members(household.id), householdKeys.mine(user.id)] as const
}

export function useRemoveMember() {
  const invalidate = useInvalidate()
  const own = useOwnHouseholdKeys()
  return useMutation({
    mutationFn: ({ householdId, userId }: { householdId: string; userId: string }) => removeMember(householdId, userId),
    onSuccess: () => invalidate(adminKeys.households, adminKeys.users, ...own),
  })
}

export function useDeleteUser() {
  const invalidate = useInvalidate()
  const own = useOwnHouseholdKeys()
  return useMutation({
    mutationFn: deleteUser,
    onSuccess: () => invalidate(adminKeys.users, adminKeys.households, ...own),
  })
}
