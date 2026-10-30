import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { householdKeys, useHousehold } from '@/features/household/HouseholdProvider'
import {
  addAllowedEmail,
  approveVenueAndDeal,
  deleteHousehold,
  deleteUser,
  fetchAdminHouseholds,
  fetchAdminUsers,
  fetchAllowedEmails,
  fetchIngestRuns,
  fetchIsAdmin,
  fetchSuggestions,
  mergeVenue,
  removeAllowedEmail,
  removeMember,
  reviewDeal,
  reviewVenue,
} from './api'

// Everything under ['admin', ...] is left out of the offline cache (main.tsx).
export const adminKeys = {
  all: ['admin'] as const,
  emails: ['admin', 'emails'] as const,
  households: ['admin', 'households'] as const,
  users: ['admin', 'users'] as const,
  ingest: ['admin', 'ingest'] as const,
  suggestions: ['admin', 'suggestions'] as const,
}

/** The going-out screens' places and deals (features/going-out), by key prefix. */
const goingOutPrefixes = [['venues'], ['venue-deals']] as const

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

/** `enabled` lets the tab bar count them only once the user is known to be an admin. */
export function useAdminSuggestions(enabled = true) {
  return useQuery({ queryKey: adminKeys.suggestions, queryFn: fetchSuggestions, enabled })
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

/**
 * A review changes what every household sees in going-out (the admin's own
 * included). Refreshed on failure too: "אישור המקום והדיל" may stop halfway.
 */
function useSuggestionMutation<T>(mutationFn: (vars: T) => Promise<void>) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn,
    onSettled: () => invalidate(adminKeys.suggestions, ...goingOutPrefixes),
  })
}

export function useReviewDeal() {
  return useSuggestionMutation(({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
    reviewDeal(id, approve, note),
  )
}

export function useReviewVenue() {
  return useSuggestionMutation(({ id, approve, note }: { id: number; approve: boolean; note?: string }) =>
    reviewVenue(id, approve, note),
  )
}

export function useApproveVenueAndDeal() {
  return useSuggestionMutation(({ venueId, dealId }: { venueId: number; dealId: string }) =>
    approveVenueAndDeal(venueId, dealId),
  )
}

export function useMergeVenue() {
  return useSuggestionMutation(({ from, into }: { from: number; into: number }) => mergeVenue(from, into))
}
