import { Check } from 'lucide-react'
import type { Chore } from '@/lib/db-types'
import { relativeDay, todayISO } from '@/lib/dates'
import { cn } from '@/lib/cn'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { choreBucket, recurrenceLabel } from '../lib/chores'

interface ChoreRowProps {
  chore: Chore
  onComplete: () => void
  onOpen: () => void
}

export function ChoreRow({ chore, onComplete, onOpen }: ChoreRowProps) {
  const { memberById } = useHousehold()
  const bucket = choreBucket(chore, todayISO())
  const assignee = chore.assignment !== 'anyone' ? memberById(chore.assignee_id) : undefined

  return (
    <li className="flex items-center gap-3 px-3 py-2">
      <button
        type="button"
        onClick={onComplete}
        aria-label={`סימון ${chore.title} כבוצע`}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 text-ink-3 transition-colors active:bg-brand-600 active:text-white',
          bucket === 'overdue' ? 'border-rose-400' : 'border-line',
        )}
      >
        <Check size={18} />
      </button>
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 text-start">
        <span className="text-xl" aria-hidden>
          {chore.emoji ?? '✅'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate">{chore.title}</span>
          <span className="block text-xs text-ink-3">
            {recurrenceLabel(chore)}
            {chore.assignment === 'rotate' && ' · בתורנות'}
          </span>
        </span>
        <span
          className={cn(
            'shrink-0 text-xs',
            bucket === 'overdue' ? 'font-medium text-rose-600' : 'text-ink-3',
          )}
        >
          {relativeDay(chore.next_due)}
        </span>
        {assignee && <MemberAvatar member={assignee} size="sm" />}
      </button>
    </li>
  )
}
