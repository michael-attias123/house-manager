import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { FrequentItem, ItemCategory, ListItem } from '@/lib/db-types'
import { useRealtimeInvalidate } from '@/lib/realtime'
import { useHousehold } from '@/features/household/HouseholdProvider'
import {
  addItem,
  completeTrip,
  deleteItem,
  deleteItems,
  fetchDefaultList,
  fetchFrequentItems,
  fetchItemCategories,
  fetchItems,
  fetchProductLink,
  fetchTrips,
  saveItemCategory,
  uncheckAll,
  updateItem,
  type CompleteTripInput,
  type ListItemPatch,
} from './api'
import { parseItemInput } from './lib/categories'
import { categoryKey } from './lib/classify'
import { learnedMap, resolveCategory } from './lib/resolve'

export const shoppingKeys = {
  list: (householdId: string) => ['shopping-list', householdId] as const,
  items: (listId: string) => ['list-items', listId] as const,
  frequent: (householdId: string) => ['frequent-items', householdId] as const,
  trips: (householdId: string) => ['shopping-trips', householdId] as const,
  categories: (householdId: string) => ['item-categories', householdId] as const,
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

/** Departments the household chose by hand; the partner's changes arrive live. */
export function useItemCategories() {
  const { household } = useHousehold()
  useRealtimeInvalidate('item_categories', household.id, [shoppingKeys.categories(household.id)])
  return useQuery({
    queryKey: shoppingKeys.categories(household.id),
    queryFn: () => fetchItemCategories(household.id),
    staleTime: 5 * 60_000,
  })
}

/** Remembers a department for a name, optimistically. */
function useRememberCategory() {
  const { household } = useHousehold()
  const queryClient = useQueryClient()
  const key = shoppingKeys.categories(household.id)
  return async (name: string, category: string) => {
    const normalized = categoryKey(name)
    if (!normalized) return
    queryClient.setQueryData<ItemCategory[]>(key, (rows = []) => [
      ...rows.filter((r) => r.normalized_name !== normalized),
      { household_id: household.id, normalized_name: normalized, category, updated_at: new Date().toISOString() },
    ])
    try {
      await saveItemCategory(household.id, normalized, category)
    } finally {
      void queryClient.invalidateQueries({ queryKey: key })
    }
  }
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

  // Same answer for the optimistic row and the saved one (resolveCategory).
  const resolve = ({ text, category }: AddItemVars) => {
    const { name, quantity } = parseItemInput(text)
    const previous = queryClient
      .getQueryData<FrequentItem[]>(shoppingKeys.frequent(household.id))
      ?.find((f) => f.normalized_name === name.toLowerCase())
    const learned = learnedMap(queryClient.getQueryData<ItemCategory[]>(shoppingKeys.categories(household.id)))
    return { name, quantity, category: resolveCategory(name, category, learned, previous), previous }
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

/**
 * Moves an item to another department, together with every item of the same
 * name on the list, and remembers the choice for next time.
 */
export function useMoveItem(listId: string) {
  const queryClient = useQueryClient()
  const remember = useRememberCategory()
  const twins = (items: ListItem[] = [], name: string) => {
    const key = categoryKey(name)
    return items.filter((i) => categoryKey(i.name) === key)
  }
  return useOptimisticItems<{ item: ListItem; category: string }>(
    listId,
    async ({ item, category }) => {
      const same = twins(queryClient.getQueryData<ListItem[]>(shoppingKeys.items(listId)), item.name)
      const ids = new Set([item.id, ...same.map((i) => i.id)])
      await Promise.all([...ids].map((id) => updateItem(id, { category })))
      await remember(item.name, category)
    },
    (items, { item, category }) => {
      const ids = new Set([item.id, ...twins(items, item.name).map((i) => i.id)])
      return items.map((i) => (ids.has(i.id) ? { ...i, category } : i))
    },
  )
}

/** Remembers a department chosen in the edit sheet. */
export function useLearnCategory() {
  const remember = useRememberCategory()
  return useMutation({ mutationFn: ({ name, category }: { name: string; category: string }) => remember(name, category) })
}

export function useDeleteItem(listId: string) {
  return useOptimisticItems<string>(
    listId,
    (id) => deleteItem(id),
    (items, id) => items.filter((i) => i.id !== id),
  )
}

/** Deletes several items in one request (selection mode). */
export function useDeleteItems(listId: string) {
  return useOptimisticItems<string[]>(
    listId,
    (ids) => deleteItems(ids),
    (items, ids) => {
      const gone = new Set(ids)
      return items.filter((i) => !gone.has(i.id))
    },
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
