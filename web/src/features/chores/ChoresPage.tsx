import { useMemo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Chore } from '@/lib/db-types'
import { monthKey, todayISO } from '@/lib/dates'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { Fab } from '@/components/ui/Fab'
import { MemberAvatar } from '@/components/ui/MemberAvatar'
import { Segmented } from '@/components/ui/Segmented'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { ChoreRow } from './components/ChoreRow'
import { ChoreSheet } from './components/ChoreSheet'
import { useChoreCompletions, useChores, useCompleteChore } from './hooks'
import { completionCounts, isDueBy, weekEnd } from './lib/chores'

type View = 'today' | 'week' | 'all'

export function ChoresPage() {
  const { members, user } = useHousehold()
  const chores = useChores()
  const completions = useChoreCompletions()
  const complete = useCompleteChore()
  const [view, setView] = useState<View>('today')
  const [mineOnly, setMineOnly] = useState(false)
  const [editing, setEditing] = useState<Chore | 'new' | null>(null)

  const today = todayISO()
  const visible = useMemo(() => {
    let list = chores.data ?? []
    if (view === 'today') list = list.filter((c) => isDueBy(c, today))
    if (view === 'week') list = list.filter((c) => isDueBy(c, weekEnd(today)))
    if (mineOnly) list = list.filter((c) => c.assignment === 'anyone' || c.assignee_id === user.id)
    return list
  }, [chores.data, view, mineOnly, today, user.id])

  const counts = completionCounts(completions.data ?? [], monthKey(today))

  if (chores.isPending) return <Loading />

  return (
    <div className="space-y-4 pb-24">
      <Segmented
        value={view}
        onChange={setView}
        options={[
          { value: 'today', label: 'היום' },
          { value: 'week', label: 'השבוע' },
          { value: 'all', label: 'הכל' },
        ]}
      />
      <label className="flex items-center gap-2 px-1 text-sm text-ink-2">
        <input
          type="checkbox"
          className="h-4 w-4 accent-brand-700"
          checked={mineOnly}
          onChange={(e) => setMineOnly(e.target.checked)}
        />
        רק שלי
      </label>
      {chores.error && <ErrorBox error={chores.error} />}

      {visible.length === 0 ? (
        <EmptyState icon={chores.data?.length ? '✨' : '🧹'} title={chores.data?.length ? 'הכל בוצע!' : 'עוד אין מטלות'}>
          {chores.data?.length
            ? 'אין מטלות פתוחות לתקופה הזו.'
            : 'מוסיפים מטלות חוזרות, ובוחרים תורנות או אחריות קבועה.'}
        </EmptyState>
      ) : (
        <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
          {visible.map((chore) => (
            <ChoreRow
              key={chore.id}
              chore={chore}
              onComplete={() => complete.mutate({ chore })}
              onOpen={() => setEditing(chore)}
            />
          ))}
        </ul>
      )}

      {members.length > 1 && (
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold text-ink-2">החודש ביצעתם</h2>
          <ul className="flex gap-4">
            {members.map((m) => (
              <li key={m.user_id} className="flex items-center gap-2">
                <MemberAvatar member={m} size="sm" />
                <span>{m.display_name}</span>
                <span className="num font-semibold">{counts[m.user_id] ?? 0}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Fab onClick={() => setEditing('new')}>
        <Plus size={20} />
        מטלה
      </Fab>
      {editing && <ChoreSheet chore={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}
