// Choosing a place by name: the deal form's and the AI import's.
import { useMemo, useState, type ReactNode } from 'react'
import { Search } from 'lucide-react'
import type { Venue } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { venueKind } from '@/features/going-out/lib/kinds'
import { searchVenues } from '@/features/going-out/lib/search'

interface VenuePickerProps {
  /** The places to pick from. */
  venues: Venue[]
  /** The chosen place, if any. */
  venue: Pick<Venue, 'name' | 'kind'> | undefined
  onPick: (id: number | null) => void
  /** No "שינוי": an admin edits a deal, not where it is. */
  locked?: boolean
  /** What the search starts with, e.g. the name an AI read. */
  initialQuery?: string
  /** Under the results, with what was typed: "המקום לא ברשימה?". */
  footer?: (query: string) => ReactNode
}

export function VenuePicker({ venues, venue, onPick, locked, initialQuery = '', footer }: VenuePickerProps) {
  const [query, setQuery] = useState(initialQuery)
  const results = useMemo(() => searchVenues(venues, query), [venues, query])

  if (venue) {
    return (
      <div className="flex items-center gap-2 rounded-xl border border-line px-3 py-2">
        <span aria-hidden>{venueKind(venue.kind).emoji}</span>
        <span className="min-w-0 flex-1 truncate font-medium">{venue.name}</span>
        {!locked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              onPick(null)
              setQuery('')
            }}
          >
            שינוי
          </Button>
        )}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search size={18} className="pointer-events-none absolute start-3 top-3 text-ink-3" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="חיפוש לפי שם המקום"
          aria-label="חיפוש מקום"
          className="ps-10"
        />
      </div>
      {results.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line">
          {results.map((v) => (
            <li key={v.id}>
              <button
                type="button"
                onClick={() => onPick(v.id)}
                className="flex w-full items-center gap-2 px-3 py-2.5 text-start active:bg-surface-2"
              >
                <span aria-hidden>{venueKind(v.kind).emoji}</span>
                <span className="min-w-0 flex-1 truncate">{v.name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {query.trim() && results.length === 0 && <p className="text-sm text-ink-3">לא נמצא מקום בשם הזה</p>}
      {footer?.(query.trim())}
    </div>
  )
}
