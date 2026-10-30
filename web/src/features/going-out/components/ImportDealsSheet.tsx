import { useMemo, useState } from 'react'
import { Check, ClipboardCopy, ExternalLink, Pencil } from 'lucide-react'
import type { Venue } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { ErrorBox } from '@/components/ui/Feedback'
import { Textarea } from '@/components/ui/Field'
import { Nums } from '@/components/ui/Nums'
import { Sheet } from '@/components/ui/Sheet'
import { DealForm, DRAFT_ERRORS } from '@/components/going-out/DealForm'
import { VenuePicker } from '@/components/going-out/VenuePicker'
import { useImportDeals } from '../hooks'
import { aiDealToDraft, aiInstructions, matchVenue, parseAiDeals, type AiDeal } from '../lib/aiImport'
import { draftFromDeal, draftToFields, validateDraft, type DealDraft } from '../lib/draft'
import { dealSchedule } from '../lib/format'
import { dealKind } from '../lib/kinds'
import { jerusalemClock } from '../lib/schedule'

interface Row {
  key: number
  ai: AiDeal
  draft: DealDraft
  include: boolean
}

const PARSE_ERRORS = {
  no_json: 'לא נמצא בתשובה בלוק JSON. כדאי לבקש מהצ׳אט: "החזר רק את בלוק ה-JSON".',
  no_deals: 'בתשובה אין דילים. אולי בצילומים לא היה דיל, או שצריך לצלם קרוב יותר.',
}

/**
 * Deals from screenshots, read by an AI chat: the instructions to copy there,
 * the answer pasted back, a check of each deal, and one save. An admin's
 * deals can go in approved for everyone; anyone else's are suggestions.
 */
export function ImportDealsSheet({
  venues,
  admin,
  onClose,
  onDone,
}: {
  venues: Venue[]
  admin: boolean
  onClose: () => void
  onDone: (count: number, approved: boolean) => void
}) {
  const today = jerusalemClock(new Date()).day
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)
  const [answer, setAnswer] = useState('')
  const [parseError, setParseError] = useState<keyof typeof PARSE_ERRORS | null>(null)
  const [rows, setRows] = useState<Row[] | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [approve, setApprove] = useState(admin)
  const save = useImportDeals()

  const shown = useMemo(() => venues.filter((v) => !v.hidden && v.status !== 'rejected'), [venues])
  const instructions = useMemo(
    () => aiInstructions(today, shown.filter((v) => v.status === 'approved').map((v) => v.name)),
    [today, shown],
  )
  const byId = useMemo(() => new Map(shown.map((v) => [v.id, v])), [shown])

  /** Why a row can't be saved: the form's checks, and a place not approved yet for an admin's direct import. */
  const problems = (row: Row) => {
    const errors = Object.values(validateDraft(row.draft, today))
    const venue = row.draft.venueId != null ? byId.get(row.draft.venueId) : undefined
    return { errors, unapprovedPlace: approve && venue != null && venue.status !== 'approved' }
  }
  const ready = (rows ?? []).filter((r) => {
    const p = problems(r)
    return r.include && p.errors.length === 0 && !p.unapprovedPlace
  })
  const update = (key: number, patch: Partial<Row>) =>
    setRows((rs) => rs!.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  async function copy() {
    try {
      await navigator.clipboard.writeText(instructions)
      setCopied('yes')
    } catch {
      // Blocked in some embeds: show the text to copy by hand.
      setCopied('failed')
    }
  }

  function read() {
    const result = parseAiDeals(answer)
    setParseError(result.error)
    if (result.error) return
    setRows(
      result.deals.map((ai, key) => {
        const venueId = matchVenue(shown, ai.place)?.id ?? null
        return { key, ai, draft: aiDealToDraft(ai, venueId), include: true }
      }),
    )
  }

  const editRow = rows?.find((r) => r.key === editing)
  if (editRow) {
    return (
      <DealForm
        key={editRow.key}
        mode="create"
        venues={shown}
        initial={editRow.draft}
        onClose={() => setEditing(null)}
        onSubmit={(fields) => {
          update(editRow.key, { draft: draftFromDeal(fields), include: true })
          setEditing(null)
        }}
      />
    )
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="ייבוא דילים עם AI"
      footer={
        rows && (
          <div className="space-y-2">
            {admin && (
              <Chip selected={approve} onClick={() => setApprove(!approve)}>
                לאשר מיד לכולם
              </Chip>
            )}
            <Button
              className="w-full"
              disabled={ready.length === 0 || save.isPending}
              onClick={() =>
                save.mutate(
                  { deals: ready.map((r) => draftToFields(r.draft)), approve },
                  { onSuccess: () => onDone(ready.length, approve) },
                )
              }
            >
              {ready.length === 0 ? (
                'אין דילים מוכנים לשמירה'
              ) : (
                <>
                  שמירת <span className="num">{ready.length}</span> {ready.length === 1 ? 'דיל' : 'דילים'}
                </>
              )}
            </Button>
          </div>
        )
      }
    >
      {rows == null ? (
        <ol className="space-y-4 text-sm">
          <li className="space-y-2">
            <p className="font-medium">1. מעתיקים את ההוראות ל־AI</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={copy}>
                {copied === 'yes' ? <Check size={16} /> : <ClipboardCopy size={16} />}
                {copied === 'yes' ? 'הועתק' : 'העתקת ההוראות'}
              </Button>
              <a
                href="https://claude.ai/new"
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm text-brand-700 dark:text-brand-200"
              >
                <ExternalLink size={16} />
                פתיחת Claude
              </a>
            </div>
            {copied === 'failed' && (
              <Textarea
                readOnly
                rows={6}
                value={instructions}
                onFocus={(e) => e.currentTarget.select()}
                aria-label="ההוראות להעתקה"
                className="text-xs"
              />
            )}
          </li>
          <li className="space-y-1">
            <p className="font-medium">2. בצ׳אט: מדביקים, מצרפים צילומי מסך ושולחים</p>
            <p className="text-ink-2">
              סטורי, פוסט, תפריט או שלט. אפשר כמה תמונות בבת אחת. אפשר גם Claude באפליקציה בטלפון, או כל צ׳אט אחר שקורא תמונות.
            </p>
          </li>
          <li className="space-y-2">
            <p className="font-medium">3. מעתיקים את התשובה ומדביקים כאן</p>
            <Textarea
              rows={6}
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder='{"deals": [...]}'
              aria-label="התשובה של ה־AI"
              dir="ltr"
              className="font-mono text-xs"
            />
            {parseError && <p className="text-rose-700 dark:text-rose-300">{PARSE_ERRORS[parseError]}</p>}
            <Button className="w-full" disabled={!answer.trim()} onClick={read}>
              קריאת הדילים
            </Button>
          </li>
        </ol>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-ink-2">
            נמצאו <span className="num">{rows.length}</span> דילים. כדאי לעבור עליהם: ה־AI יכול לטעות.
            {!approve && ' הם יישמרו כהצעות של הבית, ואחרי אישור יופיעו לכולם.'}
          </p>
          {save.error && <ErrorBox error={save.error} />}
          <ul className="space-y-3">
            {rows.map((row) => {
              const p = problems(row)
              const venue = row.draft.venueId != null ? byId.get(row.draft.venueId) : undefined
              const blocked = p.errors.length > 0 || p.unapprovedPlace
              return (
                <li key={row.key} className="space-y-2 rounded-2xl border border-line p-3">
                  <div className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-1 h-4 w-4 shrink-0"
                      checked={row.include && !blocked}
                      disabled={blocked}
                      onChange={(e) => update(row.key, { include: e.target.checked })}
                      aria-label={`לשמור את "${row.draft.title}"`}
                    />
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="font-medium">
                        <span aria-hidden>{dealKind(row.draft.kind).emoji}</span> {row.draft.title || 'בלי כותרת'}
                      </p>
                      <p className="text-sm text-ink-2">
                        <Nums text={dealSchedule(scheduleOf(row.draft))} />
                      </p>
                      {row.draft.note && <p className="text-sm text-ink-3">{row.draft.note}</p>}
                    </div>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(row.key)}>
                      <Pencil size={14} />
                      עריכה
                    </Button>
                  </div>
                  <VenuePicker
                    venues={approve ? shown.filter((v) => v.status === 'approved') : shown}
                    venue={venue}
                    initialQuery={row.ai.place}
                    onPick={(venueId) => update(row.key, { draft: { ...row.draft, venueId } })}
                  />
                  {!venue && row.ai.place && (
                    <p className="text-xs text-ink-3">
                      ה־AI כתב: {row.ai.place}
                      {row.ai.address && ` (${row.ai.address})`}. אם המקום חסר, אפשר להוסיף אותו במסך יוצאים.
                    </p>
                  )}
                  {p.unapprovedPlace && (
                    <p className="text-sm text-rose-700 dark:text-rose-300">המקום עוד לא אושר: מאשרים אותו קודם, או שומרים כהצעה</p>
                  )}
                  {p.errors.filter((e) => e !== 'venue_missing' || !row.ai.place).map((e) => (
                    <p key={e} className="text-sm text-rose-700 dark:text-rose-300">
                      {DRAFT_ERRORS[e]}
                    </p>
                  ))}
                </li>
              )
            })}
          </ul>
          <Button variant="ghost" size="sm" onClick={() => setRows(null)}>
            הדבקת תשובה אחרת
          </Button>
        </div>
      )}
    </Sheet>
  )
}

/** A draft's days, hours and dates, for dealSchedule(), even before it is valid. */
function scheduleOf(d: DealDraft) {
  const event = d.kind === 'event'
  return {
    kind: d.kind,
    weekdays: event ? [] : d.weekdays,
    starts_at: d.allHours ? null : d.startsAt || null,
    ends_at: d.allHours ? null : d.endsAt || null,
    valid_from: event ? d.date || null : null,
    valid_until: d.date || null,
  }
}
