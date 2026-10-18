import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { addMonths, startOfMonth, todayISO } from '@/lib/dates'
import { supabase, unwrap } from '@/lib/supabase'
import type { PriceChange } from '@/lib/db-types'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { fetchExpenses } from '@/features/expenses/api'
import { expenseKeys, useBalances } from '@/features/expenses/hooks'
import { useBillPayments, useBills } from '@/features/bills/hooks'
import { useChoreCompletions, useChores } from '@/features/chores/hooks'
import { useStores } from '@/features/prices/hooks'
import { useDefaultList, useFrequentItems, useListItems } from '@/features/shopping/hooks'
import type { InsightData } from './types'

/** Six full months back plus this month. */
export function useInsightExpenses() {
  const { household } = useHousehold()
  const since = startOfMonth(addMonths(todayISO(), -6))
  return useQuery({
    queryKey: [...expenseKeys.all(household.id), 'since', since],
    queryFn: () => fetchExpenses(household.id, since),
  })
}

function usePriceChanges() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: ['price-changes', household.id],
    queryFn: async () =>
      unwrap(
        await supabase.rpc('recent_price_changes', { p_household_id: household.id, p_days: 30 }),
      ) as PriceChange[],
    staleTime: 60 * 60_000,
  })
}

export function useInsightData(): { data: InsightData | null; isPending: boolean } {
  const { user, members } = useHousehold()
  const expenses = useInsightExpenses()
  const balances = useBalances()
  const bills = useBills()
  const billPayments = useBillPayments()
  const frequent = useFrequentItems()
  const list = useDefaultList()
  const listItems = useListItems(list.data?.id)
  const chores = useChores()
  const completions = useChoreCompletions()
  const priceChanges = usePriceChanges()
  const stores = useStores()

  const ready = !expenses.isPending && !bills.isPending && !chores.isPending
  const data = useMemo<InsightData | null>(
    () =>
      ready
        ? {
            today: todayISO(),
            userId: user.id,
            members,
            expenses: expenses.data ?? [],
            balances: balances.data ?? {},
            bills: bills.data ?? [],
            billPayments: billPayments.data ?? [],
            frequentItems: frequent.data ?? [],
            listItems: listItems.data ?? [],
            chores: chores.data ?? [],
            completions: completions.data ?? [],
            priceChanges: priceChanges.data ?? [],
            stores: stores.data ?? [],
          }
        : null,
    [
      ready,
      user.id,
      members,
      expenses.data,
      balances.data,
      bills.data,
      billPayments.data,
      frequent.data,
      listItems.data,
      chores.data,
      completions.data,
      priceChanges.data,
      stores.data,
    ],
  )
  return { data, isPending: !ready }
}
