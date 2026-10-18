import type { Chore, ChoreCompletion } from '@/lib/db-types'
import { completionCounts, completionUpdate, recurrenceLabel } from './chores'

const members = [{ user_id: 'a' }, { user_id: 'b' }]
const base: Chore = {
  id: '1',
  household_id: 'h',
  title: 'זבל',
  emoji: null,
  recurrence: 'every_n_days',
  interval_days: 2,
  weekdays: null,
  assignment: 'rotate',
  assignee_id: 'a',
  next_due: '2026-10-17',
  active: true,
}

describe('completionUpdate', () => {
  it('rotates to the other member and schedules the next time', () => {
    expect(completionUpdate(base, members, 'a', '2026-10-17')).toEqual({
      next_due: '2026-10-19',
      active: true,
      assignee_id: 'b',
    })
  })

  it('gives the turn back when done out of turn', () => {
    expect(completionUpdate(base, members, 'b', '2026-10-17').assignee_id).toBe('a')
  })

  it('keeps fixed assignees and finishes one-off chores', () => {
    expect(completionUpdate({ ...base, assignment: 'fixed' }, members, 'b', '2026-10-17').assignee_id).toBe('a')
    expect(completionUpdate({ ...base, recurrence: 'once' }, members, 'a', '2026-10-17').active).toBe(false)
  })
})

describe('chores helpers', () => {
  it('labels recurrences', () => {
    expect(recurrenceLabel({ recurrence: 'weekly', weekdays: [0, 3], interval_days: null })).toBe('ימי א׳ ד׳')
    expect(recurrenceLabel({ recurrence: 'every_n_days', interval_days: 3, weekdays: null })).toBe('כל 3 ימים')
  })

  it('counts completions per member in a month', () => {
    const completions = [
      { done_by: 'a', done_on: '2026-10-01' },
      { done_by: 'a', done_on: '2026-10-05' },
      { done_by: 'b', done_on: '2026-10-06' },
      { done_by: 'b', done_on: '2026-09-30' },
    ] as ChoreCompletion[]
    expect(completionCounts(completions, '2026-10')).toEqual({ a: 2, b: 1 })
  })
})
