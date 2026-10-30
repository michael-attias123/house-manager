import { useCallback, useState, type ReactNode } from 'react'
import { AlertTriangle, Navigation, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { Field, Input } from '@/components/ui/Field'
import { Nums } from '@/components/ui/Nums'
import { DealForm } from '@/components/going-out/DealForm'
import { VenueForm } from '@/components/going-out/VenueForm'
import { useAdminUpdateDeal, useAdminUpdateVenue, useLocation } from '@/features/going-out/hooks'
import { draftFromDeal } from '@/features/going-out/lib/draft'
import { dealSchedule, formatAgo } from '@/features/going-out/lib/format'
import { dealKind, venueKind } from '@/features/going-out/lib/kinds'
import { wazeUrl } from '@/features/going-out/lib/search'
import { useAdminSuggestions, useApproveVenueAndDeal, useMergeVenue, useReviewDeal, useReviewVenue } from '../hooks'
import { suggestionDealFields, suggestionVenueDraft, type AdminSuggestion } from '../lib/suggestions'
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
        אישור מציג את ההצעה בלאן יוצאים לכל הבתים. הצעה שנדחתה נשארת רק אצל הבית שהציע, ב„ההצעות שלי”, עם ההערה;
        עריכה שלהם שולחת אותה שוב לאישור. עריכה כאן משנה את הפרטים ומשאירה את ההצעה ממתינה. מיזוג מעביר את הדילים
        של מקום כפול אל המקום הקיים ומוחק את ההצעה.
      </Hint>
    </div>
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

/** The admin's edit of a row: the shared going-out forms, in admin mode. The row stays pending. */
function useEditing() {
  const [editing, setEditing] = useState(false)
  // Stable: a Sheet re-focuses its first field when onClose changes.
  const close = useCallback(() => setEditing(false), [])
  return { editing, open: () => setEditing(true), close }
}

function EditDeal({ suggestion: s, onClose }: { suggestion: AdminSuggestion; onClose: () => void }) {
  const update = useAdminUpdateDeal()
  return (
    <DealForm
      mode="admin"
      venues={[]}
      place={{ name: s.venue_name, kind: s.venue_kind }}
      initial={draftFromDeal(suggestionDealFields(s))}
      onClose={onClose}
      onSubmit={(fields) => update.mutateAsync({ id: s.deal_id!, fields }).then(onClose)}
    />
  )
}

function EditVenue({ suggestion: s, onClose }: { suggestion: AdminSuggestion; onClose: () => void }) {
  const update = useAdminUpdateVenue()
  const location = useLocation()
  return (
    <VenueForm
      mode="admin"
      venues={[]}
      location={location}
      initial={suggestionVenueDraft(s)}
      onClose={onClose}
      onSubmit={(fields) => update.mutateAsync({ id: s.venue_id, fields }).then(onClose)}
    />
  )
}

function EditButton({ onClick }: { onClick: () => void }) {
  return (
    <Button size="sm" variant="ghost" onClick={onClick}>
      <Pencil size={14} />
      עריכה
    </Button>
  )
}

function DealSuggestion({ suggestion: s }: { suggestion: AdminSuggestion }) {
  const review = useReviewDeal()
  const approveBoth = useApproveVenueAndDeal()
  const edit = useEditing()
  const dealId = s.deal_id!
  const venuePending = s.venue_status !== 'approved'
  const error = review.error ?? approveBoth.error

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <p className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
          <span aria-hidden>{venueKind(s.venue_kind).emoji}</span>
          <span className="font-medium text-ink">{s.venue_name}</span>
          {venuePending && <Tag tone="warn">מקום חדש</Tag>}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">
            {s.deal_kind && <span aria-hidden>{dealKind(s.deal_kind).emoji} </span>}
            {s.title}
          </h3>
          {s.deal_kind && <Tag>{dealKind(s.deal_kind).label}</Tag>}
        </div>
        <p className="text-sm text-ink-2">
          <Nums text={dealSchedule({ ...s, kind: s.deal_kind ?? 'happy_hour' })} />
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
      >
        <EditButton onClick={edit.open} />
      </ReviewActions>
      {error && <ErrorBox error={error} />}
      {edit.editing && <EditDeal suggestion={s} onClose={edit.close} />}
    </Card>
  )
}

function VenueSuggestion({ suggestion: s }: { suggestion: AdminSuggestion }) {
  const review = useReviewVenue()
  const merge = useMergeVenue()
  const edit = useEditing()
  const located = s.venue_lat != null && s.venue_lng != null
  const error = review.error ?? merge.error

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">
            <span aria-hidden>{venueKind(s.venue_kind).emoji} </span>
            {s.venue_name}
          </h3>
          <Tag>{venueKind(s.venue_kind).label}</Tag>
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
          href={wazeUrl({ lat: s.venue_lat!, lng: s.venue_lng! })}
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
        <EditButton onClick={edit.open} />
      </ReviewActions>
      {error && <ErrorBox error={error} />}
      {edit.editing && <EditVenue suggestion={s} onClose={edit.close} />}
    </Card>
  )
}

interface ReviewActionsProps {
  approveLabel: string
  notePlaceholder: string
  busy: boolean
  onApprove: () => void
  onReject: (note: string) => void
  /** More buttons after "דחייה" (the venue's merge, "עריכה"). */
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
