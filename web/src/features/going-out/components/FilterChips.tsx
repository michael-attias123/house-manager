import { Search } from 'lucide-react'
import { Chip } from '@/components/ui/Chip'
import { KIND_FILTERS } from '../lib/kinds'
import type { Filters } from '../lib/rank'

/**
 * הכל · ברים · מסעדות · בתי קפה, with "רק עם דיל" and "כרטיס חבר" on top of
 * any of them, and the search button (hidden while the search bar is open).
 */
export function FilterChips({
  value,
  onChange,
  onSearch,
}: {
  value: Filters
  onChange: (value: Filters) => void
  onSearch?: () => void
}) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex flex-1 flex-wrap gap-2" role="group" aria-label="סינון">
        {KIND_FILTERS.map((f) => (
          <Chip key={f.value} selected={value.kind === f.value} onClick={() => onChange({ ...value, kind: f.value })}>
            {f.label}
          </Chip>
        ))}
        <Chip selected={value.dealsOnly} onClick={() => onChange({ ...value, dealsOnly: !value.dealsOnly })}>
          רק עם דיל
        </Chip>
        <Chip selected={value.memberCard} onClick={() => onChange({ ...value, memberCard: !value.memberCard })}>
          <span aria-hidden>💳</span> כרטיס חבר
        </Chip>
      </div>
      {onSearch && (
        <button
          type="button"
          onClick={onSearch}
          aria-label="חיפוש מקום"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface text-ink-2 active:bg-surface-2"
        >
          <Search size={18} />
        </button>
      )}
    </div>
  )
}
