import { useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { SplitType } from '@/lib/db-types'
import { todayISO } from '@/lib/dates'
import { formatILS, parseAmount } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input, Select } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useHousehold } from '@/features/household/HouseholdProvider'
import type { ExpenseWithShares } from '../api'
import { useDeleteExpense, useSaveExpense } from '../hooks'
import { EXPENSE_CATEGORIES } from '../lib/categories'
import { computeShares, validateSplit, type SplitInput } from '../lib/split'

type EditableSplit = 'equal' | 'percent' | 'exact' | 'full'

interface ExpenseSheetProps {
  expense?: ExpenseWithShares
  onClose: () => void
}

export function ExpenseSheet({ expense, onClose }: ExpenseSheetProps) {
  const { household, members, user } = useHousehold()
  const save = useSaveExpense()
  const remove = useDeleteExpense()

  const initialSplit: EditableSplit =
    expense?.split_type === 'default' ? 'percent' : ((expense?.split_type as EditableSplit) ?? 'equal')
  const sharesById = Object.fromEntries((expense?.expense_shares ?? []).map((s) => [s.user_id, Number(s.amount)]))

  const [description, setDescription] = useState(expense?.description ?? '')
  const [amountText, setAmountText] = useState(expense ? String(expense.amount) : '')
  const [category, setCategory] = useState(expense?.category ?? 'groceries')
  const [date, setDate] = useState(expense?.expense_date ?? todayISO())
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? user.id)
  const [splitType, setSplitType] = useState<EditableSplit>(initialSplit)
  const [participants, setParticipants] = useState<string[]>(
    expense && splitType === 'equal' ? Object.keys(sharesById) : members.map((m) => m.user_id),
  )
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      members.map((m) => [
        m.user_id,
        expense && expense.amount
          ? String(Math.round(((sharesById[m.user_id] ?? 0) / expense.amount) * 1000) / 10)
          : String(m.default_share_pct),
      ]),
    ),
  )
  const [exact, setExact] = useState<Record<string, string>>(() =>
    Object.fromEntries(members.map((m) => [m.user_id, sharesById[m.user_id] ? String(sharesById[m.user_id]) : ''])),
  )
  const [owedBy, setOwedBy] = useState(
    () => (expense?.split_type === 'full' && Object.keys(sharesById)[0]) || members.find((m) => m.user_id !== paidBy)?.user_id || user.id,
  )
  const [error, setError] = useState<unknown>(null)

  const amount = parseAmount(amountText) ?? 0
  const splitInput: SplitInput = useMemo(() => {
    switch (splitType) {
      case 'equal':
        return { type: 'equal', participants }
      case 'percent':
        return { type: 'percent', percents: mapNumbers(percents) }
      case 'exact':
        return { type: 'exact', amounts: mapNumbers(exact) }
      case 'full':
        return { type: 'full', owedBy }
    }
  }, [splitType, participants, percents, exact, owedBy])

  const validation = validateSplit(amount, splitInput)
  const shares = !validation ? computeShares(amount, paidBy, splitInput) : null

  async function submit() {
    setError(null)
    if (!description.trim()) return setError(new Error('מה קניתם? צריך תיאור'))
    if (validation || !shares) return setError(new Error(validation ?? 'חלוקה לא תקינה'))
    try {
      await save.mutateAsync({
        id: expense?.id,
        householdId: household.id,
        description,
        amount,
        paidBy,
        shares,
        category,
        date,
        splitType: splitType as SplitType,
        source: expense?.source,
        sourceId: expense?.source_id,
      })
      onClose()
    } catch (err) {
      setError(err)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={expense ? 'עריכת הוצאה' : 'הוצאה חדשה'}
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={save.isPending}>
            שמירה
          </Button>
          {expense && (
            <Button
              variant="ghost"
              className="text-rose-600"
              onClick={async () => {
                await remove.mutateAsync(expense.id)
                onClose()
              }}
            >
              <Trash2 size={18} />
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-[1fr_8rem] gap-3">
          <Field label="על מה?">
            {(id) => (
              <Input id={id} value={description} placeholder="למשל: פיצה" onChange={(e) => setDescription(e.target.value)} />
            )}
          </Field>
          <Field label="סכום">
            {(id) => (
              <Input
                id={id}
                inputMode="decimal"
                placeholder="₪"
                value={amountText}
                onChange={(e) => setAmountText(e.target.value)}
              />
            )}
          </Field>
        </div>

        <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
          {EXPENSE_CATEGORIES.map((c) => (
            <Chip key={c.id} selected={category === c.id} onClick={() => setCategory(c.id)}>
              <span aria-hidden>{c.emoji}</span>
              {c.label}
            </Chip>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="מי שילם?">
            {(id) => (
              <Select id={id} value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="תאריך">
            {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </div>

        {members.length > 1 && (
          <div className="space-y-3">
            <span className="block text-sm font-medium text-ink-2">איך מתחלקים?</span>
            <Segmented
              value={splitType}
              onChange={setSplitType}
              options={[
                { value: 'equal', label: 'שווה' },
                { value: 'percent', label: 'אחוזים' },
                { value: 'exact', label: 'סכומים' },
                { value: 'full', label: 'הכל על' },
              ]}
            />
            <ul className="space-y-2">
              {members.map((m) => (
                <li key={m.user_id} className="flex items-center gap-3">
                  <MemberAvatar member={m} size="sm" />
                  <span className="flex-1">{m.display_name}</span>
                  {splitType === 'equal' && (
                    <input
                      type="checkbox"
                      aria-label={`${m.display_name} משתתף`}
                      className="h-5 w-5 accent-brand-700"
                      checked={participants.includes(m.user_id)}
                      onChange={(e) =>
                        setParticipants((p) =>
                          e.target.checked ? [...p, m.user_id] : p.filter((id) => id !== m.user_id),
                        )
                      }
                    />
                  )}
                  {splitType === 'percent' && (
                    <Input
                      aria-label={`אחוז של ${m.display_name}`}
                      inputMode="decimal"
                      className="w-20 text-center"
                      value={percents[m.user_id] ?? ''}
                      onChange={(e) => setPercents((p) => ({ ...p, [m.user_id]: e.target.value }))}
                    />
                  )}
                  {splitType === 'exact' && (
                    <Input
                      aria-label={`סכום של ${m.display_name}`}
                      inputMode="decimal"
                      className="w-24 text-center"
                      placeholder="₪"
                      value={exact[m.user_id] ?? ''}
                      onChange={(e) => setExact((p) => ({ ...p, [m.user_id]: e.target.value }))}
                    />
                  )}
                  {splitType === 'full' && (
                    <input
                      type="radio"
                      name="owed-by"
                      aria-label={`הכל על ${m.display_name}`}
                      className="h-5 w-5 accent-brand-700"
                      checked={owedBy === m.user_id}
                      onChange={() => setOwedBy(m.user_id)}
                    />
                  )}
                  <span className="num w-20 text-end text-sm text-ink-2">
                    {shares ? formatILS(shares[m.user_id] ?? 0) : '—'}
                  </span>
                </li>
              ))}
            </ul>
            {amount > 0 && validation && <p className="text-sm text-rose-600">{validation}</p>}
          </div>
        )}
        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}

function mapNumbers(values: Record<string, string>): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => [k, Number(v.replace(',', '.')) || 0]),
  )
}
