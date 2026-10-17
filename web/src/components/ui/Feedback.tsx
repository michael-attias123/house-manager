import type { ReactNode } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-ink-3', className)} size={20} />
}

export function Loading() {
  return (
    <div className="flex justify-center py-12">
      <Spinner />
    </div>
  )
}

export function ErrorBox({ error }: { error: unknown }) {
  const message = error instanceof Error ? error.message : String(error)
  return (
    <div className="flex items-start gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">
      <AlertTriangle size={18} className="mt-0.5 shrink-0" />
      <span>{message}</span>
    </div>
  )
}

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  children?: ReactNode
}

export function EmptyState({ icon, title, children }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      {icon && <div className="text-4xl">{icon}</div>}
      <p className="font-medium text-ink">{title}</p>
      {children && <div className="text-sm text-ink-2">{children}</div>}
    </div>
  )
}
