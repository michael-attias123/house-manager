import { useState } from 'react'
import type { Bill, BillPayment } from '@/lib/db-types'
import { formatDay, todayISO } from '@/lib/dates'
import { parseAmount } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Field, Input } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { usePayBill, useSkipBill } from '../hooks'
import { suggestedAmount } from '../lib/bills'

interface PayBillSheetProps {
  bill: Bill
  payments: BillPayment[]
  onClose: () => void
}

export function PayBillSheet({ bill, payments, onClose }: PayBillSheetProps) {
  const { members, user } = useHousehold()
  const pay = usePayBill()
  const skip = useSkipBill()
  const suggestion = suggestedAmount(
    bill,
    payments.filter((p) => p.bill_id === bill.id),
  )
  const [amountText, setAmountText] = useState(suggestion ? String(suggestion) : '')
  const [paidBy, setPaidBy] = useState(bill.paid_by_default ?? user.id)
  const [paidOn, setPaidOn] = useState(todayISO())
  const [error, setError] = useState<unknown>(null)

  async function submit() {
    const amount = parseAmount(amountText)
    if (!amount) return setError(new Error('צריך סכום'))
    try {
      await pay.mutateAsync({ billId: bill.id, amount, paidBy, paidOn })
      onClose()
    } catch (err) {
      setError(err)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={`תשלום ${bill.name}`}
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={pay.isPending}>
            שולם ✓
          </Button>
          <Button
            variant="ghost"
            onClick={async () => {
              await skip.mutateAsync(bill.id)
              onClose()
            }}
          >
            דילוג על הפעם
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">
          תשלום עבור {formatDay(bill.next_due_date)}. ההוצאה תיכנס להתחשבנות לפי חלוקת ברירת המחדל.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <Field label="סכום">
            {(id) => (
              <Input id={id} inputMode="decimal" placeholder="₪" value={amountText} onChange={(e) => setAmountText(e.target.value)} />
            )}
          </Field>
          <Field label="תאריך">
            {(id) => <Input id={id} type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />}
          </Field>
        </div>
        {members.length > 1 && (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-ink-2">מי שילם?</span>
            <Segmented
              value={paidBy}
              onChange={setPaidBy}
              options={members.map((m) => ({ value: m.user_id, label: m.display_name }))}
            />
          </div>
        )}
        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
