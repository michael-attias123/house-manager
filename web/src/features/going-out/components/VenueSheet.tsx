import { useState } from 'react'
import { Check, Pencil, Plus, Trash2 } from 'lucide-react'
import type { VenueDeal } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { Sheet } from '@/components/ui/Sheet'
import { formatDay } from '@/lib/dates'
import { useConfirmDeal, useDeleteDeal } from '../hooks'
import { todayHours, weekLines, type DayLine } from '../lib/hours'
import { dealKind, venueKind } from '../lib/kinds'
import { sheetDeals, type DealView, type VenueItem } from '../lib/rank'
import { canConfirm, confirmedLabel, crossesMidnight, isStale, shortTime } from '../lib/schedule'
import { instagramUrl, mapsUrl, wazeUrl, websiteUrl } from '../lib/search'
import { venuePoint } from '../lib/geo'
import { DealDays, Distance, OpenLabel, openTone, StatusTag } from './Labels'

interface VenueSheetProps {
  item: VenueItem
  /** Every deal of this place that RLS lets the household see. */
  deals: VenueDeal[]
  now: Date
  onClose: () => void
  onAddDeal: () => void
  onEditDeal: (deal: VenueDeal) => void
}

/** A place's page: details, navigation and its deals. */
export function VenueSheet({ item, deals, now, onClose, onAddDeal, onEditDeal }: VenueSheetProps) {
  const { venue } = item
  const kind = venueKind(venue.kind)
  const point = venuePoint(venue)
  const list = sheetDeals(deals, now)

  return (
    <Sheet
      open
      onClose={onClose}
      title={venue.name}
      footer={
        <Button className="w-full" onClick={onAddDeal}>
          <Plus size={18} />
          הוספת דיל למקום הזה
        </Button>
      }
    >
      <div className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-ink-2">
            <span aria-hidden>{kind.emoji}</span> {kind.label} · <Distance km={item.distanceKm} />
          </p>
          {venue.status !== 'approved' && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-ink-2">
              <StatusTag status={venue.status} />
              <span>
                {venue.status === 'pending'
                  ? 'המקום נוסף על ידי הבית שלכם ומחכה לאישור'
                  : (venue.review_note ?? 'המקום לא נוסף לרשימה של כולם')}
              </span>
            </div>
          )}
        </div>

        <ul className="space-y-2 text-sm">
          <HoursRow hours={venue.opening_hours} item={item} now={now} />
          {venue.address && (
            <li className="flex gap-2">
              <span aria-hidden>📍</span>
              <span>{venue.address}</span>
            </li>
          )}
          {(venue.website || venue.phone || venue.instagram) && (
            <li className="flex flex-wrap gap-x-4 gap-y-1">
              {venue.website && (
                <a href={websiteUrl(venue.website)} target="_blank" rel="noreferrer" className="text-brand-700 dark:text-brand-200">
                  🌐 אתר
                </a>
              )}
              {venue.phone && (
                <a href={`tel:${venue.phone.replace(/[^\d+]/g, '')}`} className="text-brand-700 dark:text-brand-200">
                  ☎️ <span className="num">{venue.phone}</span>
                </a>
              )}
              {venue.instagram && (
                <a href={instagramUrl(venue.instagram)} target="_blank" rel="noreferrer" className="text-brand-700 dark:text-brand-200">
                  Instagram
                </a>
              )}
            </li>
          )}
        </ul>

        {point && (
          <div className="flex gap-2">
            <a
              href={wazeUrl(point)}
              target="_blank"
              rel="noreferrer"
              className="flex h-10 flex-1 items-center justify-center rounded-xl bg-surface-2 text-sm font-medium"
            >
              Waze
            </a>
            <a
              href={mapsUrl(point)}
              target="_blank"
              rel="noreferrer"
              className="flex h-10 flex-1 items-center justify-center rounded-xl bg-surface-2 text-sm font-medium"
            >
              מפות
            </a>
          </div>
        )}

        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-ink-2">דילים</h3>
          {list.length === 0 ? (
            <p className="text-sm text-ink-3">עוד אין כאן דילים. אפשר להוסיף דיל שמכירים.</p>
          ) : (
            <ul className="divide-y divide-line rounded-2xl border border-line">
              {list.map((view) => (
                <DealRow key={view.deal.id} view={view} now={now} onEdit={() => onEditDeal(view.deal)} />
              ))}
            </ul>
          )}
        </section>

        <p className="text-xs text-ink-3">
          {venue.source === 'osm' ? (
            <>
              פרטי המקום מ־
              <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
                OpenStreetMap
              </a>
              . הדילים נכתבים על ידי משתמשי האפליקציה.
            </>
          ) : (
            'המקום והדילים נכתבים על ידי משתמשי האפליקציה.'
          )}
        </p>
      </div>
    </Sheet>
  )
}

function DayHours({ line }: { line: DayLine }) {
  return (
    <>
      {line.times && <span className="num">{line.times}</span>}
      {line.times && line.note && ' · '}
      {line.note}
    </>
  )
}

function HoursRow({ hours, item, now }: { hours: string | null; item: VenueItem; now: Date }) {
  const [expanded, setExpanded] = useState(false)
  const today = todayHours(hours, now)
  const week = weekLines(hours)
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-2">
        <span aria-hidden>🕒</span>
        <span className={openTone(item.open)}>
          <OpenLabel open={item.open} now={now} />
        </span>
        {today && (
          <span className="text-ink-2">
            · היום <DayHours line={today} />
          </span>
        )}
        {hours && (
          <button
            type="button"
            className="text-brand-700 dark:text-brand-200"
            aria-expanded={expanded}
            onClick={() => setExpanded((e) => !e)}
          >
            {expanded ? 'הסתרה' : 'כל השעות'}
          </button>
        )}
      </div>
      {expanded && hours && (
        <div className="space-y-1 rounded-xl bg-surface-2 p-3 text-xs text-ink-2">
          {week && (
            <ul className="space-y-0.5">
              {week.map((line) => (
                <li key={line.day} className="flex gap-3">
                  <span className="w-5 font-medium">{line.day}</span>
                  <span>
                    <DayHours line={line} />
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p dir="ltr" className="text-start font-mono break-all text-ink-3">
            {hours}
          </p>
        </div>
      )}
    </li>
  )
}

function DealRow({ view, now, onEdit }: { view: DealView; now: Date; onEdit: () => void }) {
  const { deal, window } = view
  const confirm = useConfirmDeal()
  const remove = useDeleteDeal()
  const start = shortTime(deal.starts_at)
  const end = shortTime(deal.ends_at)
  const approved = deal.status === 'approved'
  const on = window.state === 'active'

  return (
    <li className="space-y-1.5 p-3 text-sm">
      <div className="flex items-start gap-2">
        <span aria-hidden>{dealKind(deal.kind).emoji}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{deal.title}</span>
            <StatusTag status={deal.status} />
            {on && <span className="text-xs text-brand-700 dark:text-brand-200">עכשיו</span>}
          </div>
          <p className="text-ink-2">
            <DealDays deal={deal} />
            {' · '}
            {start && end ? (
              <>
                <span className="num">
                  {start}–{end}
                </span>
                {crossesMidnight(deal.starts_at, deal.ends_at) && ' (עד למחרת)'}
              </>
            ) : (
              'כל שעות הפתיחה'
            )}
            {deal.kind !== 'event' && deal.valid_until && (
              <>
                {' · '}בתוקף עד {formatDay(deal.valid_until)}
              </>
            )}
            {window.expired && ' · פג תוקף'}
          </p>
          {deal.note && <p className="text-ink-2">{deal.note}</p>}
          {deal.status === 'rejected' && deal.review_note && (
            <p className="text-rose-700 dark:text-rose-300">{deal.review_note}</p>
          )}
        </div>
      </div>

      {approved ? (
        <div className="flex flex-wrap items-center gap-2 ps-6 text-xs text-ink-3">
          <span>{confirmedLabel(deal, now)}</span>
          {canConfirm(deal, now) && (
            <Button variant="secondary" size="sm" onClick={() => confirm.mutate(deal.id)}>
              עדיין בתוקף? <Check size={14} />
            </Button>
          )}
          {isStale(deal, now) && (
            <p className="w-full text-amber-800 dark:text-amber-300">לא אומת מזמן, כדאי לבדוק לפני שיוצאים</p>
          )}
        </div>
      ) : (
        <div className="flex gap-2 ps-6">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil size={14} />
            עריכה
          </Button>
          <ConfirmButton variant="ghost" size="sm" confirmLabel="למחוק?" onConfirm={() => remove.mutate(deal.id)}>
            <Trash2 size={14} />
            מחיקה
          </ConfirmButton>
        </div>
      )}
      {(confirm.error || remove.error) && (
        <p className="ps-6 text-xs text-rose-700 dark:text-rose-300">{(confirm.error ?? remove.error)?.message}</p>
      )}
    </li>
  )
}
