import { useMemo, useState } from 'react'
import { ArrowLeftRight, Plus, Trash2 } from 'lucide-react'
import type { Settlement } from '@/lib/db-types'
import { formatDay, formatMonth, monthKey, todayISO } from '@/lib/dates'
import { formatILS } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Chip } from '@/components/ui/Chip'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { Fab } from '@/components/ui/Fab'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { useHousehold } from '@/features/household/HouseholdProvider'
import type { ExpenseWithShares } from './api'
import { BalanceCard } from './components/BalanceCard'
import { ExpenseSheet } from './components/ExpenseSheet'
import { SettleUpSheet } from './components/SettleUpSheet'
import { useDeleteSettlement, useExpenses, useSettlements } from './hooks'
import type { Transfer } from './lib/balances'
import { EXPENSE_CATEGORIES, getExpenseCategory } from './lib/categories'

type Row =
  | { kind: 'expense'; date: string; created: string; expense: ExpenseWithShares }
  | { kind: 'settlement'; date: string; created: string; settlement: Settlement }

export function ExpensesPage() {
  const { user, memberById } = useHousehold()
  const expenses = useExpenses()
  const settlements = useSettlements()
  const deleteSettlement = useDeleteSettlement()
  const [editing, setEditing] = useState<ExpenseWithShares | 'new' | null>(null)
  const [settling, setSettling] = useState<Transfer | 'new' | null>(null)
  const [category, setCategory] = useState<string | null>(null)

  const thisMonth = monthKey(todayISO())
  const monthStats = useMemo(() => {
    const list = (expenses.data ?? []).filter((e) => monthKey(e.expense_date) === thisMonth)
    const total = list.reduce((s, e) => s + Number(e.amount), 0)
    const mine = list.reduce(
      (s, e) => s + Number(e.expense_shares.find((sh) => sh.user_id === user.id)?.amount ?? 0),
      0,
    )
    return { total, mine, count: list.length }
  }, [expenses.data, thisMonth, user.id])

  const rows = useMemo(() => {
    const result: Row[] = (expenses.data ?? [])
      .filter((e) => !category || e.category === category)
      .map((e) => ({ kind: 'expense', date: e.expense_date, created: e.created_at, expense: e }))
    if (!category) {
      for (const s of settlements.data ?? []) {
        result.push({ kind: 'settlement', date: s.settled_on, created: s.created_at, settlement: s })
      }
    }
    result.sort((a, b) => b.date.localeCompare(a.date) || b.created.localeCompare(a.created))
    const byMonth = new Map<string, Row[]>()
    for (const row of result) {
      const key = monthKey(row.date)
      byMonth.set(key, [...(byMonth.get(key) ?? []), row])
    }
    return [...byMonth.entries()]
  }, [expenses.data, settlements.data, category])

  if (expenses.isPending) return <Loading />

  return (
    <div className="space-y-4 pb-24">
      <BalanceCard onSettle={(t) => setSettling(t)} />

      <div className="grid grid-cols-2 gap-3">
        <Card className="p-3">
          <p className="text-xs text-ink-2">הוצאות הבית החודש</p>
          <p className="num text-xl font-semibold">{formatILS(monthStats.total)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-xs text-ink-2">החלק שלי החודש</p>
          <p className="num text-xl font-semibold">{formatILS(monthStats.mine)}</p>
        </Card>
      </div>

      <div className="flex items-center gap-2">
        <div className="-mx-4 flex flex-1 gap-2 overflow-x-auto px-4 pb-1">
          <Chip selected={!category} onClick={() => setCategory(null)}>
            הכל
          </Chip>
          {EXPENSE_CATEGORIES.map((c) => (
            <Chip key={c.id} selected={category === c.id} onClick={() => setCategory(c.id)}>
              {c.emoji} {c.label}
            </Chip>
          ))}
        </div>
      </div>

      {expenses.error && <ErrorBox error={expenses.error} />}
      {rows.length === 0 && (
        <EmptyState icon="🧾" title="עוד אין הוצאות">
          כל הוצאה משותפת נכנסת לכאן, והמאזן מתעדכן לבד.
        </EmptyState>
      )}

      {rows.map(([month, monthRows]) => (
        <section key={month} className="space-y-1">
          <h3 className="px-1 text-sm font-semibold text-ink-2">{formatMonth(month)}</h3>
          <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
            {monthRows.map((row) =>
              row.kind === 'expense' ? (
                <ExpenseRow key={row.expense.id} expense={row.expense} onClick={() => setEditing(row.expense)} />
              ) : (
                <li key={row.settlement.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40">
                    <ArrowLeftRight size={16} />
                  </span>
                  <div className="flex-1">
                    <p>
                      העברה מ־{memberById(row.settlement.from_user)?.display_name} ל־
                      {memberById(row.settlement.to_user)?.display_name}
                    </p>
                    <p className="text-xs text-ink-3">
                      {formatDay(row.settlement.settled_on)}
                      {row.settlement.note ? ` · ${row.settlement.note}` : ''}
                    </p>
                  </div>
                  <span className="num font-medium text-emerald-600">{formatILS(Number(row.settlement.amount))}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="מחיקת העברה"
                    onClick={() => confirm('למחוק את ההעברה?') && deleteSettlement.mutate(row.settlement)}
                  >
                    <Trash2 size={16} />
                  </Button>
                </li>
              ),
            )}
          </ul>
        </section>
      ))}

      <Fab onClick={() => setEditing('new')}>
        <Plus size={20} />
        הוצאה
      </Fab>

      {editing && (
        <ExpenseSheet expense={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />
      )}
      {settling && (
        <SettleUpSheet suggestion={settling === 'new' ? undefined : settling} onClose={() => setSettling(null)} />
      )}
    </div>
  )
}

function ExpenseRow({ expense, onClick }: { expense: ExpenseWithShares; onClick: () => void }) {
  const { user, memberById } = useHousehold()
  const category = getExpenseCategory(expense.category)
  const myShare = Number(expense.expense_shares.find((s) => s.user_id === user.id)?.amount ?? 0)
  const iPaid = expense.paid_by === user.id
  const delta = iPaid ? Number(expense.amount) - myShare : -myShare

  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-2.5 text-start">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-lg" aria-hidden>
          {category.emoji}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate">{expense.description}</p>
          <p className="flex items-center gap-1 text-xs text-ink-3">
            <MemberAvatar member={memberById(expense.paid_by)} size="sm" className="h-4 w-4 text-[9px]" />
            {formatDay(expense.expense_date)}
            {expense.source === 'bill' && ' · חשבון קבוע'}
            {expense.source === 'trip' && ' · קנייה'}
          </p>
        </div>
        <div className="text-end">
          <p className="num font-medium">{formatILS(Number(expense.amount))}</p>
          {delta !== 0 && (
            <p className={`num text-xs ${delta > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
              {delta > 0 ? `+${formatILS(delta)}` : `−${formatILS(-delta)}`}
            </p>
          )}
        </div>
      </button>
    </li>
  )
}
