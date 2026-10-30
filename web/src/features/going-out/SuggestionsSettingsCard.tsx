import { Fragment, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, Martini } from 'lucide-react'
import { Card, CardTitle } from '@/components/ui/Card'
import { useMySuggestions } from './hooks'
import { groupByStatus, mySuggestions, summaryParts } from './lib/mine'

/** Settings section: the household's going-out suggestions, one tap from their page. */
export default function SuggestionsSettingsCard() {
  const mine = useMySuggestions()
  const parts = useMemo(() => summaryParts(groupByStatus(mine.data ? mySuggestions(mine.data, []) : [])), [mine.data])

  return (
    <Card className="space-y-3">
      <div className="space-y-1">
        <CardTitle>ההצעות שלי</CardTitle>
        <p className="text-sm text-ink-2">
          {mine.isPending
            ? 'דילים ומקומות שהבית הציע ללאן יוצאים.'
            : parts.length === 0
              ? 'עוד לא הצעתם כלום. מוסיפים דיל במסך לאן יוצאים.'
              : parts.map(([n, word], i) => (
                  <Fragment key={word}>
                    {i > 0 && ' · '}
                    <span className="num">{n}</span> {word}
                  </Fragment>
                ))}
        </p>
      </div>
      <Link
        to="/going-out/suggestions"
        className="flex h-11 items-center gap-2 rounded-xl bg-surface-2 px-4 font-medium text-ink hover:bg-line"
      >
        <Martini size={18} className="text-brand-700" />
        <span className="flex-1">ההצעות ותגובות המנהל</span>
        <ChevronLeft size={18} className="text-ink-3" />
      </Link>
    </Card>
  )
}
