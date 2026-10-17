import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Receipt } from 'lucide-react'
import type { Bill } from '@/lib/db-types'
import { diffDays, todayISO } from '@/lib/dates'
import { Card } from '@/components/ui/Card'
import { BillRow } from './components/BillRow'
import { PayBillSheet } from './components/PayBillSheet'
import { useBillPayments, useBills } from './hooks'

export function BillsWidget() {
  const bills = useBills()
  const payments = useBillPayments()
  const [paying, setPaying] = useState<Bill | null>(null)
  const today = todayISO()
  const upcoming = (bills.data ?? []).filter((b) => diffDays(b.next_due_date, today) <= 14)

  if (!bills.data?.length) return null
  return (
    <Card className="space-y-1 p-0">
      <Link to="/bills" className="flex items-center gap-2 px-4 pt-4">
        <Receipt size={18} className="text-brand-700" />
        <h2 className="flex-1 font-semibold">חשבונות קרובים</h2>
      </Link>
      {upcoming.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-ink-3">אין תשלומים בשבועיים הקרובים</p>
      ) : (
        <ul className="divide-y divide-line">
          {upcoming.map((bill) => (
            <BillRow key={bill.id} bill={bill} onOpen={() => setPaying(bill)} onPay={() => setPaying(bill)} />
          ))}
        </ul>
      )}
      {paying && <PayBillSheet bill={paying} payments={payments.data ?? []} onClose={() => setPaying(null)} />}
    </Card>
  )
}
