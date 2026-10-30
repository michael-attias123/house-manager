import { useState } from 'react'
import type { Venue, VenueKind } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorBox } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { Segmented } from '@/components/ui/Segmented'
import { Sheet } from '@/components/ui/Sheet'
import { useAddVenue, type LocationValue } from '../hooks'
import { VENUE_KINDS } from '../lib/kinds'
import { findSimilar } from '../lib/search'

type Where = 'here' | 'none'

interface VenueFormProps {
  venues: Venue[]
  location: LocationValue
  initialName: string
  onClose: () => void
  /** Saved: go on to a deal at it. */
  onSaved: (venue: Venue) => void
  /** "לבחור אותו": the place already exists. */
  onPick: (venue: Venue) => void
}

/** A place that isn't in the catalog: saved for the household, sent for approval. */
export function VenueForm({ venues, location, initialName, onClose, onSaved, onPick }: VenueFormProps) {
  const add = useAddVenue()
  const [name, setName] = useState(initialName)
  const [kind, setKind] = useState<VenueKind>('bar')
  const [where, setWhere] = useState<Where>(location.state === 'granted' ? 'here' : 'none')
  const [address, setAddress] = useState('')
  const [instagram, setInstagram] = useState('')
  const [error, setError] = useState<string | null>(null)
  // Similar places someone said are a different place.
  const [different, setDifferent] = useState<ReadonlySet<number>>(new Set())

  const point = where === 'here' && location.state === 'granted' ? location.position : null
  const similar = name.trim() ? findSimilar(venues, name, point) : null
  const askAboutSimilar = similar != null && !different.has(similar.id)

  function chooseWhere(next: Where) {
    setWhere(next)
    setError(null)
    if (next === 'here' && location.state !== 'granted' && location.state !== 'asking') location.request()
  }

  async function save() {
    setError(null)
    if (name.trim().length < 2) return setError('צריך שם למקום')
    if (where === 'here' && !point) return setError('המיקום הנוכחי לא זמין. אפשר לבחור "בלי מיקום"')
    if (askAboutSimilar) return
    try {
      const venue = await add.mutateAsync({
        name: name.trim(),
        kind,
        lat: point?.lat ?? null,
        lng: point?.lng ?? null,
        address: address.trim() || null,
        instagram: instagram.trim() || null,
      })
      onSaved(venue)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="הוספת מקום"
      footer={
        <Button className="w-full" onClick={save} disabled={add.isPending}>
          שמירה והמשך לדיל
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-ink-2">המקום נשמר לבית שלכם ונשלח לאישור. אחרי אישור יופיע לכולם.</p>

        <Field label="שם המקום">
          {(id) => <Input id={id} value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />}
        </Field>

        {askAboutSimilar && (
          <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
            <p>נראה שהמקום כבר קיים: {similar.name}. לבחור אותו?</p>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => onPick(similar)}>
                לבחור אותו
              </Button>
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
              <Chip key={k.value} selected={kind === k.value} onClick={() => setKind(k.value)}>
                <span aria-hidden>{k.emoji}</span>
                {k.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <span className="block text-sm font-medium text-ink-2">מיקום</span>
          <Segmented<Where>
            value={where}
            onChange={chooseWhere}
            options={[
              { value: 'here', label: 'המיקום הנוכחי' },
              { value: 'none', label: 'בלי מיקום' },
            ]}
          />
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
          {(id) => <Input id={id} value={address} maxLength={120} onChange={(e) => setAddress(e.target.value)} />}
        </Field>
        <Field label="Instagram (לא חובה)">
          {(id) => (
            <Input
              id={id}
              dir="ltr"
              className="text-start"
              value={instagram}
              maxLength={120}
              placeholder="@"
              onChange={(e) => setInstagram(e.target.value)}
            />
          )}
        </Field>

        {error && <ErrorBox error={error} />}
      </div>
    </Sheet>
  )
}
