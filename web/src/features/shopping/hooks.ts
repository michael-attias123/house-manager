import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FrequentItem, ListItem } from '@/lib/db-types'
import { useRealtimeInvalidate } from '@/lib/realtime'
import { useHousehold } from '@/features/household/HouseholdProvider'
import {
  addItem,
  completeTrip,
  deleteItem,
  fetchDefaultList,
  fetchFrequentItems,
  fetchItems,
  fetchProductLink,
  fetchTrips,
  uncheckAll,
  updateItem,
  type CompleteTripInput,
  type ListItemPatch,
} from './api'
import { guessCategory, parseItemInput } from './lib/categories'

export const shoppingKeys = {
  list: (householdId: string) => ['shopping-list', householdId] as const,
  items: (listId: string) => ['list-items', listId] as const,
  frequent: (householdId: string) => ['frequent-items', householdId] as const,
  trips: (householdId: string) => ['shopping-trips', householdId] as const,
}

export function useDefaultList() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: shoppingKeys.list(household.id),
    queryFn: () => fetchDefaultList(household.id),
    staleTime: Infinity,
  })
}

export function useListItems(listId: string | undefined) {
  const { household } = useHousehold()
  useRealtimeInvalidate('list_items', household.id, listId ? [shoppingKeys.items(listId)] : [])
  return useQuery({
    queryKey: shoppingKeys.items(listId ?? ''),
    queryFn: () => fetchItems(listId!),
    enabled: Boolean(listId),
  })
}

export function useFrequentItems() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: shoppingKeys.frequent(household.id),
    queryFn: () => fetchFrequentItems(household.id),
    staleTime: 5 * 60_000,
  })
}

export function useTrips() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: shoppingKeys.trips(household.id),
    queryFn: () => fetchTrips(household.id),
  })
}

/** Optimistically applies `apply` to the cached list; rolls back on error. */
function useOptimisticItems<TVars>(
  listId: string,
  mutationFn: (vars: TVars) => Promise<void>,
  apply: (items: ListItem[], vars: TVars) => ListItem[],
) {
  const queryClient = useQueryClient()
  const key = shoppingKeys.items(listId)
  return useMutation({
    mutationFn,
    onMutate: async (vars: TVars) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<ListItem[]>(key)
      queryClient.setQueryData<ListItem[]>(key, (items = []) => apply(items, vars))
      return { previous }
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(key, context.previous)
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  })
}

export interface AddItemVars {
  text: string
  category?: string
  barcode?: string | null
}

export function useAddItem(listId: string) {
  const { household, user } = useHousehold()
  const queryClient = useQueryClient()

  // Same answer for the optimistic row and the saved one: the department the
  // item was filed under last time, else a keyword guess.
  const resolve = ({ text, category }: AddItemVars) => {
    const { name, quantity } = parseItemInput(text)
    const previous = queryClient
      .getQueryData<FrequentItem[]>(shoppingKeys.frequent(household.id))
      ?.find((f) => f.normalized_name === name.toLowerCase())
    return { name, quantity, category: category ?? previous?.category ?? guessCategory(name), previous }
  }

  return useOptimisticItems<AddItemVars & { id: string }>(
    listId,
    async (vars) => {
      const { name, quantity, category, previous } = resolve(vars)
      const barcode =
        vars.barcode ??
        (await fetchProductLink(household.id, name).catch(() => null)) ??
        previous?.barcode ??
        null
      await addItem({ id: vars.id, list_id: listId, household_id: household.id, name, quantity, category, barcode })
    },
    (items, vars) => {
      const { name, quantity, category } = resolve(vars)
      const now = new Date().toISOString()
      return [
        ...items,
        {
          id: vars.id,
          list_id: listId,
          household_id: household.id,
          name,
          quantity,
          unit: null,
          category,
          note: null,
          barcode: vars.barcode ?? null,
          checked: false,
          checked_by: null,
          checked_at: null,
          added_by: user.id,
          created_at: now,
          updated_at: now,
        },
      ]
    },
  )
}

export function useToggleItem(listId: string) {
  const { user } = useHousehold()
  const patchFor = (checked: boolean): ListItemPatch => ({
    checked,
    checked_by: checked ? user.id : null,
    checked_at: checked ? new Date().toISOString() : null,
  })
  return useOptimisticItems<{ id: string; checked: boolean }>(
    listId,
    ({ id, checked }) => updateItem(id, patchFor(checked)),
    (items, { id, checked }) => items.map((i) => (i.id === id ? { ...i, ...patchFor(checked) } : i)),
  )
}

export function useUpdateItem(listId: string) {
  return useOptimisticItems<{ id: string; patch: ListItemPatch }>(
    listId,
    ({ id, patch }) => updateItem(id, patch),
    (items, { id, patch }) => items.map((i) => (i.id === id ? { ...i, ...patch } : i)),
  )
}

export function useDeleteItem(listId: string) {
  return useOptimisticItems<string>(
    listId,
    (id) => deleteItem(id),
    (items, id) => items.filter((i) => i.id !== id),
  )
}

export function useUncheckAll(listId: string) {
  return useOptimisticItems<void>(
    listId,
    () => uncheckAll(listId),
    (items) => items.map((i) => ({ ...i, checked: false, checked_by: null, checked_at: null })),
  )
}

export function useCompleteTrip() {
  const { household } = useHousehold()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (input: CompleteTripInput) => completeTrip(input),
    onSuccess: (_tripId, input) => {
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.items(input.listId) })
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.frequent(household.id) })
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.trips(household.id) })
    },
  })
}
