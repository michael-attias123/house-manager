import { useState } from 'react'
import { todayISO } from '@/lib/dates'
import { parseAmount } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { Sheet } from '@/components/ui/Sheet'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { useAddSettlement } from '../hooks'
import type { Transfer } from '../lib/balances'

interface SettleUpSheetProps {
  suggestion?: Transfer
  onClose: () => void
}

export function SettleUpSheet({ suggestion, onClose }: SettleUpSheetProps) {
  const { household, members, user, partner } = useHousehold()
  const add = useAddSettlement()
  const [from, setFrom] = useState(suggestion?.from ?? user.id)
  const [to, setTo] = useState(suggestion?.to ?? partner?.user_id ?? '')
  const [amountText, setAmountText] = useState(suggestion ? String(suggestion.amount) : '')
  const [date, setDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState<unknown>(null)

  async function submit() {
    const amount = parseAmount(amountText)
    if (!amount) return setError(new Error('צריך סכום'))
    if (from === to) return setError(new Error('בחרו שני אנשים שונים'))
    try {
      await add.mutateAsync({
        household_id: household.id,
        from_user: from,
        to_user: to,
        amount,
        settled_on: date,
        note: note.trim() || null,
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
      title="סגירת חשבון"
      footer={
        <Button className="w-full" onClick={submit} disabled={add.isPending}>
          רישום ההעברה
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          העברתם כסף (ביט, פייבוקס, מזומן)? רשמו כאן כדי לאפס את היתרה.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="מי העביר">
            {(id) => (
              <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="למי">
            {(id) => (
              <Select id={id} value={to} onChange={(e) => setTo(e.target.value)}>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="סכום">
            {(id) => (
              <Input id={id} inputMode="decimal" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            )}
          </Field>
          <Field label="תאריך">
            {(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
          </Field>
        </div>
        <Field label="הערה">
          {(id) => <Input id={id} value={note} placeholder="ביט" onChange={(e) => setNote(e.target.value)} />}
        </Field>
        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
