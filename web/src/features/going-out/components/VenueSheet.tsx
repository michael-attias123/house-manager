import { useState } from 'react'
import { Check, EyeOff, Pencil, Plus, Trash2 } from 'lucide-react'
import type { VenueDeal } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { ConfirmButton } from '@/components/ui/ConfirmButton'
import { Sheet } from '@/components/ui/Sheet'
import { formatDay } from '@/lib/dates'
import { useAdminDeleteDeal, useAdminHideVenue, useConfirmDeal } from '../hooks'
import { todayHours, weekLines, type DayLine } from '../lib/hours'
import { dealKind, venueKind } from '../lib/kinds'
import { sheetDeals, type DealView, type VenueItem } from '../lib/rank'
import { canConfirm, confirmedLabel, crossesMidnight, isStale, shortTime } from '../lib/schedule'
import { instagramUrl, mapsUrl, wazeUrl, websiteUrl } from '../lib/search'
import { venuePoint } from '../lib/geo'
import { DealDays, Distance, OpenLabel, openTone } from './Labels'

interface VenueSheetProps {
  item: VenueItem
  /** Every deal of this place that RLS lets the household see. */
  deals: VenueDeal[]
  now: Date
  /** Shows the admin's edit, delete and hide (useIsAdmin; the server checks again). */
  admin: boolean
  onClose: () => void
  onAddDeal: () => void
  /** Admin only. */
  onEditDeal: (deal: VenueDeal) => void
  onEditVenue: () => void
  /** The place was hidden: it's gone from the lists. */
  onHidden: () => void
}

/**
 * A place's page: details, navigation and its deals. The household's own
 * suggestions show like the rest; their status and editing are in "ההצעות שלי".
 */
export function VenueSheet({ item, deals, now, admin, onClose, onAddDeal, onEditDeal, onEditVenue, onHidden }: VenueSheetProps) {
  const { venue } = item
  const kind = venueKind(venue.kind)
  const point = venuePoint(venue)
  const list = sheetDeals(deals, now)
  const hide = useAdminHideVenue()

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
        </div>

        {admin && (
          <div className="space-y-1">
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={onEditVenue}>
                <Pencil size={14} />
                עריכת המקום
              </Button>
              <ConfirmButton
                variant="ghost"
                size="sm"
                confirmLabel="להסתיר מכולם?"
                disabled={hide.isPending}
                onConfirm={() => hide.mutate({ id: venue.id, hidden: true }, { onSuccess: onHidden })}
              >
                <EyeOff size={14} />
                הסתרת המקום
              </ConfirmButton>
            </div>
            {hide.error && <p className="text-xs text-rose-700 dark:text-rose-300">{hide.error.message}</p>}
          </div>
        )}

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
                <DealRow key={view.deal.id} view={view} now={now} admin={admin} onEdit={() => onEditDeal(view.deal)} />
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

function DealRow({ view, now, admin, onEdit }: { view: DealView; now: Date; admin: boolean; onEdit: () => void }) {
  const { deal, window } = view
  const confirm = useConfirmDeal()
  const remove = useAdminDeleteDeal()
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
          </p>
          {deal.note && <p className="text-ink-2">{deal.note}</p>}
        </div>
      </div>

      {/* "עדיין בתוקף?" is for deals everyone sees. */}
      {approved && (
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
      )}
      {admin && (
        <div className="flex gap-2 ps-6">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil size={14} />
            עריכה
          </Button>
          <ConfirmButton
            variant="ghost"
            size="sm"
            confirmLabel="למחוק לכולם?"
            disabled={remove.isPending}
            onConfirm={() => remove.mutate(deal.id)}
          >
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
