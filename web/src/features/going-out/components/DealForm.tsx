import { useMemo, useState, type ReactNode } from 'react'
import { Plus, Search } from 'lucide-react'
import type { Venue, VenueDeal } from '@/lib/db-types'
import { WEEKDAY_LABELS } from '@/lib/dates'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Field, Input, Textarea } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import {
  draftToFields,
  NOTE_MAX,
  TITLE_MAX,
  TITLE_MIN,
  validateDraft,
  type DealDraft,
  type DealFields,
  type DraftError,
} from '../lib/draft'
import { DEAL_KINDS, venueKind } from '../lib/kinds'
import { crossesMidnight, jerusalemClock } from '../lib/schedule'
import { searchVenues } from '../lib/search'
import { StatusTag } from './Labels'

const MESSAGES: Record<DraftError, ReactNode> = {
  venue_missing: 'צריך לבחור מקום',
  title_short: (
    <>
      צריך לכתוב מה הדיל, לפחות <span className="num">{TITLE_MIN}</span> תווים
    </>
  ),
  title_long: (
    <>
      עד <span className="num">{TITLE_MAX}</span> תווים
    </>
  ),
  days_missing: 'צריך לבחור לפחות יום אחד',
  hours_missing: 'צריך שעת התחלה ושעת סיום, או "כל שעות הפתיחה"',
  hours_equal: 'שעת הסיום זהה לשעת ההתחלה',
  date_missing: 'צריך תאריך לאירוע',
  date_past: 'התאריך כבר עבר',
  note_long: (
    <>
      עד <span className="num">{NOTE_MAX}</span> תווים
    </>
  ),
}

function FieldError({ error }: { error: DraftError | undefined }) {
  if (!error) return null
  return <p className="text-sm text-rose-700 dark:text-rose-300">{MESSAGES[error]}</p>
}

interface DealFormProps {
  venues: Venue[]
  initial: DealDraft
  /** Editing the household's own deal that isn't approved yet. */
  deal?: VenueDeal
  onClose: () => void
  onSubmit: (fields: DealFields) => void
  /** "המקום לא ברשימה?": the draft so far and what was typed in the search. */
  onAddVenue: (draft: DealDraft, name: string) => void
}

export function DealForm({ venues, initial, deal, onClose, onSubmit, onAddVenue }: DealFormProps) {
  const [draft, setDraft] = useState(initial)
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState(false)
  const today = jerusalemClock(new Date()).day
  const errors = checked ? validateDraft(draft, today) : {}
  const venue = venues.find((v) => v.id === draft.venueId)
  const results = useMemo(() => searchVenues(venues, query), [venues, query])
  const set = (patch: Partial<DealDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const toggleDay = (day: number) =>
    set({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day] })

  function save() {
    setChecked(true)
    if (Object.keys(validateDraft(draft, today)).length > 0) return
    onSubmit(draftToFields(draft))
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={deal ? 'עריכת דיל' : 'הוספת דיל'}
      footer={
        <Button className="w-full" onClick={save}>
          {deal ? 'שמירת השינויים' : 'שמירה'}
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">מקום</span>
          {venue ? (
            <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <span aria-hidden>{venueKind(venue.kind).emoji}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{venue.name}</span>
              <StatusTag status={venue.status} />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  set({ venueId: null })
                  setQuery('')
                }}
              >
                שינוי
              </Button>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="relative">
                <Search size={18} className="pointer-events-none absolute start-3 top-3 text-ink-3" />
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="חיפוש לפי שם המקום"
                  aria-label="חיפוש מקום"
                  className="ps-10"
                />
              </div>
              {results.length > 0 && (
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {results.map((v) => (
                    <li key={v.id}>
                      <button
                        type="button"
                        onClick={() => set({ venueId: v.id })}
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-start active:bg-surface-2"
                      >
                        <span aria-hidden>{venueKind(v.kind).emoji}</span>
                        <span className="min-w-0 flex-1 truncate">{v.name}</span>
                        <StatusTag status={v.status} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && results.length === 0 && <p className="text-sm text-ink-3">לא נמצא מקום בשם הזה</p>}
              <Button variant="ghost" size="sm" className="px-1" onClick={() => onAddVenue(draft, query.trim())}>
                <Plus size={14} />
                המקום לא ברשימה? הוספת מקום
              </Button>
            </div>
          )}
          <FieldError error={errors.venue} />
        </div>

        <Field label="מה הדיל">
          {(id) => (
            <>
              <Input
                id={id}
                value={draft.title}
                maxLength={TITLE_MAX}
                onChange={(e) => set({ title: e.target.value })}
                placeholder="למשל: יין ללא תחתית"
              />
              <FieldError error={errors.title} />
            </>
          )}
        </Field>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">סוג</span>
          <Segmented
            value={draft.kind}
            onChange={(kind) => set({ kind })}
            options={DEAL_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          />
        </div>

        {draft.kind !== 'event' && (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-ink-2">ימים</span>
            <div className="flex flex-wrap gap-1">
              {draft.kind === 'happy_hour' && (
                <Chip selected={draft.weekdays.length === 0} onClick={() => set({ weekdays: [] })}>
                  כל יום
                </Chip>
              )}
              {WEEKDAY_LABELS.map((label, day) => (
                <Chip
                  key={label}
                  selected={draft.weekdays.includes(day)}
                  onClick={() => toggleDay(day)}
                  className="w-9 justify-center px-0"
                >
                  {label}
                </Chip>
              ))}
            </div>
            <FieldError error={errors.days} />
          </div>
        )}

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">שעות</span>
          <Chip selected={draft.allHours} onClick={() => set({ allHours: !draft.allHours })}>
            כל שעות הפתיחה
          </Chip>
          {!draft.allHours && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="מ־">
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    className="num"
                    value={draft.startsAt}
                    onChange={(e) => set({ startsAt: e.target.value })}
                  />
                )}
              </Field>
              <Field label="עד" hint={crossesMidnight(draft.startsAt, draft.endsAt) ? 'עד למחרת' : undefined}>
                {(id) => (
                  <Input
                    id={id}
                    type="time"
                    className="num"
                    value={draft.endsAt}
                    onChange={(e) => set({ endsAt: e.target.value })}
                  />
                )}
              </Field>
            </div>
          )}
          <FieldError error={errors.hours} />
        </div>

        <Field label={draft.kind === 'event' ? 'תאריך' : 'בתוקף עד (לא חובה)'}>
          {(id) => (
            <>
              <Input
                id={id}
                type="date"
                className="num"
                min={today}
                value={draft.date}
                onChange={(e) => set({ date: e.target.value })}
              />
              <FieldError error={errors.date} />
            </>
          )}
        </Field>

        <Field label="הערה (לא חובה)">
          {(id) => (
            <>
              <Textarea
                id={id}
                value={draft.note}
                maxLength={NOTE_MAX}
                onChange={(e) => set({ note: e.target.value })}
                placeholder="תנאים, מחיר, הזמנה מראש…"
              />
              <FieldError error={errors.note} />
            </>
          )}
        </Field>
      </div>
    </Sheet>
  )
}
