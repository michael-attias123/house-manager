import { useSearchParams } from 'react-router-dom'
import { EmptyState, Loading } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { AllowedEmails } from './components/AllowedEmails'
import { Households } from './components/Households'
import { IngestRuns } from './components/IngestRuns'
import { Suggestions } from './components/Suggestions'
import { Users } from './components/Users'
import { useAdminSuggestions, useIsAdmin } from './hooks'

type Tab = 'emails' | 'households' | 'users' | 'prices' | 'suggestions'

const TABS: { value: Tab; label: string }[] = [
  { value: 'emails', label: 'הרשמה' },
  { value: 'households', label: 'בתים' },
  { value: 'users', label: 'משתמשים' },
  { value: 'prices', label: 'מחירים' },
  // Linked from the admins' "הצעה חדשה בלאן יוצאים" notification.
  { value: 'suggestions', label: 'הצעות' },
]

export function AdminPage() {
  const isAdmin = useIsAdmin()
  const suggestions = useAdminSuggestions(isAdmin.data === true)
  const [params, setParams] = useSearchParams()
  const requested = params.get('tab')
  const tab = TABS.find((t) => t.value === requested)?.value ?? 'emails'

  if (isAdmin.isPending) return <Loading />
  if (!isAdmin.data) {
    return (
      <EmptyState icon="🔒" title="המסך זמין רק עם הרשאת ניהול">
        את ההרשאה נותנים ב-Supabase, לפי ההוראות ב-<span className="num">docs/setup.md</span>.
      </EmptyState>
    )
  }

  const waiting = suggestions.data?.length ?? 0
  const tabs = TABS.map((t) => (t.value === 'suggestions' && waiting > 0 ? { ...t, label: `${t.label} (${waiting})` } : t))

  return (
    <div className="space-y-4">
      {/* Five tabs, one with a count: narrower padding keeps each on one line on a phone. */}
      <Segmented
        value={tab}
        onChange={(value) => setParams({ tab: value }, { replace: true })}
        options={tabs}
        className="[&>button]:px-2 [&>button]:whitespace-nowrap"
      />
      {tab === 'emails' && <AllowedEmails />}
      {tab === 'households' && <Households />}
      {tab === 'users' && <Users />}
      {tab === 'prices' && <IngestRuns />}
      {tab === 'suggestions' && <Suggestions />}
    </div>
  )
}
