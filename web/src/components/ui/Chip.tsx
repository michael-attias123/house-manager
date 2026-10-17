import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
}

export function Chip({ selected, className, type = 'button', ...props }: ChipProps) {
  return (
    <button
      type={type}
      aria-pressed={selected}
      className={cn(
        'inline-flex h-8 shrink-0 items-center gap-1 rounded-full border px-3 text-sm transition-colors',
        selected
          ? 'border-brand-600 bg-brand-50 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100'
          : 'border-line bg-surface text-ink-2',
        className,
      )}
      {...props}
    />
  )
}
