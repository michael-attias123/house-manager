import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import type { SuggestionStatus } from '@/lib/db-types'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { DealForm } from '@/components/going-out/DealForm'
import { VenueForm } from '@/components/going-out/VenueForm'
import { SuggestionItem } from './components/SuggestionItem'
import { useLocation, useMySuggestions, useUpdateDeal, useUpdateVenue, useVenues } from './hooks'
import { draftFromDeal, type DealFields } from './lib/draft'
import { groupByStatus, mySuggestions, STATUSES, type MySuggestion } from './lib/mine'
import { venueDraftFrom, type VenueFields } from './lib/venueDraft'

const TAB_LABELS: Record<SuggestionStatus, string> = { pending: 'ממתינות', approved: 'אושרו', rejected: 'לא אושרו' }

const EMPTY: Record<SuggestionStatus, { icon: string; title: string; text: string }> = {
  pending: { icon: '⏳', title: 'אין הצעות שממתינות לאישור', text: 'דיל או מקום שמוסיפים בלאן יוצאים מופיעים כאן עד שמנהלי האפליקציה עוברים עליהם.' },
  approved: { icon: '🎉', title: 'עוד אין הצעות שאושרו', text: 'הצעה שאושרה מופיעה בלאן יוצאים לכל מי שמשתמש באפליקציה.' },
  rejected: { icon: '👍', title: 'אין הצעות שלא אושרו', text: 'אם הצעה לא תאושר, היא תופיע כאן עם תגובת המנהל, ואפשר יהיה לתקן ולשלוח שוב.' },
}

/** "ההצעות שלי" (from Settings): the household's deals and places by status, with the admin's replies. */
export function MySuggestionsPage() {
  const mine = useMySuggestions()
  const venues = useVenues()
  const location = useLocation()
  const updateDeal = useUpdateDeal()
  const updateVenue = useUpdateVenue()
  const [params, setParams] = useSearchParams()
  const tab = STATUSES.find((s) => s === params.get('tab')) ?? 'pending'
  const [editing, setEditing] = useState<MySuggestion | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const groups = useMemo(
    () => groupByStatus(mine.data ? mySuggestions(mine.data, venues.data ?? []) : []),
    [mine.data, venues.data],
  )

  useEffect(() => {
    if (!notice) return
    const timer = setTimeout(() => setNotice(null), 6000)
    return () => clearTimeout(timer)
  }, [notice])

  const showTab = useCallback((value: SuggestionStatus) => setParams({ tab: value }, { replace: true }), [setParams])
  // Stable: a Sheet re-focuses its first field when onClose changes.
  const close = useCallback(() => setEditing(null), [])

  /** After a save: a rejected one is waiting again, so that's where it is now. */
  function saved(item: MySuggestion) {
    setEditing(null)
    if (item.status === 'rejected') {
      setNotice('נשלח שוב לאישור')
      showTab('pending')
    } else setNotice('השינויים נשמרו')
  }

  if (mine.isPending) return <Loading />

  const list = groups[tab]
  const empty = EMPTY[tab]

  return (
    <div className="space-y-4">
      <Link to="/settings" className="inline-flex items-center gap-1 text-sm font-medium text-brand-700 dark:text-brand-200">
        <ChevronRight size={16} />
        הגדרות
      </Link>

      <Segmented
        value={tab}
        onChange={showTab}
        options={STATUSES.map((s) => ({ value: s, label: `${TAB_LABELS[s]} (${groups[s].length})` }))}
        className="[&>button]:px-2 [&>button]:whitespace-nowrap"
      />

      {mine.error && <ErrorBox error={mine.error} />}

      {list.length === 0 ? (
        <EmptyState icon={empty.icon} title={empty.title}>
          {empty.text}
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {list.map((item) => (
            <SuggestionItem key={item.key} item={item} onEdit={() => setEditing(item)} />
          ))}
        </div>
      )}

      {notice && (
        // A tap dismisses it, in case it covers a field.
        <p
          role="status"
          onClick={() => setNotice(null)}
          className="fixed inset-x-4 bottom-[calc(6rem+env(safe-area-inset-bottom))] z-[60] mx-auto max-w-md rounded-xl bg-ink px-4 py-3 text-sm text-page shadow-lg"
        >
          {notice}
        </p>
      )}

      {editing?.deal && (
        <DealForm
          key={editing.key}
          mode="edit"
          status={editing.status}
          venues={venues.data ?? []}
          place={editing.venue ?? undefined}
          initial={draftFromDeal(editing.deal)}
          onClose={close}
          onSubmit={(fields: DealFields) =>
            updateDeal.mutateAsync({ id: editing.deal!.id, fields }).then(() => saved(editing))
          }
        />
      )}
      {editing && !editing.deal && editing.venue && (
        <VenueForm
          key={editing.key}
          mode="edit"
          status={editing.status}
          venues={venues.data ?? []}
          location={location}
          initial={venueDraftFrom(editing.venue)}
          onClose={close}
          onSubmit={(fields: VenueFields) =>
            updateVenue.mutateAsync({ id: editing.venue!.id, fields }).then(() => saved(editing))
          }
        />
      )}
    </div>
  )
}
