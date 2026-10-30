import { useState, type ReactNode } from 'react'
import { AlertTriangle, Navigation } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { useAdminSuggestions, useApproveVenueAndDeal, useMergeVenue, useReviewDeal, useReviewVenue } from '../hooks'
import {
  DEAL_KIND_EMOJI,
  DEAL_KIND_LABELS,
  dealSchedule,
  formatAgo,
  VENUE_KIND_EMOJI,
  VENUE_KIND_LABELS,
  wazeUrl,
  type AdminSuggestion,
} from '../lib/suggestions'
import { Hint, Tag } from './Tag'

export function Suggestions() {
  const suggestions = useAdminSuggestions()
  if (suggestions.isPending) return <Loading />
  if (suggestions.error) return <ErrorBox error={suggestions.error} />
  return (
    <div className="space-y-3">
      {suggestions.data.length === 0 ? (
        <EmptyState icon="🍸" title="אין הצעות שממתינות לאישור" />
      ) : (
        suggestions.data.map((s) =>
          s.item_type === 'deal' ? (
            <DealSuggestion key={`deal:${s.deal_id}`} suggestion={s} />
          ) : (
            <VenueSuggestion key={`venue:${s.venue_id}`} suggestion={s} />
          ),
        )
      )}
      <Hint>
        אישור מציג את ההצעה בלאן יוצאים לכל הבתים. הצעה שנדחתה נשארת רק אצל הבית שהציע, עם ההערה. מיזוג מעביר את
        הדילים של מקום כפול אל המקום הקיים ומוחק את ההצעה.
      </Hint>
    </div>
  )
}

/** Plain text with its numbers, times and dates isolated for RTL. */
function Nums({ text }: { text: string }) {
  return text.split(/(\d[\d:.–]*\d|\d)/).map((part, i) =>
    i % 2 ? (
      <span key={i} className="num">
        {part}
      </span>
    ) : (
      part
    ),
  )
}

/** "מבית {household} · לפני 2 שעות". */
function Origin({ suggestion: s }: { suggestion: AdminSuggestion }) {
  return (
    <p className="text-xs text-ink-3">
      מבית {s.household_name ?? '—'} · <Nums text={formatAgo(s.created_at)} />
    </p>
  )
}

function Duplicate({ name }: { name: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl bg-amber-100 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <p>
        <span className="font-medium">כפילות?</span> נראה כמו „{name}”, שכבר מופיע לכולם.
      </p>
    </div>
  )
}

function DealSuggestion({ suggestion: s }: { suggestion: AdminSuggestion }) {
  const review = useReviewDeal()
  const approveBoth = useApproveVenueAndDeal()
  const dealId = s.deal_id!
  const venuePending = s.venue_status !== 'approved'
  const error = review.error ?? approveBoth.error

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <span aria-hidden>{VENUE_KIND_EMOJI[s.venue_kind]}</span>
          <span className="font-medium text-ink">{s.venue_name}</span>
          {venuePending && <Tag tone="warn">מקום חדש</Tag>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">
            {s.deal_kind && <span aria-hidden>{DEAL_KIND_EMOJI[s.deal_kind]} </span>}
            {s.title}
          </h3>
          {s.deal_kind && <Tag>{DEAL_KIND_LABELS[s.deal_kind]}</Tag>}
        </div>
        <p className="text-sm text-ink-2">
          <Nums text={dealSchedule(s)} />
        </p>
        {s.note && <p className="text-sm text-ink-2">{s.note}</p>}
        <Origin suggestion={s} />
      </div>

      {venuePending && s.similar_venue_name && <Duplicate name={s.similar_venue_name} />}

      <ReviewActions
        approveLabel={venuePending ? 'אישור המקום והדיל' : 'אישור'}
        notePlaceholder="למשל: הדיל כבר לא בתוקף"
        busy={review.isPending || approveBoth.isPending}
        onApprove={() =>
          venuePending
            ? approveBoth.mutate({ venueId: s.venue_id, dealId })
            : review.mutate({ id: dealId, approve: true })
        }
        onReject={(note) => review.mutate({ id: dealId, approve: false, note })}
      />
      {error && <ErrorBox error={error} />}
    </Card>
  )
}

function VenueSuggestion({ suggestion: s }: { suggestion: AdminSuggestion }) {
  const review = useReviewVenue()
  const merge = useMergeVenue()
  const located = s.venue_lat != null && s.venue_lng != null
  const error = review.error ?? merge.error

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">
            <span aria-hidden>{VENUE_KIND_EMOJI[s.venue_kind]} </span>
            {s.venue_name}
          </h3>
          <Tag>{VENUE_KIND_LABELS[s.venue_kind]}</Tag>
          <Tag tone="warn">מקום חדש</Tag>
        </div>
        {s.venue_address && (
          <p className="text-sm text-ink-2">
            <Nums text={s.venue_address} />
          </p>
        )}
        {!located && <p className="text-sm text-ink-3">נוסף בלי מיקום</p>}
        <Origin suggestion={s} />
      </div>

      {located && (
        <a
          href={wazeUrl(s.venue_lat!, s.venue_lng!)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700 hover:underline"
        >
          <Navigation size={16} />
          בדיקת המיקום ב-Waze
        </a>
      )}

      {s.similar_venue_name && <Duplicate name={s.similar_venue_name} />}

      <ReviewActions
        approveLabel="אישור"
        notePlaceholder="למשל: המקום נסגר"
        busy={review.isPending || merge.isPending}
        onApprove={() => review.mutate({ id: s.venue_id, approve: true })}
        onReject={(note) => review.mutate({ id: s.venue_id, approve: false, note })}
      >
        {s.similar_venue_id != null && (
          <ConfirmButton
            size="sm"
            variant="secondary"
            confirmLabel="למזג?"
            disabled={review.isPending || merge.isPending}
            onConfirm={() => merge.mutate({ from: s.venue_id, into: s.similar_venue_id! })}
          >
            מיזוג אל {s.similar_venue_name}
          </ConfirmButton>
        )}
      </ReviewActions>
      {error && <ErrorBox error={error} />}
    </Card>
  )
}

interface ReviewActionsProps {
  approveLabel: string
  notePlaceholder: string
  busy: boolean
  onApprove: () => void
  onReject: (note: string) => void
  /** More buttons after "דחייה" (the venue's merge). */
  children?: ReactNode
}

/** "אישור" | "דחייה"; rejecting first asks for an optional note to the household. */
function ReviewActions({ approveLabel, notePlaceholder, busy, onApprove, onReject, children }: ReviewActionsProps) {
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')

  if (rejecting) {
    return (
      <div className="space-y-2">
        <Field label="הערה לבית שהציע (לא חובה)">
          {(id) => (
            <Input
              id={id}
              value={note}
              maxLength={200}
              placeholder={notePlaceholder}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
        </Field>
        <div className="flex flex-wrap gap-2">
          <ConfirmButton size="sm" variant="secondary" confirmLabel="לדחות?" disabled={busy} onConfirm={() => onReject(note)}>
            דחייה
          </ConfirmButton>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setRejecting(false)
              setNote('')
            }}
          >
            ביטול
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={busy} onClick={onApprove}>
        {approveLabel}
      </Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setRejecting(true)}>
        דחייה
      </Button>
      {children}
    </div>
  )
}
