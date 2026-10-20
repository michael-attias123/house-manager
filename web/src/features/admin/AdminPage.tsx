import { useSearchParams } from 'react-router-dom'
import { EmptyState, Loading } from '@/components/ui/Feedback'
import { Segmented } from '@/components/ui/Segmented'
import { AllowedEmails } from './components/AllowedEmails'
import { Households } from './components/Households'
import { IngestRuns } from './components/IngestRuns'
import { Users } from './components/Users'
import { useIsAdmin } from './hooks'

type Tab = 'emails' | 'households' | 'users' | 'prices'

const TABS: { value: Tab; label: string }[] = [
  { value: 'emails', label: 'הרשמה' },
  { value: 'households', label: 'בתים' },
  { value: 'users', label: 'משתמשים' },
  { value: 'prices', label: 'מחירים' },
]

export function AdminPage() {
  const isAdmin = useIsAdmin()
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

  return (
    <div className="space-y-4">
      <Segmented value={tab} onChange={(value) => setParams({ tab: value }, { replace: true })} options={TABS} />
      {tab === 'emails' && <AllowedEmails />}
      {tab === 'households' && <Households />}
      {tab === 'users' && <Users />}
      {tab === 'prices' && <IngestRuns />}
    </div>
  )
}
