import type { Bill, BillFrequency, BillPayment } from '@/lib/db-types'
import { addMonths, diffDays, type ISODate } from '@/lib/dates'

export const FREQUENCIES: { value: BillFrequency; label: string; months: number }[] = [
  { value: 'monthly', label: 'כל חודש', months: 1 },
  { value: 'bimonthly', label: 'כל חודשיים', months: 2 },
  { value: 'quarterly', label: 'כל רבעון', months: 3 },
  { value: 'yearly', label: 'פעם בשנה', months: 12 },
]

export function frequencyMonths(frequency: BillFrequency): number {
  return FREQUENCIES.find((f) => f.value === frequency)?.months ?? 1
}

export function frequencyLabel(frequency: BillFrequency): string {
  return FREQUENCIES.find((f) => f.value === frequency)?.label ?? ''
}

/** Same rule as advance_due_date() in SQL. */
export function advanceDueDate(date: ISODate, frequency: BillFrequency): ISODate {
  return addMonths(date, frequencyMonths(frequency))
}

/** Average cost per month (fixed amount or estimate). */
export function monthlyCost(bill: Pick<Bill, 'amount' | 'frequency'>): number {
  return bill.amount ? Number(bill.amount) / frequencyMonths(bill.frequency) : 0
}

export type BillStatus = 'overdue' | 'due_soon' | 'upcoming'

export function billStatus(bill: Pick<Bill, 'next_due_date'>, today: ISODate, soonDays = 7): BillStatus {
  const days = diffDays(bill.next_due_date, today)
  if (days < 0) return 'overdue'
  if (days <= soonDays) return 'due_soon'
  return 'upcoming'
}

/** The amount to suggest when paying: the fixed amount, else the recent average. */
export function suggestedAmount(bill: Pick<Bill, 'amount' | 'amount_type'>, payments: BillPayment[]): number | null {
  if (bill.amount_type === 'fixed' && bill.amount) return Number(bill.amount)
  const recent = payments.slice(0, 3).map((p) => Number(p.amount))
  if (recent.length) return Math.round(recent.reduce((s, a) => s + a, 0) / recent.length)
  return bill.amount ? Number(bill.amount) : null
}

export interface BillPreset {
  name: string
  icon: string
  frequency: BillFrequency
  amountType: 'fixed' | 'variable'
  category: string
}

/** Common Israeli household bills, to fill the form in one tap. */
export const BILL_PRESETS: BillPreset[] = [
  { name: 'שכירות', icon: '🏠', frequency: 'monthly', amountType: 'fixed', category: 'rent' },
  { name: 'ארנונה', icon: '🏛️', frequency: 'bimonthly', amountType: 'variable', category: 'bills' },
  { name: 'חשמל', icon: '💡', frequency: 'bimonthly', amountType: 'variable', category: 'bills' },
  { name: 'מים', icon: '🚰', frequency: 'bimonthly', amountType: 'variable', category: 'bills' },
  { name: 'גז', icon: '🔥', frequency: 'bimonthly', amountType: 'variable', category: 'bills' },
  { name: 'ועד בית', icon: '🏢', frequency: 'monthly', amountType: 'fixed', category: 'bills' },
  { name: 'אינטרנט', icon: '🌐', frequency: 'monthly', amountType: 'fixed', category: 'bills' },
  { name: 'סלולר', icon: '📱', frequency: 'monthly', amountType: 'fixed', category: 'bills' },
  { name: 'ביטוח דירה', icon: '🛡️', frequency: 'yearly', amountType: 'fixed', category: 'bills' },
  { name: 'נטפליקס', icon: '🎬', frequency: 'monthly', amountType: 'fixed', category: 'fun' },
  { name: 'ספוטיפיי', icon: '🎵', frequency: 'monthly', amountType: 'fixed', category: 'fun' },
]
