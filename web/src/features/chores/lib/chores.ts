import type { Chore, ChoreCompletion, HouseholdMember } from '@/lib/db-types'
import { addDays, diffDays, monthKey, WEEKDAY_LABELS, type ISODate } from '@/lib/dates'
import { nextDueAfterCompletion, type Recurrence } from '@/lib/recurrence'

type RecurrenceFields = Pick<Chore, 'recurrence' | 'interval_days' | 'weekdays'>

export function toRecurrence(chore: RecurrenceFields): Recurrence {
  switch (chore.recurrence) {
    case 'weekly':
      return { kind: 'weekly', weekdays: chore.weekdays ?? [] }
    case 'every_n_days':
      return { kind: 'every_n_days', days: chore.interval_days ?? 1 }
    default:
      return { kind: chore.recurrence }
  }
}

export function recurrenceLabel(chore: RecurrenceFields): string {
  switch (chore.recurrence) {
    case 'once':
      return 'חד פעמי'
    case 'daily':
      return 'כל יום'
    case 'monthly':
      return 'כל חודש'
    case 'every_n_days':
      return chore.interval_days === 7 ? 'כל שבוע' : `כל ${chore.interval_days ?? 1} ימים`
    case 'weekly': {
      const days = [...(chore.weekdays ?? [])].sort()
      if (days.length === 0 || days.length === 7) return days.length === 7 ? 'כל יום' : 'כל שבוע'
      return `ימי ${days.map((d) => WEEKDAY_LABELS[d]).join(' ')}`
    }
  }
}

export interface ChoreUpdate {
  next_due: ISODate
  active: boolean
  assignee_id: string | null
}

/**
 * What changes on a chore once `doneBy` completes it today: the next due
 * date, and for rotating chores whose turn it is next (the member after the
 * one who did it, so doing it out of turn is "paid back").
 */
export function completionUpdate(
  chore: Chore,
  members: Pick<HouseholdMember, 'user_id'>[],
  doneBy: string,
  today: ISODate,
): ChoreUpdate {
  const next = nextDueAfterCompletion(toRecurrence(chore), chore.next_due, today)
  let assignee = chore.assignee_id
  if (chore.assignment === 'rotate' && members.length > 0) {
    const index = members.findIndex((m) => m.user_id === doneBy)
    assignee = members[(index + 1) % members.length].user_id
  }
  return { next_due: next ?? chore.next_due, active: next !== null, assignee_id: assignee }
}

export type ChoreBucket = 'overdue' | 'today' | 'week' | 'later'

export function choreBucket(chore: Pick<Chore, 'next_due'>, today: ISODate): ChoreBucket {
  const days = diffDays(chore.next_due, today)
  if (days < 0) return 'overdue'
  if (days === 0) return 'today'
  if (days <= 6) return 'week'
  return 'later'
}

export function isDueBy(chore: Pick<Chore, 'next_due'>, date: ISODate): boolean {
  return chore.next_due <= date
}

/** Completions per member in the given month ("2026-10"). */
export function completionCounts(completions: ChoreCompletion[], month: string): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const c of completions) {
    if (monthKey(c.done_on) !== month) continue
    counts[c.done_by] = (counts[c.done_by] ?? 0) + 1
  }
  return counts
}

export const weekEnd = (today: ISODate) => addDays(today, 6)

export interface ChorePreset {
  title: string
  emoji: string
  recurrence: Chore['recurrence']
  interval_days?: number
  weekdays?: number[]
}

export const CHORE_PRESETS: ChorePreset[] = [
  { title: 'להוציא זבל', emoji: '🗑️', recurrence: 'every_n_days', interval_days: 2 },
  { title: 'כביסה', emoji: '🧺', recurrence: 'weekly', weekdays: [0, 3] },
  { title: 'לרוקן מדיח', emoji: '🍽️', recurrence: 'daily' },
  { title: 'שטיפת רצפה', emoji: '🧹', recurrence: 'weekly', weekdays: [5] },
  { title: 'ניקוי שירותים ומקלחת', emoji: '🚿', recurrence: 'weekly', weekdays: [4] },
  { title: 'החלפת מצעים', emoji: '🛏️', recurrence: 'every_n_days', interval_days: 14 },
  { title: 'השקיית עציצים', emoji: '🪴', recurrence: 'every_n_days', interval_days: 3 },
  { title: 'ניקוי מקרר', emoji: '🧊', recurrence: 'monthly' },
  { title: 'ניקוי פילטר מזגן', emoji: '❄️', recurrence: 'every_n_days', interval_days: 60 },
]
