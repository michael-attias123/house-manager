import { Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { ConfirmButton } from '@/components/ui/ConfirmButton'

interface SelectionBarProps {
  count: number
  total: number
  onSelectAll: () => void
  onDelete: () => void
  onCancel: () => void
}

/** Sits above the bottom navigation while items are being selected. */
export function SelectionBar({ count, total, onSelectAll, onDelete, onCancel }: SelectionBarProps) {
  return (
    <div className="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-30 px-4">
      <div className="mx-auto flex max-w-lg items-center gap-2 rounded-2xl border border-line bg-surface p-2 shadow-lg">
        <Button variant="ghost" size="icon" onClick={onCancel} aria-label="ביטול הבחירה">
          <X size={20} />
        </Button>
        <span className="flex-1 text-sm font-medium" aria-live="polite">
          <span className="num">{count}</span> נבחרו
        </span>
        {count < total && (
          <Button variant="ghost" size="sm" onClick={onSelectAll}>
            בחירת הכל
          </Button>
        )}
        <ConfirmButton variant="secondary" size="sm" onConfirm={onDelete} confirmLabel={`למחוק ${count}?`}>
          <Trash2 size={16} />
          מחיקה
        </ConfirmButton>
      </div>
    </div>
  )
}
