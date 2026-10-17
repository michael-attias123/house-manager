import { useState } from 'react'
import { Plus } from 'lucide-react'
import type { Bill } from '@/lib/db-types'
import { formatILS } from '@/lib/money'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { Fab } from '@/components/ui/Fab'
import { BillRow } from './components/BillRow'
import { BillSheet } from './components/BillSheet'
import { PayBillSheet } from './components/PayBillSheet'
import { useBillPayments, useBills } from './hooks'
import { monthlyCost } from './lib/bills'

export function BillsPage() {
  const bills = useBills()
  const payments = useBillPayments()
  const [editing, setEditing] = useState<Bill | 'new' | null>(null)
  const [paying, setPaying] = useState<Bill | null>(null)

  if (bills.isPending) return <Loading />
  const list = bills.data ?? []
  const fixedMonthly = list.filter((b) => b.amount_type === 'fixed').reduce((s, b) => s + monthlyCost(b), 0)
  const estimatedMonthly = list.reduce((s, b) => s + monthlyCost(b), 0)

  return (
    <div className="space-y-4 pb-24">
      {list.length > 0 && (
        <div className="grid grid-cols-2 gap-3">
          <Card className="p-3">
            <p className="text-xs text-ink-2">קבועות לחודש</p>
            <p className="num text-xl font-semibold">{formatILS(Math.round(fixedMonthly))}</p>
          </Card>
          <Card className="p-3">
            <p className="text-xs text-ink-2">כולל הערכות</p>
            <p className="num text-xl font-semibold">~{formatILS(Math.round(estimatedMonthly))}</p>
          </Card>
        </div>
      )}
      {bills.error && <ErrorBox error={bills.error} />}
      {list.length === 0 ? (
        <EmptyState icon="💡" title="עוד אין חשבונות">
          מוסיפים ארנונה, חשמל, שכירות ומנויים — ומקבלים תזכורת לפני כל תשלום.
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {list.map((bill) => (
            <BillRow key={bill.id} bill={bill} onOpen={() => setEditing(bill)} onPay={() => setPaying(bill)} />
          ))}
        </ul>
      )}
      <Fab onClick={() => setEditing('new')}>
        <Plus size={20} />
        חשבון
      </Fab>
      {editing && (
        <BillSheet
          bill={editing === 'new' ? undefined : editing}
          payments={payments.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
      {paying && <PayBillSheet bill={paying} payments={payments.data ?? []} onClose={() => setPaying(null)} />}
    </div>
  )
}
