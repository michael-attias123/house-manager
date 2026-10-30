import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Plus } from 'lucide-react'
import type { Venue, VenueDeal } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { Fab } from '@/components/ui/Fab'
import { DealForm } from '@/components/going-out/DealForm'
import { VenueForm } from '@/components/going-out/VenueForm'
import { useIsAdmin } from '@/features/admin/hooks'
import { FilterChips } from './components/FilterChips'
import { LocationBar } from './components/LocationBar'
import { VenueCard } from './components/VenueCard'
import { VenueSheet } from './components/VenueSheet'
import {
  useAddDeal,
  useAddVenue,
  useAdminUpdateDeal,
  useAdminUpdateVenue,
  useDeals,
  useLocation,
  useNow,
  useVenues,
} from './hooks'
import { draftFromDeal, emptyDraft, type DealDraft, type DealFields } from './lib/draft'
import { buildSections, NO_FILTERS, type Filters } from './lib/rank'
import { emptyVenueDraft, venueDraftFrom, type VenueFields } from './lib/venueDraft'

const PAGE = 20
const SAVED = 'נשמר לבית שלכם ונשלח לאישור. אחרי אישור יופיע לכולם.'

/** What is open on top of the list; one sheet at a time. */
type Panel =
  | { type: 'venue'; id: number }
  /** `back`: the place page to return to. `deal`: an admin editing it. */
  | { type: 'deal'; draft: DealDraft; deal?: VenueDeal; back?: number }
  /** `draft`: the deal form it was opened from, to continue with. */
  | { type: 'new-venue'; name: string; draft: DealDraft | null }
  /** An admin editing the place; back to its page afterwards. */
  | { type: 'edit-venue'; venue: Venue }

export function GoingOutPage() {
  const venues = useVenues()
  const deals = useDeals()
  const location = useLocation()
  const now = useNow()
  const isAdmin = useIsAdmin().data === true
  const addDeal = useAddDeal()
  const addVenue = useAddVenue()
  const adminUpdateDeal = useAdminUpdateDeal()
  const adminUpdateVenue = useAdminUpdateVenue()
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [shown, setShown] = useState(PAGE)
  const [panel, setPanel] = useState<Panel | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const venueList = useMemo(() => venues.data ?? [], [venues.data])
  const dealList = useMemo(() => deals.data ?? [], [deals.data])
  const sections = useMemo(
    () => buildSections(venueList, dealList, location.origin, now, filters),
    [venueList, dealList, location.origin, now, filters],
  )
  // Every place, whatever the filters: a sheet may open for one they hide.
  const items = useMemo(
    () => new Map(buildSections(venueList, dealList, location.origin, now).all.map((i) => [i.venue.id, i])),
    [venueList, dealList, location.origin, now],
  )

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  // Stable callbacks: a Sheet re-focuses its first field when onClose changes.
  const close = useCallback(() => setPanel(null), [])
  const closeDeal = useCallback(
    () => setPanel((p) => (p?.type === 'deal' && p.back != null ? { type: 'venue', id: p.back } : null)),
    [],
  )
  const closeNewVenue = useCallback(
    () => setPanel((p) => (p?.type === 'new-venue' && p.draft ? { type: 'deal', draft: p.draft } : null)),
    [],
  )
  const closeEditVenue = useCallback(
    () => setPanel((p) => (p?.type === 'edit-venue' ? { type: 'venue', id: p.venue.id } : null)),
    [],
  )
  const newDeal = (venueId: number | null = null) =>
    setPanel({ type: 'deal', draft: emptyDraft(venueId), back: venueId ?? undefined })
  const newVenue = () => setPanel({ type: 'new-venue', name: '', draft: null })

  const submitDeal = (fields: DealFields) => {
    if (panel?.type !== 'deal') return
    const back = () => setPanel(panel.back != null ? { type: 'venue', id: panel.back } : null)
    // An admin's edit: the form waits, and shows a failure itself.
    if (panel.deal) {
      return adminUpdateDeal.mutateAsync({ id: panel.deal.id, fields }).then(() => {
        setNotice('השינויים נשמרו')
        back()
      })
    }
    addDeal.mutate({ ...fields, id: crypto.randomUUID() }, { onError: (err) => setNotice(`השמירה נכשלה: ${err.message}`) })
    setNotice(SAVED)
    back()
  }
  /** On to a deal at this place; back to its page afterwards. */
  const continueWith = (venue: Venue, draft: DealDraft | null) =>
    setPanel({ type: 'deal', draft: { ...(draft ?? emptyDraft()), venueId: venue.id }, back: venue.id })

  if (venues.isPending || deals.isPending) return <Loading />

  const open = panel?.type === 'venue' ? items.get(panel.id) : undefined

  return (
    <div className="space-y-4 pb-24">
      <LocationBar location={location} />
      {venues.error && <ErrorBox error={venues.error} />}
      {deals.error && <ErrorBox error={deals.error} />}

      {venueList.length === 0 ? (
        <EmptyState icon="🗺️" title="עוד לא נטענו מקומות">
          <p>הם נטענים פעם בשבוע מ־OpenStreetMap.</p>
          <Button variant="secondary" size="sm" className="mt-3" onClick={newVenue}>
            <Plus size={16} />
            הוספת מקום
          </Button>
        </EmptyState>
      ) : (
        <>
          <FilterChips
            value={filters}
            onChange={(f) => {
              setFilters(f)
              setShown(PAGE)
            }}
          />

          <Section title="עכשיו">
            {sections.now.length === 0 ? (
              <div className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
                <p>אין כרגע דילים פעילים בקרבת מקום. אפשר להוסיף דיל שמכירים, והוא יופיע מיד אצלכם.</p>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" size="sm" onClick={() => newDeal()}>
                    <Plus size={16} />
                    הוספת דיל
                  </Button>
                  <Button variant="secondary" size="sm" onClick={newVenue}>
                    <Plus size={16} />
                    הוספת מקום
                  </Button>
                </div>
              </div>
            ) : (
              sections.now.map((item) => (
                <VenueCard key={item.venue.id} item={item} now={now} onOpen={() => setPanel({ type: 'venue', id: item.venue.id })} />
              ))
            )}
          </Section>

          <Section title="בהמשך הערב">
            {sections.later.length === 0 ? (
              <p className="px-1 text-sm text-ink-3">אין דילים שמתחילים בשעות הקרובות.</p>
            ) : (
              sections.later.map((item) => (
                <VenueCard key={item.venue.id} item={item} now={now} onOpen={() => setPanel({ type: 'venue', id: item.venue.id })} />
              ))
            )}
          </Section>

          <Section
            title={
              <>
                כל המקומות (<span className="num">{sections.all.length}</span>)
              </>
            }
            action={
              <Button variant="ghost" size="sm" onClick={newVenue}>
                <Plus size={16} />
                הוספת מקום
              </Button>
            }
          >
            {sections.all.length === 0 ? (
              <div className="space-y-2 rounded-2xl bg-surface-2 p-4 text-sm text-ink-2">
                <p>אין מקומות שמתאימים לסינון. מכירים מקום שחסר כאן? אפשר להוסיף אותו.</p>
                <Button variant="secondary" size="sm" onClick={newVenue}>
                  <Plus size={16} />
                  הוספת מקום
                </Button>
              </div>
            ) : (
              <>
                {sections.all.slice(0, shown).map((item) => (
                  <VenueCard key={item.venue.id} item={item} now={now} onOpen={() => setPanel({ type: 'venue', id: item.venue.id })} />
                ))}
                {sections.all.length > shown && (
                  <Button variant="secondary" className="w-full" onClick={() => setShown((n) => n + PAGE)}>
                    הצגת עוד
                  </Button>
                )}
              </>
            )}
          </Section>

          <p className="text-center text-xs text-ink-3">
            נתוני המקומות: ©{' '}
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className="underline">
              תורמי OpenStreetMap
            </a>
            . חסר מקום או שהפרטים לא נכונים? אפשר להוסיף מקום, והוא יעבור לאישור.
          </p>
        </>
      )}

      <Fab onClick={() => newDeal()}>
        <Plus size={20} />
        הוספת דיל
      </Fab>

      {notice && (
        // A tap dismisses it, in case it covers a field.
        <p
          role="status"
          onClick={() => setNotice(null)}
          className="fixed inset-x-4 bottom-[calc(10rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-xl bg-ink px-4 py-3 text-sm text-page shadow-lg"
        >
          {notice}
        </p>
      )}

      {open && (
        <VenueSheet
          item={open}
          deals={dealList.filter((d) => d.venue_id === open.venue.id)}
          now={now}
          admin={isAdmin}
          onClose={close}
          onAddDeal={() => newDeal(open.venue.id)}
          onEditDeal={(deal) => setPanel({ type: 'deal', draft: draftFromDeal(deal), deal, back: deal.venue_id })}
          onEditVenue={() => setPanel({ type: 'edit-venue', venue: open.venue })}
          onHidden={() => {
            setPanel(null)
            setNotice('המקום הוסתר מהרשימה של כולם')
          }}
        />
      )}
      {panel?.type === 'deal' && (
        <DealForm
          // A new form for each deal, so its fields start from the draft.
          key={panel.deal?.id ?? `new-${panel.draft.venueId}`}
          mode={panel.deal ? 'admin' : 'create'}
          venues={venueList}
          initial={panel.draft}
          onClose={closeDeal}
          onSubmit={submitDeal}
          onAddVenue={panel.deal ? undefined : (draft, name) => setPanel({ type: 'new-venue', name, draft })}
        />
      )}
      {panel?.type === 'new-venue' && (
        <VenueForm
          mode="create"
          venues={venueList}
          location={location}
          initial={emptyVenueDraft(panel.name)}
          onClose={closeNewVenue}
          onSubmit={async (fields: VenueFields) => {
            const venue = await addVenue.mutateAsync(fields)
            setNotice('המקום נשמר לבית שלכם ונשלח לאישור. אחרי אישור יופיע לכולם.')
            continueWith(venue, panel.draft)
          }}
          onPick={(venue) => continueWith(venue, panel.draft)}
        />
      )}
      {panel?.type === 'edit-venue' && (
        <VenueForm
          key={panel.venue.id}
          mode="admin"
          venues={venueList}
          location={location}
          initial={venueDraftFrom(panel.venue)}
          onClose={closeEditVenue}
          onSubmit={async (fields: VenueFields) => {
            await adminUpdateVenue.mutateAsync({ id: panel.venue.id, fields })
            setNotice('השינויים נשמרו')
            closeEditVenue()
          }}
        />
      )}
    </div>
  )
}

function Section({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <div className="flex min-h-8 items-center justify-between px-1">
        <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}
