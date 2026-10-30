import { Check, Pencil } from 'lucide-react'
import type { ListItem } from '@/lib/db-types'
import { cn } from '@/lib/cn'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { getCategory } from '../lib/categories'
import { useLongPress } from '../lib/useLongPress'
import { QuantityStepper } from './QuantityStepper'

interface ItemRowProps {
  item: ListItem
  onToggle: () => void
  onEdit: () => void
  /** Shows the department as a button that opens the department picker. */
  onMove?: () => void
  /** Shows the quantity as a stepper (open items). */
  onQuantity?: (quantity: number) => void
  /** Holding the row starts selecting items. */
  onLongPress: () => void
  /** Selection mode: a tap selects instead of checking off. */
  selecting: boolean
  selected: boolean
  onSelect: () => void
  /** Briefly marks the row, e.g. when the same item was added again. */
  highlighted?: boolean
}

export function ItemRow({
  item,
  onToggle,
  onEdit,
  onMove,
  onQuantity,
  onLongPress,
  selecting,
  selected,
  onSelect,
  highlighted,
}: ItemRowProps) {
  const { memberById, user } = useHousehold()
  const longPress = useLongPress(onLongPress)
  const addedBy = item.added_by && item.added_by !== user.id ? memberById(item.added_by) : undefined
  const checkedBy = item.checked ? memberById(item.checked_by) : undefined
  const marked = selecting ? selected : item.checked

  return (
    <li
      data-item-id={item.id}
      className={cn(
        'flex items-center gap-1 rounded-xl transition-colors duration-700',
        highlighted && 'bg-brand-50 dark:bg-brand-800/30',
        selecting && selected && 'bg-brand-50 dark:bg-brand-800/20',
      )}
    >
      {onMove && !selecting && (
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
        // Kept while selecting too: it swallows the click that ends the long press.
        {...longPress}
        onClick={selecting ? onSelect : onToggle}
        className="flex min-h-12 flex-1 select-none items-center gap-3 rounded-xl px-2 text-start [-webkit-touch-callout:none] active:bg-surface-2"
        aria-pressed={marked}
        aria-label={selecting ? `בחירת ${item.name}` : undefined}
      >
        <span
          className={cn(
            'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
            selecting && 'rounded-md',
            marked ? 'border-brand-600 bg-brand-600 text-white' : 'border-ink-3',
          )}
        >
          {marked && <Check size={14} strokeWidth={3} />}
        </span>
        <span className="flex-1">
          <span className={cn('block', item.checked && 'text-ink-3 line-through')}>
            {item.name}
            {!onQuantity && item.quantity !== 1 && (
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
      {!selecting && onQuantity && (
        <QuantityStepper name={item.name} quantity={item.quantity} unit={item.unit} onChange={onQuantity} />
      )}
      {!selecting && (
        <button
          type="button"
          onClick={onEdit}
          className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-3 active:bg-surface-2"
          aria-label={`עריכת ${item.name}`}
        >
          <Pencil size={16} />
        </button>
      )}
    </li>
  )
}
