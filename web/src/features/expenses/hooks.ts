import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRealtimeInvalidate } from '@/lib/realtime'
import { useHousehold } from '@/features/household/HouseholdProvider'
import {
  addSettlement,
  deleteExpense,
  deleteSettlement,
  fetchBalances,
  fetchExpenses,
  fetchSettlements,
  saveExpense,
  type SaveExpenseInput,
} from './api'
import type { Settlement } from '@/lib/db-types'

export const expenseKeys = {
  all: (householdId: string) => ['expenses', householdId] as const,
  list: (householdId: string) => ['expenses', householdId, 'list'] as const,
  balances: (householdId: string) => ['expenses', householdId, 'balances'] as const,
  settlements: (householdId: string) => ['expenses', householdId, 'settlements'] as const,
}

export function useExpenses() {
  const { household } = useHousehold()
  useRealtimeInvalidate('expenses', household.id, [expenseKeys.all(household.id)])
  return useQuery({
    queryKey: expenseKeys.list(household.id),
    queryFn: () => fetchExpenses(household.id),
  })
}

export function useBalances() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: expenseKeys.balances(household.id),
    queryFn: () => fetchBalances(household.id),
  })
}

export function useSettlements() {
  const { household } = useHousehold()
  return useQuery({
    queryKey: expenseKeys.settlements(household.id),
    queryFn: () => fetchSettlements(household.id),
  })
}

function useInvalidateExpenses() {
  const { household } = useHousehold()
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: expenseKeys.all(household.id) })
}

export function useSaveExpense() {
  const invalidate = useInvalidateExpenses()
  return useMutation({ mutationFn: (input: SaveExpenseInput) => saveExpense(input), onSuccess: invalidate })
}

export function useDeleteExpense() {
  const invalidate = useInvalidateExpenses()
  return useMutation({ mutationFn: deleteExpense, onSuccess: invalidate })
}

export function useAddSettlement() {
  const invalidate = useInvalidateExpenses()
  return useMutation({
    mutationFn: (input: Parameters<typeof addSettlement>[0]) => addSettlement(input),
    onSuccess: invalidate,
  })
}

export function useDeleteSettlement() {
  const invalidate = useInvalidateExpenses()
  return useMutation({ mutationFn: (s: Settlement) => deleteSettlement(s.id), onSuccess: invalidate })
}
