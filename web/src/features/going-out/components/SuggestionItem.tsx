import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { Nums } from '@/components/ui/Nums'
import { useDeleteDeal, useDeleteVenue } from '../hooks'
import { dealSchedule, formatAgo } from '../lib/format'
import { dealKind, venueKind } from '../lib/kinds'
import { adminReply, canEdit, type MySuggestion } from '../lib/mine'

/** One suggestion in "ההצעות שלי": what was sent, the admin's reply, and (until approved) edit and delete. */
export function SuggestionItem({ item, onEdit }: { item: MySuggestion; onEdit: () => void }) {
  const { deal, venue } = item
  const removeDeal = useDeleteDeal()
  const removeVenue = useDeleteVenue()
  const reply = adminReply(item)
  const error = removeDeal.error ?? removeVenue.error
  const emoji = deal ? dealKind(deal.kind).emoji : venueKind(venue!.kind).emoji

  return (
    <Card className="space-y-2 p-3">
      <div className="flex items-start gap-2">
        <span className="text-xl leading-6" aria-hidden>
          {emoji}
        </span>
        <div className="min-w-0 flex-1 space-y-0.5 text-sm">
          {deal ? (
            <>
              <p className="text-ink-2">
                {venue ? (
                  <>
                    <span aria-hidden>{venueKind(venue.kind).emoji}</span> {venue.name}
                  </>
                ) : (
                  'מקום שכבר לא מופיע ברשימה'
                )}
              </p>
              <p className="font-semibold text-ink">{deal.title}</p>
              <p className="text-ink-2">
                <Nums text={dealSchedule(deal)} />
              </p>
              {deal.note && <p className="text-ink-2">{deal.note}</p>}
            </>
          ) : (
            <>
              <p className="font-semibold text-ink">{venue!.name}</p>
              <p className="text-ink-2">
                מקום חדש · {venueKind(venue!.kind).label}
                {venue!.address && (
                  <>
                    {' · '}
                    <Nums text={venue!.address} />
                  </>
                )}
              </p>
            </>
          )}
          <p className="text-xs text-ink-3">
            נשלח <Nums text={formatAgo(item.createdAt)} />
          </p>
        </div>
      </div>

      {reply && (
        <div
          className={
            item.status === 'rejected'
              ? 'rounded-xl bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100'
              : 'rounded-xl bg-surface-2 p-3 text-sm text-ink-2'
          }
        >
          {reply.label && <span className="font-medium">{reply.label}: </span>}
          {reply.text}
        </div>
      )}

      {canEdit(item) && (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onEdit}>
            <Pencil size={14} />
            עריכה
          </Button>
          <ConfirmButton
            variant="ghost"
            size="sm"
            confirmLabel={deal ? 'למחוק?' : 'למחוק עם הדילים שלו?'}
            disabled={removeDeal.isPending || removeVenue.isPending}
            onConfirm={() => (deal ? removeDeal.mutate(deal.id) : removeVenue.mutate(venue!.id))}
          >
            <Trash2 size={14} />
            מחיקה
          </ConfirmButton>
        </div>
      )}
      {error && <p className="text-xs text-rose-700 dark:text-rose-300">{error.message}</p>}
    </Card>
  )
}
