import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/Field'

/** The place search above the list; ✕ clears it and closes the bar. */
export function SearchBar({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  return (
    <div className="relative">
      <Search size={18} className="pointer-events-none absolute start-3 top-3 text-ink-3" />
      <Input
        autoFocus
        type="search"
        enterKeyHint="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
        placeholder="שם, רחוב או סוג אוכל"
        aria-label="חיפוש מקום"
        className="ps-10 pe-10"
      />
      <button
        type="button"
        onClick={onClose}
        aria-label="סגירת החיפוש"
        className="absolute end-1 top-1 flex h-9 w-9 items-center justify-center rounded-lg text-ink-3 active:bg-surface-2"
      >
        <X size={18} />
      </button>
    </div>
  )
}
