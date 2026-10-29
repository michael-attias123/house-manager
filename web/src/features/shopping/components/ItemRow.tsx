import { Check, Pencil } from 'lucide-react'
import type { ListItem } from '@/lib/db-types'
import { cn } from '@/lib/cn'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { getCategory } from '../lib/categories'

interface ItemRowProps {
  item: ListItem
  onToggle: () => void
  onEdit: () => void
  /** Shows the department as a button that opens the department picker. */
  onMove?: () => void
}

export function ItemRow({ item, onToggle, onEdit, onMove }: ItemRowProps) {
  const { memberById, user } = useHousehold()
  const addedBy = item.added_by && item.added_by !== user.id ? memberById(item.added_by) : undefined
  const checkedBy = item.checked ? memberById(item.checked_by) : undefined

  return (
    <li className="flex items-center gap-1">
      {onMove && (
        <button
          type="button"
          onClick={onMove}
          className="flex h-10 w-9 shrink-0 items-center justify-center rounded-lg text-lg active:bg-surface-2"
          aria-label={`העברת ${item.name} למחלקה אחרת`}
        >
          <span aria-hidden>{getCategory(item.category).emoji}</span>
        </button>
      )}
      <button
        type="button"
        onClick={onToggle}
        className="flex min-h-12 flex-1 items-center gap-3 rounded-xl px-2 text-start active:bg-surface-2"
        aria-pressed={item.checked}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            item.checked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-3',
          )}
        >
          {item.checked && <Check size={14} strokeWidth={3} />}
        </span>
        <span className="flex-1">
          <span className={cn('block', item.checked && 'text-ink-3 line-through')}>
            {item.name}
            {item.quantity !== 1 && (
              <span className="num ms-2 rounded-md bg-surface-2 px-1.5 text-sm text-ink-2">
                ×{item.quantity}
                {item.unit ? ` ${item.unit}` : ''}
              </span>
            )}
          </span>
          {item.note && <span className="block text-xs text-ink-3">{item.note}</span>}
        </span>
        {checkedBy ? (
          <MemberAvatar member={checkedBy} size="sm" />
        ) : addedBy ? (
          <MemberAvatar member={addedBy} size="sm" className="opacity-60" />
        ) : null}
      </button>
      <button
        type="button"
        onClick={onEdit}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-3 active:bg-surface-2"
        aria-label={`עריכת ${item.name}`}
      >
        <Pencil size={16} />
      </button>
    </li>
  )
}
