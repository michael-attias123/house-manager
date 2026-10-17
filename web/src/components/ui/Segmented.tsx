import { cn } from '@/lib/cn'

interface SegmentedProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: { value: T; label: string }[]
  className?: string
}

export function Segmented<T extends string>({ value, onChange, options, className }: SegmentedProps<T>) {
  return (
    <div className={cn('flex rounded-xl bg-surface-2 p-1', className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'flex-1 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
            o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-ink-2',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
