import { Link } from 'react-router-dom'
import { ListChecks } from 'lucide-react'
import { todayISO } from '@/lib/dates'
import { Card } from '@/components/ui/Card'
import { ChoreRow } from './components/ChoreRow'
import { useChores, useCompleteChore } from './hooks'
import { isDueBy } from './lib/chores'

export function ChoresWidget() {
  const chores = useChores()
  const complete = useCompleteChore()
  const due = (chores.data ?? []).filter((c) => isDueBy(c, todayISO()))

  if (!chores.data?.length) return null
  return (
    <Card className="space-y-1 p-0">
      <Link to="/chores" className="flex items-center gap-2 px-4 pt-4">
        <ListChecks size={18} className="text-brand-700" />
        <h2 className="flex-1 font-semibold">מטלות להיום</h2>
        <span className="num text-sm text-ink-2">{due.length}</span>
      </Link>
      {due.length === 0 ? (
        <p className="px-4 pb-4 text-sm text-ink-3">הכל בוצע להיום ✨</p>
      ) : (
        <ul className="divide-y divide-line">
          {due.slice(0, 5).map((chore) => (
            <ChoreRow key={chore.id} chore={chore} onComplete={() => complete.mutate({ chore })} onOpen={() => undefined} />
          ))}
        </ul>
      )}
    </Card>
  )
}
