import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { shoppingKeys } from '@/features/shopping/hooks'
import type { Store } from '@/lib/db-types'
import { fetchBasketMatches, fetchChains, fetchLastIngest, fetchStores, linkItemToProduct, searchProducts } from './api'

export const priceKeys = {
  chains: ['chains'] as const,
  stores: ['stores'] as const,
  matches: (listId: string) => ['basket-matches', listId] as const,
  search: (q: string) => ['product-search', q] as const,
  lastIngest: ['last-ingest'] as const,
}

export function useChains() {
  return useQuery({ queryKey: priceKeys.chains, queryFn: fetchChains, staleTime: Infinity })
}

export function useStores() {
  return useQuery({
    queryKey: priceKeys.stores,
    queryFn: fetchStores,
    // The cache is persisted, so an empty answer from before the first price
    // load would otherwise stick; refetch it every time until stores exist.
    staleTime: (query) => ((query.state.data as Store[] | undefined)?.length ? 60 * 60_000 : 0),
  })
}

export function useBasketMatches(listId: string | undefined, itemsVersion: string) {
  return useQuery({
    queryKey: [...priceKeys.matches(listId ?? ''), itemsVersion],
    queryFn: () => fetchBasketMatches(listId!),
    enabled: Boolean(listId),
    staleTime: 5 * 60_000,
  })
}

export function useProductSearch(query: string) {
  const q = query.trim()
  return useQuery({
    queryKey: priceKeys.search(q),
    queryFn: () => searchProducts(q),
    enabled: q.length >= 2,
    staleTime: 10 * 60_000,
  })
}

export function useLastIngest() {
  return useQuery({ queryKey: priceKeys.lastIngest, queryFn: fetchLastIngest, staleTime: 30 * 60_000 })
}

export function useLinkItem(listId: string) {
  const { household } = useHousehold()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ item, barcode }: { item: { id: string; name: string }; barcode: string | null }) =>
      linkItemToProduct(household.id, item, barcode),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: shoppingKeys.items(listId) })
      void queryClient.invalidateQueries({ queryKey: priceKeys.matches(listId) })
    },
  })
}
