import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { countWord } from '../lib/admin'

const tones = {
  neutral: 'bg-surface-2 text-ink-2',
  brand: 'bg-brand-50 text-brand-800 dark:bg-brand-800/30 dark:text-brand-100',
  warn: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  danger: 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300',
}

export type TagTone = keyof typeof tones

export function Tag({ tone = 'neutral', children }: { tone?: TagTone; children: ReactNode }) {
  return <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', tones[tone])}>{children}</span>
}

/** "<n> הוצאות", with the number isolated for RTL. */
export function Count({ n, one, many }: { n: number; one: string; many: string }) {
  return (
    <>
      <span className="num">{n.toLocaleString('he-IL')}</span> {countWord(n, one, many)}
    </>
  )
}

/** Explains why an action is not offered, or what it does. */
export function Hint({ children }: { children: ReactNode }) {
  return <p className="px-1 text-xs text-ink-3">{children}</p>
}
