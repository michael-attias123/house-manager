import type { ListItem } from '@/lib/db-types'
import { cn } from '@/lib/cn'
import { Sheet } from '@/components/ui/Sheet'
import { SHOPPING_CATEGORIES } from '../lib/categories'

interface CategoryPickerProps {
  item: ListItem
  onPick: (category: string) => void
  onClose: () => void
}

/** One tap moves an item to another department; the list remembers it. */
export function CategoryPicker({ item, onPick, onClose }: CategoryPickerProps) {
  return (
    <Sheet open onClose={onClose} title={`לאיזו מחלקה שייך ${item.name}?`}>
      <div className="grid grid-cols-2 gap-2">
        {SHOPPING_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => {
              if (c.id !== item.category) onPick(c.id)
              onClose()
            }}
            aria-pressed={c.id === item.category}
            className={cn(
              'flex min-h-12 items-center gap-2 rounded-xl border px-3 text-start active:bg-surface-2',
              c.id === item.category ? 'border-brand-600 bg-brand-50 dark:bg-brand-800/20' : 'border-line',
            )}
          >
            <span aria-hidden className="text-lg">
              {c.emoji}
            </span>
            <span className="text-sm">{c.label}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-3">בפעם הבאה שהפריט יתווסף, הוא יגיע ישר למחלקה שנבחרה, גם אצל השני.</p>
    </Sheet>
  )
}
