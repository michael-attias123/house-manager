import { useMemo, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Martini } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { DealWhen, Distance } from './components/Labels'
import { useDeals, useLocation, useNow, useVenues } from './hooks'
import { venueKind } from './lib/kinds'
import { tonight } from './lib/tonight'

function count(n: number, one: string, many: (n: ReactNode) => ReactNode) {
  return n === 1 ? one : many(<span className="num">{n}</span>)
}

/** "הערב בבאר שבע": never asks for the location; uses it only when already allowed. */
export function GoingOutWidget() {
  const venues = useVenues()
  const deals = useDeals()
  const location = useLocation()
  const now = useNow()
  const summary = useMemo(
    () => tonight(venues.data ?? [], deals.data ?? [], location.origin, now),
    [venues.data, deals.data, location.origin, now],
  )
  const { active, later, pick } = summary

  return (
    <Link to="/going-out" className="block">
      <Card className="space-y-2">
        <div className="flex items-center gap-2">
          <Martini size={18} className="text-brand-700" />
          <h2 className="flex-1 font-semibold">הערב בבאר שבע</h2>
        </div>
        {!pick ? (
          <p className="text-sm text-ink-3">אין דילים להערב. אפשר להוסיף אחד</p>
        ) : (
          <>
            {(active > 0 || later > 0) && (
              <p className="text-sm text-ink-2">
                {active > 0 && count(active, 'דיל אחד פעיל עכשיו', (n) => <>{n} דילים פעילים עכשיו</>)}
                {active > 0 && later > 0 && ' · '}
                {later > 0 && count(later, 'אחד בהמשך הערב', (n) => <>{n} בהמשך הערב</>)}
              </p>
            )}
            <p className="truncate text-sm">
              <span aria-hidden>{venueKind(pick.venue.kind).emoji}</span> <span className="font-medium">{pick.venue.name}</span>
              {' · '}
              {pick.deal.title}
              {' · '}
              {pick.window.state === 'active' ? (
                <Distance km={pick.distanceKm} />
              ) : (
                <DealWhen deal={pick.deal} window={pick.window} />
              )}
            </p>
          </>
        )}
      </Card>
    </Link>
  )
}
