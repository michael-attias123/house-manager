import { useMemo, useState } from 'react'
import { ShoppingBag } from 'lucide-react'
import { todayISO } from '@/lib/dates'
import { formatILS, parseAmount } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { saveDefaultSplitExpense } from '@/features/expenses/api'
import { useStores, useChains } from '@/features/prices/hooks'
import { useQueryClient } from '@tanstack/react-query'
import { expenseKeys } from '@/features/expenses/hooks'
import { useCompleteTrip } from '../hooks'

interface CompleteTripSheetProps {
  listId: string
  checkedCount: number
  onClose: () => void
}

const OTHER = 'other'

export function CompleteTripSheet({ listId, checkedCount, onClose }: CompleteTripSheetProps) {
  const { household, members, user, me, partner } = useHousehold()
  const queryClient = useQueryClient()
  const stores = useStores()
  const chains = useChains()
  const completeTrip = useCompleteTrip()
  const [storeId, setStoreId] = useState<string>(OTHER)
  const [storeName, setStoreName] = useState('')
  const [total, setTotal] = useState('')
  const [paidBy, setPaidBy] = useState(user.id)
  const [addExpense, setAddExpense] = useState(true)
  const [error, setError] = useState<unknown>(null)

  const chainName = useMemo(
    () => new Map((chains.data ?? []).map((c) => [c.id, c.name])),
    [chains.data],
  )
  const amount = parseAmount(total)
  const store = stores.data?.find((s) => String(s.id) === storeId)

  async function submit() {
    setError(null)
    try {
      const name = store ? store.name : storeName.trim() || null
      const tripId = await completeTrip.mutateAsync({
        listId,
        storeId: store?.id ?? null,
        storeName: name,
        total: amount,
        tripDate: todayISO(),
      })
      if (addExpense && amount) {
        await saveDefaultSplitExpense(
          {
            householdId: household.id,
            description: name ? `קניות ב${name}` : 'קניות בסופר',
            amount,
            paidBy,
            category: 'groceries',
            date: todayISO(),
            source: 'trip',
            sourceId: tripId,
          },
          members,
        )
        void queryClient.invalidateQueries({ queryKey: expenseKeys.all(household.id) })
      }
      onClose()
    } catch (err) {
      setError(err)
    }
  }

  const shareLabel = partner
    ? `${me?.display_name} ${me?.default_share_pct}% · ${partner.display_name} ${partner.default_share_pct}%`
    : ''

  return (
    <Sheet
      open
      onClose={onClose}
      title="סיימתי קנייה"
      footer={
        <Button className="w-full" onClick={submit} disabled={completeTrip.isPending}>
          <ShoppingBag size={18} />
          סיום ({checkedCount} פריטים)
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          הפריטים שסימנתם יעברו להיסטוריה, ומה שלא נקנה יישאר ברשימה.
        </p>
        <Field label="איפה קניתם?">
          {(id) => (
            <Select id={id} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value={OTHER}>אחר / לא חשוב</option>
              {(stores.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {chainName.get(s.chain_id) ?? s.chain_id} · {s.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {storeId === OTHER && (
          <Field label="שם החנות (לא חובה)">
            {(id) => <Input id={id} value={storeName} onChange={(e) => setStoreName(e.target.value)} />}
          </Field>
        )}
        <Field label="סכום הקבלה">
          {(id) => (
            <Input
              id={id}
              inputMode="decimal"
              placeholder="₪"
              value={total}
              onChange={(e) => setTotal(e.target.value)}
            />
          )}
        </Field>
        {members.length > 1 && (
          <>
            <div className="space-y-1.5">
              <span className="block text-sm font-medium text-ink-2">מי שילם?</span>
              <Segmented
                value={paidBy}
                onChange={setPaidBy}
                options={members.map((m) => ({ value: m.user_id, label: m.display_name }))}
              />
            </div>
            <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
              <input
                type="checkbox"
                checked={addExpense}
                onChange={(e) => setAddExpense(e.target.checked)}
                className="mt-1 h-4 w-4 accent-brand-700"
              />
              <span className="text-sm">
                להוסיף להתחשבנות
                {amount ? ` (${formatILS(amount)})` : ''}
                <span className="block text-ink-3">{shareLabel}</span>
              </span>
            </label>
          </>
        )}
        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
