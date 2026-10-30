// The place form of going-out, shared by its screens and the admin's
// suggestions tab (features may not import each other's components).
import { useState } from 'react'
import type { SuggestionStatus, Venue } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorBox } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import type { LocationValue } from '@/features/going-out/hooks'
import type { FormMode } from '@/features/going-out/lib/draft'
import { VENUE_KINDS } from '@/features/going-out/lib/kinds'
import { findSimilar } from '@/features/going-out/lib/search'
import { venueFields, venueNameOk, type VenueDraft, type VenueFields } from '@/features/going-out/lib/venueDraft'
import { FormNote } from './FormNote'

/** keep: the saved location (editing a place that has one). */
type Where = 'keep' | 'here' | 'none'

interface VenueFormProps {
  /** create: a new suggestion. edit: the household's own, not approved. admin: any place. */
  mode: FormMode
  /** For "נראה שהמקום כבר קיים" when adding one. */
  venues: Venue[]
  location: LocationValue
  initial: VenueDraft
  /** edit: the suggestion's status; saving a rejected one sends it for approval again. */
  status?: SuggestionStatus
  onClose: () => void
  /** Saves; the form stays open, busy, until it settles, and shows a failure. */
  onSubmit: (fields: VenueFields) => Promise<unknown>
  /** "לבחור אותו": the place already exists. Create only. */
  onPick?: (venue: Venue) => void
}

export function VenueForm({ mode, venues, location, initial, status, onClose, onSubmit, onPick }: VenueFormProps) {
  const [draft, setDraft] = useState(initial)
  const [where, setWhere] = useState<Where>(
    initial.point ? 'keep' : mode === 'create' && location.state === 'granted' ? 'here' : 'none',
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Similar places someone said are a different place.
  const [different, setDifferent] = useState<ReadonlySet<number>>(new Set())
  const set = (patch: Partial<VenueDraft>) => setDraft((d) => ({ ...d, ...patch }))
  const editing = mode !== 'create'
  const admin = mode === 'admin'

  const here = location.state === 'granted' ? location.position : null
  const point = where === 'keep' ? initial.point : where === 'here' ? here : null
  const similar = !editing && draft.name.trim() ? findSimilar(venues, draft.name, point) : null
  const askAboutSimilar = similar != null && !different.has(similar.id)

  function chooseWhere(next: Where) {
    setWhere(next)
    setError(null)
    if (next === 'here' && location.state !== 'granted' && location.state !== 'asking') location.request()
  }

  async function save() {
    setError(null)
    if (!venueNameOk(draft)) return setError('צריך שם למקום')
    if (where === 'here' && !here) return setError('המיקום הנוכחי לא זמין. אפשר לבחור "בלי מיקום"')
    if (askAboutSimilar) return
    setBusy(true)
    try {
      await onSubmit(venueFields(draft, point))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const whereOptions: { value: Where; label: string }[] = [
    ...(initial.point ? [{ value: 'keep' as const, label: 'המיקום השמור' }] : []),
    { value: 'here', label: 'המיקום הנוכחי' },
    { value: 'none', label: 'בלי מיקום' },
  ]

  return (
    <Sheet
      open
      onClose={onClose}
      title={editing ? 'עריכת מקום' : 'הוספת מקום'}
      footer={
        <Button className="w-full" onClick={save} disabled={busy}>
          {editing ? 'שמירת השינויים' : 'שמירה והמשך לדיל'}
        </Button>
      }
    >
      <div className="space-y-4">
        <FormNote mode={mode} status={status} />

        <Field label="שם המקום">
          {(id) => <Input id={id} value={draft.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} />}
        </Field>

        {askAboutSimilar && (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p>נראה שהמקום כבר קיים: {similar.name}. לבחור אותו?</p>
            <div className="flex gap-2">
              {onPick && (
                <Button size="sm" onClick={() => onPick(similar)}>
                  לבחור אותו
                </Button>
              )}
              <Button variant="ghost" size="sm" onClick={() => setDifferent((s) => new Set([...s, similar.id]))}>
                זה מקום אחר
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">סוג</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="סוג המקום">
            {VENUE_KINDS.map((k) => (
              <Chip key={k.value} selected={draft.kind === k.value} onClick={() => set({ kind: k.value })}>
                <span aria-hidden>{k.emoji}</span>
                {k.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">מיקום</span>
          <Segmented<Where> value={where} onChange={chooseWhere} options={whereOptions} />
          {where === 'keep' && initial.point && (
            <p className="text-xs text-ink-3">
              <span className="num">
                {initial.point.lat.toFixed(5)}, {initial.point.lng.toFixed(5)}
              </span>
            </p>
          )}
          {where === 'here' && (
            <p className="text-xs text-ink-3">
              {location.state === 'granted' && 'יישמר המיקום שבו הטלפון נמצא עכשיו.'}
              {(location.state === 'asking' || location.state === 'idle') && 'מאתרים את המיקום…'}
              {location.state === 'denied' && 'אין הרשאת מיקום. אפשר לשמור בלי מיקום.'}
              {location.state === 'outside' && 'המיקום מחוץ לבאר שבע. אפשר לשמור בלי מיקום.'}
              {location.state === 'error' && 'המיקום לא זמין כרגע. אפשר לשמור בלי מיקום.'}
            </p>
          )}
        </div>

        <Field label="כתובת (לא חובה)">
          {(id) => <Input id={id} value={draft.address} maxLength={120} onChange={(e) => set({ address: e.target.value })} />}
        </Field>
        <Field label="Instagram (לא חובה)">
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              className="text-start"
              value={draft.instagram}
              maxLength={120}
              placeholder="@"
              onChange={(e) => set({ instagram: e.target.value })}
            />
          )}
        </Field>

        {admin && (
          <>
            <Field label="שעות פתיחה" hint="בפורמט של OpenStreetMap, למשל: Su-Th 18:00-02:00; Fr 21:00-04:00">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  className="text-start font-mono"
                  value={draft.openingHours}
                  maxLength={255}
                  placeholder="Mo-Su 18:00-02:00"
                  onChange={(e) => set({ openingHours: e.target.value })}
                />
              )}
            </Field>
            <Field label="אתר">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  className="text-start"
                  type="url"
                  value={draft.website}
                  maxLength={255}
                  onChange={(e) => set({ website: e.target.value })}
                />
              )}
            </Field>
            <Field label="טלפון">
              {(id) => (
                <Input
                  id={id}
                  dir="ltr"
                  className="num text-start"
                  type="tel"
                  value={draft.phone}
                  maxLength={40}
                  onChange={(e) => set({ phone: e.target.value })}
                />
              )}
            </Field>
          </>
        )}

        {error && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
