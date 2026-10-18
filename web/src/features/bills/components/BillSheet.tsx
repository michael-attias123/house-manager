import { useState } from 'react'
import { Archive } from 'lucide-react'
import type { Bill, BillFrequency, BillPayment } from '@/lib/db-types'
import { addDays, formatDay, todayISO } from '@/lib/dates'
import { formatILS, parseAmount } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { Chip } from '@/components/ui/Chip'
import { Field, Input, Select } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { EXPENSE_CATEGORIES } from '@/features/expenses/lib/categories'
import { useArchiveBill, useSaveBill } from '../hooks'
import { BILL_PRESETS, FREQUENCIES, type BillPreset } from '../lib/bills'

interface BillSheetProps {
  bill?: Bill
  payments: BillPayment[]
  onClose: () => void
}

export function BillSheet({ bill, payments, onClose }: BillSheetProps) {
  const { household, members, user } = useHousehold()
  const save = useSaveBill()
  const archive = useArchiveBill()
  const [name, setName] = useState(bill?.name ?? '')
  const [icon, setIcon] = useState(bill?.icon ?? '🧾')
  const [provider, setProvider] = useState(bill?.provider ?? '')
  const [category, setCategory] = useState(bill?.category ?? 'bills')
  const [amountType, setAmountType] = useState<'fixed' | 'variable'>(bill?.amount_type ?? 'variable')
  const [amountText, setAmountText] = useState(bill?.amount ? String(bill.amount) : '')
  const [frequency, setFrequency] = useState<BillFrequency>(bill?.frequency ?? 'monthly')
  const [nextDue, setNextDue] = useState(bill?.next_due_date ?? addDays(todayISO(), 7))
  const [paidBy, setPaidBy] = useState(bill?.paid_by_default ?? user.id)
  const [autoCreate, setAutoCreate] = useState(bill?.auto_create ?? false)
  const [error, setError] = useState<unknown>(null)

  const history = payments.filter((p) => p.bill_id === bill?.id).slice(0, 12)
  const maxPaid = Math.max(1, ...history.map((p) => Number(p.amount)))

  function applyPreset(p: BillPreset) {
    setName(p.name)
    setIcon(p.icon)
    setFrequency(p.frequency)
    setAmountType(p.amountType)
    setCategory(p.category)
  }

  async function submit() {
    setError(null)
    const amount = parseAmount(amountText)
    if (!name.trim()) return setError(new Error('צריך שם לחשבון'))
    if (amountType === 'fixed' && !amount) return setError(new Error('לחשבון קבוע צריך סכום'))
    try {
      await save.mutateAsync({
        id: bill?.id,
        household_id: household.id,
        name: name.trim(),
        provider: provider.trim() || null,
        category,
        icon,
        amount_type: amountType,
        amount,
        frequency,
        next_due_date: nextDue,
        paid_by_default: paidBy,
        auto_create: amountType === 'fixed' && autoCreate,
        notes: bill?.notes ?? null,
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
      title={bill ? bill.name : 'חשבון חדש'}
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={save.isPending}>
            שמירה
          </Button>
          {bill && (
            <ConfirmButton
              variant="ghost"
              aria-label="העברה לארכיון (ההיסטוריה נשמרת)"
              confirmLabel="לארכיון?"
              onConfirm={async () => {
                await archive.mutateAsync(bill.id)
                onClose()
              }}
            >
              <Archive size={18} />
            </ConfirmButton>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {!bill && (
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {BILL_PRESETS.map((p) => (
              <Chip key={p.name} selected={name === p.name} onClick={() => applyPreset(p)}>
                {p.icon} {p.name}
              </Chip>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[4rem_1fr] gap-3">
          <Field label="אייקון">
            {(id) => (
              <Input id={id} className="text-center text-xl" value={icon} onChange={(e) => setIcon(e.target.value)} />
            )}
          </Field>
          <Field label="שם">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
        </div>
        <Field label="ספק (לא חובה)">
          {(id) => (
            <Input id={id} placeholder="חברת החשמל, עיריית באר שבע..." value={provider} onChange={(e) => setProvider(e.target.value)} />
          )}
        </Field>
        <Segmented
          value={amountType}
          onChange={setAmountType}
          options={[
            { value: 'variable', label: 'סכום משתנה' },
            { value: 'fixed', label: 'סכום קבוע' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label={amountType === 'fixed' ? 'סכום' : 'הערכה (לא חובה)'}>
            {(id) => (
              <Input id={id} inputMode="decimal" placeholder="₪" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            )}
          </Field>
          <Field label="תדירות">
            {(id) => (
              <Select id={id} value={frequency} onChange={(e) => setFrequency(e.target.value as BillFrequency)}>
                {FREQUENCIES.map((f) => (
                  <option key={f.value} value={f.value}>
                    {f.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="תשלום הבא">
            {(id) => <Input id={id} type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />}
          </Field>
          <Field label="בדרך כלל משלם/ת">
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
        </div>
        <Field label="קטגוריה">
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              {EXPENSE_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {amountType === 'fixed' && (
          <label className="flex items-start gap-3 rounded-xl bg-surface-2 p-3">
            <input
              type="checkbox"
              checked={autoCreate}
              onChange={(e) => setAutoCreate(e.target.checked)}
              className="mt-1 h-4 w-4 accent-brand-700"
            />
            <span className="text-sm">
              הוראת קבע — לרשום אוטומטית בכל מועד
              <span className="block text-ink-3">ההוצאה תיכנס להתחשבנות בתאריך התשלום, בלי ללחוץ "שולם".</span>
            </span>
          </label>
        )}

        {history.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium text-ink-2">תשלומים אחרונים</h3>
            <ul className="space-y-1.5">
              {history.map((p) => (
                <li key={p.id} className="flex items-center gap-2 text-sm">
                  <span className="w-24 shrink-0 text-ink-3">{formatDay(p.due_date)}</span>
                  <span className="h-2 flex-1 rounded-full bg-surface-2">
                    <span
                      className="block h-2 rounded-full bg-brand-500"
                      style={{ width: `${(Number(p.amount) / maxPaid) * 100}%` }}
                    />
                  </span>
                  <span className="num w-20 text-end">{formatILS(Number(p.amount))}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
