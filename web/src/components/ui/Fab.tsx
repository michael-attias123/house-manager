import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

/** Floating action button, sits above the bottom navigation. */
export function Fab({ className, type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={cn(
        'fixed bottom-[calc(5.5rem+env(safe-area-inset-bottom))] left-4 z-30 flex h-14 items-center gap-2 rounded-2xl bg-brand-700 px-5 font-medium text-white shadow-lg shadow-brand-700/30 active:scale-95 sm:left-[calc(50%-15rem)]',
        className,
      )}
      {...props}
    />
  )
}
