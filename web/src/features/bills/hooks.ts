import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { expenseKeys } from '@/features/expenses/hooks'
import { archiveBill, fetchBillPayments, fetchBills, payBill, saveBill, skipBill, type BillInput } from './api'

export const billKeys = {
  all: (householdId: string) => ['bills', householdId] as const,
  list: (householdId: string) => ['bills', householdId, 'list'] as const,
  payments: (householdId: string) => ['bills', householdId, 'payments'] as const,
}

export function useBills() {
  const { household } = useHousehold()
  return useQuery({ queryKey: billKeys.list(household.id), queryFn: () => fetchBills(household.id) })
}

export function useBillPayments() {
  const { household } = useHousehold()
  return useQuery({ queryKey: billKeys.payments(household.id), queryFn: () => fetchBillPayments(household.id) })
}

function useInvalidate(includeExpenses = false) {
  const { household } = useHousehold()
  const queryClient = useQueryClient()
  return () => {
    void queryClient.invalidateQueries({ queryKey: billKeys.all(household.id) })
    if (includeExpenses) void queryClient.invalidateQueries({ queryKey: expenseKeys.all(household.id) })
  }
}

export function useSaveBill() {
  const onSuccess = useInvalidate()
  return useMutation({ mutationFn: (input: BillInput) => saveBill(input), onSuccess })
}

export function useArchiveBill() {
  const onSuccess = useInvalidate()
  return useMutation({ mutationFn: archiveBill, onSuccess })
}

export function usePayBill() {
  const onSuccess = useInvalidate(true)
  return useMutation({ mutationFn: payBill, onSuccess })
}

export function useSkipBill() {
  const onSuccess = useInvalidate()
  return useMutation({ mutationFn: skipBill, onSuccess })
}
