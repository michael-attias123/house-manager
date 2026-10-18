import type { Bill } from '@/lib/db-types'
import { relativeDay, todayISO } from '@/lib/dates'
import { formatILS } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { billStatus, frequencyLabel } from '../lib/bills'

interface BillRowProps {
  bill: Bill
  onOpen: () => void
  onPay?: () => void
}

export function BillRow({ bill, onOpen, onPay }: BillRowProps) {
  const status = billStatus(bill, todayISO())
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-start">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xl" aria-hidden>
          {bill.icon ?? '🧾'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{bill.name}</span>
          <span className="block text-xs text-ink-3">
            {frequencyLabel(bill.frequency)}
            {bill.amount ? (
              <>
                {' · '}
                <span className="num">
                  {bill.amount_type === 'fixed' ? '' : '~'}
                  {formatILS(Number(bill.amount))}
                </span>
              </>
            ) : null}
            {bill.auto_create ? ' · הוראת קבע' : ''}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
            status === 'overdue' && 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
            status === 'due_soon' && 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
            status === 'upcoming' && 'bg-surface-2 text-ink-2',
          )}
        >
          {relativeDay(bill.next_due_date)}
        </span>
      </button>
      {onPay && !bill.auto_create && status !== 'upcoming' && (
        <Button size="sm" onClick={onPay}>
          שולם
        </Button>
      )}
    </li>
  )
}
