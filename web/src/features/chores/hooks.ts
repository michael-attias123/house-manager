import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Chore } from '@/lib/db-types'
import { addDays, todayISO } from '@/lib/dates'
import { useRealtimeInvalidate } from '@/lib/realtime'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { archiveChore, completeChore, fetchChores, fetchCompletions, saveChore, type ChoreInput } from './api'
import { completionUpdate } from './lib/chores'

export const choreKeys = {
  all: (householdId: string) => ['chores', householdId] as const,
  list: (householdId: string) => ['chores', householdId, 'list'] as const,
  completions: (householdId: string) => ['chores', householdId, 'completions'] as const,
}

export function useChores() {
  const { household } = useHousehold()
  useRealtimeInvalidate('chores', household.id, [choreKeys.all(household.id)])
  return useQuery({ queryKey: choreKeys.list(household.id), queryFn: () => fetchChores(household.id) })
}

/** The last ~6 months, enough for monthly stats and insights. */
export function useChoreCompletions() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: choreKeys.completions(household.id),
    queryFn: () => fetchCompletions(household.id, addDays(todayISO(), -186)),
  })
}

function useInvalidate() {
  const { household } = useHousehold()
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: choreKeys.all(household.id) })
}

export function useSaveChore() {
  const onSuccess = useInvalidate()
  return useMutation({ mutationFn: (input: ChoreInput) => saveChore(input), onSuccess })
}

export function useArchiveChore() {
  const onSuccess = useInvalidate()
  return useMutation({ mutationFn: archiveChore, onSuccess })
}

export function useCompleteChore() {
  const { household, members, user } = useHousehold()
  const queryClient = useQueryClient()
  const key = choreKeys.list(household.id)
  return useMutation({
    mutationFn: ({ chore, doneBy = user.id }: { chore: Chore; doneBy?: string }) => {
      const today = todayISO()
      return completeChore(chore, completionUpdate(chore, members, doneBy, today), doneBy, today)
    },
    onMutate: async ({ chore, doneBy = user.id }) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<Chore[]>(key)
      const update = completionUpdate(chore, members, doneBy, todayISO())
      queryClient.setQueryData<Chore[]>(key, (chores = []) =>
        chores
          .map((c) => (c.id === chore.id ? { ...c, ...update } : c))
          .filter((c) => c.active)
          .sort((a, b) => a.next_due.localeCompare(b.next_due)),
      )
      return { previous }
    },
    onError: (_err, _vars, context) => context?.previous && queryClient.setQueryData(key, context.previous),
    onSettled: () => queryClient.invalidateQueries({ queryKey: choreKeys.all(household.id) }),
  })
}
