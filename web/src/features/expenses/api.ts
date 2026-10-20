import { supabase, unwrap } from '@/lib/supabase'
import type { Expense, ExpenseShare, HouseholdMember, Settlement, SplitType } from '@/lib/db-types'
import type { ISODate } from '@/lib/dates'
import { computeShares, type Shares } from './lib/split'

export type ExpenseWithShares = Expense & { expense_shares: Pick<ExpenseShare, 'user_id' | 'amount'>[] }

export async function fetchExpenses(householdId: string, since?: ISODate): Promise<ExpenseWithShares[]> {
  let query = supabase
    .from('expenses')
    .select('*, expense_shares(user_id, amount)')
    .eq('household_id', householdId)
    .order('expense_date', { ascending: false })
    .order('created_at', { ascending: false })
  if (since) query = query.gte('expense_date', since)
  else query = query.limit(300)
  return unwrap(await query) as ExpenseWithShares[]
}

export interface SaveExpenseInput {
  id?: string
  householdId: string
  description: string
  amount: number
  paidBy: string
  shares: Shares
  category: string
  date: ISODate
  splitType: SplitType
  note?: string | null
  source?: Expense['source']
  sourceId?: string | null
}

export async function saveExpense(input: SaveExpenseInput): Promise<string> {
  return unwrap(
    await supabase.rpc('save_expense', {
      p_household_id: input.householdId,
      p_description: input.description,
      p_amount: input.amount,
      p_paid_by: input.paidBy,
      p_shares: input.shares,
      p_category: input.category,
      p_expense_date: input.date,
      p_split_type: input.splitType,
      p_note: input.note ?? null,
      p_source: input.source ?? 'manual',
      p_source_id: input.sourceId ?? null,
      p_id: input.id ?? null,
    }),
  ) as string
}

/** Records an expense split by the household's default ratio. */
export function saveDefaultSplitExpense(
  input: Omit<SaveExpenseInput, 'shares' | 'splitType'>,
  members: HouseholdMember[],
): Promise<string> {
  const weights = Object.fromEntries(members.map((m) => [m.user_id, Number(m.default_share_pct)]))
  return saveExpense({
    ...input,
    splitType: 'default',
    shares: computeShares(input.amount, input.paidBy, { type: 'default', weights }),
  })
}

export interface ImportResult {
  expenses: number
  settlements: number
  skipped: number
}

/** Adds imported history in one transaction; rows imported before are skipped. */
export async function importExpenses(
  householdId: string,
  expenses: { externalId: string; date: ISODate; description: string; amount: number; paidBy: string; shares: Shares; splitType: SplitType; category: string }[],
  transfers: { externalId: string; date: ISODate; note: string; amount: number; from: string; to: string }[],
): Promise<ImportResult> {
  return unwrap(
    await supabase.rpc('import_expenses', {
      p_household_id: householdId,
      p_expenses: expenses.map((e) => ({
        external_id: e.externalId,
        date: e.date,
        description: e.description,
        amount: e.amount,
        paid_by: e.paidBy,
        shares: e.shares,
        split_type: e.splitType,
        category: e.category,
      })),
      p_settlements: transfers.map((t) => ({
        external_id: t.externalId,
        date: t.date,
        note: t.note,
        amount: t.amount,
        from_user: t.from,
        to_user: t.to,
      })),
    }),
  ) as ImportResult
}

export async function deleteExpense(id: string): Promise<void> {
  unwrap(await supabase.from('expenses').delete().eq('id', id))
}

export async function fetchBalances(householdId: string): Promise<Record<string, number>> {
  const rows = unwrap(
    await supabase.from('member_balances').select('user_id, balance').eq('household_id', householdId),
  ) as { user_id: string; balance: number }[]
  return Object.fromEntries(rows.map((r) => [r.user_id, Number(r.balance)]))
}

export async function fetchSettlements(householdId: string): Promise<Settlement[]> {
  return unwrap(
    await supabase
      .from('settlements')
      .select('*')
      .eq('household_id', householdId)
      .order('settled_on', { ascending: false })
      .limit(100),
  ) as Settlement[]
}

export async function addSettlement(
  input: Pick<Settlement, 'household_id' | 'from_user' | 'to_user' | 'amount' | 'settled_on' | 'note'>,
): Promise<void> {
  unwrap(await supabase.from('settlements').insert(input))
}

export async function deleteSettlement(id: string): Promise<void> {
  unwrap(await supabase.from('settlements').delete().eq('id', id))
}
