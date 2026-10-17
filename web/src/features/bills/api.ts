import { supabase, unwrap } from '@/lib/supabase'
import type { Bill, BillPayment } from '@/lib/db-types'
import type { ISODate } from '@/lib/dates'

export async function fetchBills(householdId: string): Promise<Bill[]> {
  return unwrap(
    await supabase
      .from('bills')
      .select('*')
      .eq('household_id', householdId)
      .eq('active', true)
      .order('next_due_date'),
  ) as Bill[]
}

export async function fetchBillPayments(householdId: string): Promise<BillPayment[]> {
  return unwrap(
    await supabase
      .from('bill_payments')
      .select('*')
      .eq('household_id', householdId)
      .order('due_date', { ascending: false })
      .limit(500),
  ) as BillPayment[]
}

export type BillInput = Omit<Bill, 'id' | 'active'> & { id?: string }

export async function saveBill(input: BillInput): Promise<void> {
  const { id, ...fields } = input
  if (id) unwrap(await supabase.from('bills').update(fields).eq('id', id))
  else unwrap(await supabase.from('bills').insert(fields))
}

/** Archived rather than deleted, so payment history stays. */
export async function archiveBill(id: string): Promise<void> {
  unwrap(await supabase.from('bills').update({ active: false, auto_create: false }).eq('id', id))
}

export async function payBill(input: { billId: string; amount: number; paidBy: string; paidOn: ISODate }) {
  return unwrap(
    await supabase.rpc('pay_bill', {
      p_bill_id: input.billId,
      p_amount: input.amount,
      p_paid_by: input.paidBy,
      p_paid_on: input.paidOn,
    }),
  ) as string
}

export async function skipBill(billId: string) {
  return unwrap(await supabase.rpc('skip_bill', { p_bill_id: billId })) as ISODate
}
