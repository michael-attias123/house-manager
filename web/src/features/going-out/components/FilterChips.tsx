import { Chip } from '@/components/ui/Chip'
import { KIND_FILTERS } from '../lib/kinds'
import type { Filters } from '../lib/rank'

/** הכל · ברים · מסעדות · בתי קפה, and "רק עם דיל" on top of any of them. */
export function FilterChips({ value, onChange }: { value: Filters; onChange: (value: Filters) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="סינון">
      {KIND_FILTERS.map((f) => (
        <Chip key={f.value} selected={value.kind === f.value} onClick={() => onChange({ ...value, kind: f.value })}>
          {f.label}
        </Chip>
      ))}
      <Chip selected={value.dealsOnly} onClick={() => onChange({ ...value, dealsOnly: !value.dealsOnly })}>
        רק עם דיל
      </Chip>
    </div>
  )
}
