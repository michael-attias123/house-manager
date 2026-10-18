import { useState } from 'react'
import { Archive } from 'lucide-react'
import type { Chore, ChoreRecurrence } from '@/lib/db-types'
import { todayISO, WEEKDAY_LABELS } from '@/lib/dates'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input, Select } from '@/components/ui/Field'
import { ErrorBox } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { useArchiveChore, useSaveChore } from '../hooks'
import { CHORE_PRESETS, type ChorePreset } from '../lib/chores'

const RECURRENCES: { value: ChoreRecurrence; label: string }[] = [
  { value: 'daily', label: 'כל יום' },
  { value: 'weekly', label: 'בימים קבועים בשבוע' },
  { value: 'every_n_days', label: 'כל כמה ימים' },
  { value: 'monthly', label: 'כל חודש' },
  { value: 'once', label: 'פעם אחת' },
]

export function ChoreSheet({ chore, onClose }: { chore?: Chore; onClose: () => void }) {
  const { household, members, user } = useHousehold()
  const save = useSaveChore()
  const archive = useArchiveChore()
  const [title, setTitle] = useState(chore?.title ?? '')
  const [emoji, setEmoji] = useState(chore?.emoji ?? '✅')
  const [recurrence, setRecurrence] = useState<ChoreRecurrence>(chore?.recurrence ?? 'weekly')
  const [weekdays, setWeekdays] = useState<number[]>(chore?.weekdays ?? [new Date().getDay()])
  const [intervalDays, setIntervalDays] = useState(String(chore?.interval_days ?? 3))
  const [assignment, setAssignment] = useState<Chore['assignment']>(chore?.assignment ?? 'rotate')
  const [assignee, setAssignee] = useState(chore?.assignee_id ?? user.id)
  const [nextDue, setNextDue] = useState(chore?.next_due ?? todayISO())
  const [error, setError] = useState<unknown>(null)

  function applyPreset(p: ChorePreset) {
    setTitle(p.title)
    setEmoji(p.emoji)
    setRecurrence(p.recurrence)
    if (p.weekdays) setWeekdays(p.weekdays)
    if (p.interval_days) setIntervalDays(String(p.interval_days))
  }

  async function submit() {
    setError(null)
    if (!title.trim()) return setError(new Error('צריך שם למטלה'))
    if (recurrence === 'weekly' && weekdays.length === 0) return setError(new Error('בחרו לפחות יום אחד'))
    try {
      await save.mutateAsync({
        id: chore?.id,
        household_id: household.id,
        title: title.trim(),
        emoji: emoji || null,
        recurrence,
        weekdays: recurrence === 'weekly' ? [...weekdays].sort() : null,
        interval_days: recurrence === 'every_n_days' ? Math.max(1, Number(intervalDays) || 1) : null,
        assignment,
        assignee_id: assignment === 'anyone' ? null : assignee,
        next_due: nextDue,
      })
      onClose()
    } catch (err) {
      setError(err)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={chore ? 'עריכת מטלה' : 'מטלה חדשה'}
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" onClick={submit} disabled={save.isPending}>
            שמירה
          </Button>
          {chore && (
            <Button
              variant="ghost"
              aria-label="מחיקה"
              onClick={async () => {
                await archive.mutateAsync(chore.id)
                onClose()
              }}
            >
              <Archive size={18} />
            </Button>
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {!chore && (
          <div className="-mx-5 flex gap-2 overflow-x-auto px-5 pb-1">
            {CHORE_PRESETS.map((p) => (
              <Chip key={p.title} selected={title === p.title} onClick={() => applyPreset(p)}>
                {p.emoji} {p.title}
              </Chip>
            ))}
          </div>
        )}
        <div className="grid grid-cols-[4rem_1fr] gap-3">
          <Field label="אייקון">
            {(id) => <Input id={id} className="text-center text-xl" value={emoji} onChange={(e) => setEmoji(e.target.value)} />}
          </Field>
          <Field label="מה צריך לעשות?">
            {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
        </div>
        <Field label="כל כמה זמן?">
          {(id) => (
            <Select id={id} value={recurrence} onChange={(e) => setRecurrence(e.target.value as ChoreRecurrence)}>
              {RECURRENCES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {recurrence === 'weekly' && (
          <div className="flex justify-between gap-1">
            {WEEKDAY_LABELS.map((label, day) => (
              <Chip
                key={day}
                selected={weekdays.includes(day)}
                className="h-10 w-10 justify-center px-0"
                onClick={() =>
                  setWeekdays((w) => (w.includes(day) ? w.filter((d) => d !== day) : [...w, day]))
                }
              >
                {label}
              </Chip>
            ))}
          </div>
        )}
        {recurrence === 'every_n_days' && (
          <Field label="מספר ימים">
            {(id) => (
              <Input id={id} inputMode="numeric" value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
            )}
          </Field>
        )}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">מי אחראי/ת?</span>
          <Segmented
            value={assignment}
            onChange={setAssignment}
            options={[
              { value: 'rotate', label: 'תורנות' },
              { value: 'fixed', label: 'קבוע' },
              { value: 'anyone', label: 'מי שפנוי' },
            ]}
          />
        </div>
        {assignment !== 'anyone' && (
          <Field label={assignment === 'rotate' ? 'התור הבא של' : 'אחראי/ת'}>
            {(id) => (
              <Select id={id} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
                {members.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.display_name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="מתי בפעם הבאה?">
          {(id) => <Input id={id} type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />}
        </Field>
        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
