// The deal form of going-out, shared by its screens and the admin's
// suggestions tab (features may not import each other's components).
import { useMemo, useState, type ReactNode } from 'react'
import { Plus, Search } from 'lucide-react'
import type { SuggestionStatus, Venue } from '@/lib/db-types'
import { WEEKDAY_LABELS } from '@/lib/dates'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorBox } from '@/components/ui/Feedback'
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
  type FormMode,
} from '@/features/going-out/lib/draft'
import { DEAL_KINDS, venueKind } from '@/features/going-out/lib/kinds'
import { crossesMidnight, jerusalemClock } from '@/features/going-out/lib/schedule'
import { searchVenues } from '@/features/going-out/lib/search'
import { FormNote } from './FormNote'

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
  /** create: a new suggestion. edit: the household's own, not approved. admin: any deal, any status. */
  mode: FormMode
  /** The places to pick from. */
  venues: Venue[]
  initial: DealDraft
  /** edit: the suggestion's status; saving a rejected one sends it for approval again. */
  status?: SuggestionStatus
  /** admin: the deal's place (it stays), when `venues` doesn't have it. */
  place?: Pick<Venue, 'name' | 'kind'>
  onClose: () => void
  /** A promise keeps the form open, busy, until it settles; a failure shows here. */
  onSubmit: (fields: DealFields) => void | Promise<unknown>
  /** "המקום לא ברשימה?": the draft so far and what was typed in the search. Create only. */
  onAddVenue?: (draft: DealDraft, name: string) => void
}

export function DealForm({ mode, venues, initial, status, place, onClose, onSubmit, onAddVenue }: DealFormProps) {
  const [draft, setDraft] = useState(initial)
  const [query, setQuery] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)
  const today = jerusalemClock(new Date()).day
  const errors = checked ? validateDraft(draft, today) : {}
  const venue = venues.find((v) => v.id === draft.venueId) ?? (draft.venueId != null ? place : undefined)
  const editing = mode !== 'create'
  const results = useMemo(() => searchVenues(venues, query), [venues, query])
  const set = (patch: Partial<DealDraft>) => setDraft((d) => ({ ...d, ...patch }))

  const toggleDay = (day: number) =>
    set({ weekdays: draft.weekdays.includes(day) ? draft.weekdays.filter((d) => d !== day) : [...draft.weekdays, day] })

  async function save() {
    setChecked(true)
    if (Object.keys(validateDraft(draft, today)).length > 0) return
    setError(null)
    const pending = onSubmit(draftToFields(draft))
    if (!(pending instanceof Promise)) return
    setBusy(true)
    try {
      await pending
    } catch (err) {
      setError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'עריכת דיל' : 'הוספת דיל'}
      footer={
        <Button className="w-full" onClick={save} disabled={busy}>
          {editing ? 'שמירת השינויים' : 'שמירה'}
        </Button>
      }
    >
      <div className="space-y-4">
        {/* A new deal's "sent for approval" comes as a notice after saving. */}
        {editing && <FormNote mode={mode} status={status} />}
        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">מקום</span>
          {venue ? (
            <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
              <span aria-hidden>{venueKind(venue.kind).emoji}</span>
              <span className="min-w-0 flex-1 truncate font-medium">{venue.name}</span>
              {/* An admin edits the deal, not where it is. */}
              {mode !== 'admin' && (
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
              )}
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
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {query.trim() && results.length === 0 && <p className="text-sm text-ink-3">לא נמצא מקום בשם הזה</p>}
              {onAddVenue && (
                <Button variant="ghost" size="sm" className="px-1" onClick={() => onAddVenue(draft, query.trim())}>
                  <Plus size={14} />
                  המקום לא ברשימה? הוספת מקום
                </Button>
              )}
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
                placeholder={draft.kind === 'member_card' ? 'למשל: 10% הנחה בכרטיס חבר' : 'למשל: יין ללא תחתית'}
              />
              <FieldError error={errors.title} />
            </>
          )}
        </Field>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">סוג</span>
          <Segmented
            value={draft.kind}
            // A card discount usually holds every day, all opening hours.
            onChange={(kind) => set(kind === 'member_card' ? { kind, weekdays: [], allHours: true } : { kind })}
            options={DEAL_KINDS.map((k) => ({ value: k.value, label: k.label }))}
          />
          {draft.kind === 'member_card' && (
            <p className="text-xs text-ink-3">
              הנחה למחזיקי כרטיס חבר (מועדון חבר של משרתי הקבע). מופיע על המקום, לא ב״עכשיו״. כדאי לבדוק את התנאים
              באתר המועדון.
            </p>
          )}
        </div>

        {draft.kind !== 'event' && (
          <div className="space-y-1.5">
            <span className="block text-sm font-medium text-ink-2">ימים</span>
            <div className="flex flex-wrap gap-1">
              {(draft.kind === 'happy_hour' || draft.kind === 'member_card') && (
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

        {error != null && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
