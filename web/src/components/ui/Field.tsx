import { useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from '@/lib/cn'

const control =
  'w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-ink placeholder:text-ink-3 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(control, className)} {...props} />
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-20', className)} {...props} />
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(control, 'appearance-none', className)} {...props} />
}

interface FieldProps {
  label: string
  hint?: ReactNode
  children: (id: string) => ReactNode
  className?: string
}

/** Label + control. Children receive the id to put on the control. */
export function Field({ label, hint, children, className }: FieldProps) {
  const id = useId()
  return (
    <div className={cn('space-y-1.5', className)}>
      <label htmlFor={id} className="block text-sm font-medium text-ink-2">
        {label}
      </label>
      {children(id)}
      {hint && <p className="text-xs text-ink-3">{hint}</p>}
    </div>
  )
}
