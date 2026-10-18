import { addDays, addMonths, maxDate, weekday, type ISODate } from './dates'

export type Recurrence =
  | { kind: 'once' }
  | { kind: 'daily' }
  | { kind: 'weekly'; weekdays: number[] }
  | { kind: 'every_n_days'; days: number }
  | { kind: 'monthly' }

/** First occurrence strictly after `after`, or null for one-off rules. */
export function nextOccurrence(rule: Recurrence, after: ISODate): ISODate | null {
  switch (rule.kind) {
    case 'once':
      return null
    case 'daily':
      return addDays(after, 1)
    case 'every_n_days':
      return addDays(after, Math.max(1, rule.days))
    case 'monthly':
      return addMonths(after, 1)
    case 'weekly': {
      const days = rule.weekdays.length ? rule.weekdays : [weekday(after)]
      for (let i = 1; i <= 7; i++) {
        const candidate = addDays(after, i)
        if (days.includes(weekday(candidate))) return candidate
      }
      return addDays(after, 7)
    }
  }
}

/**
 * Next due date once the occurrence due on `currentDue` is done on `today`.
 * Late completion counts from today; early completion skips to the
 * occurrence after the one that was due.
 */
export function nextDueAfterCompletion(
  rule: Recurrence,
  currentDue: ISODate,
  today: ISODate,
): ISODate | null {
  return nextOccurrence(rule, maxDate(currentDue, today))
}

/** Occurrences in [from, to], starting from the next due date. */
export function occurrencesBetween(
  rule: Recurrence,
  nextDue: ISODate,
  from: ISODate,
  to: ISODate,
): ISODate[] {
  const result: ISODate[] = []
  let current: ISODate | null = nextDue
  while (current && current <= to && result.length < 62) {
    if (current >= from) result.push(current)
    current = nextOccurrence(rule, current)
  }
  return result
}
