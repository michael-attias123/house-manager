import { ErrorBoundary } from '@/components/ErrorBoundary'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { dashboardWidgets } from './features'

const WIDGETS = dashboardWidgets()

function greeting(hour: number) {
  if (hour < 5) return 'לילה טוב'
  if (hour < 12) return 'בוקר טוב'
  if (hour < 17) return 'צהריים טובים'
  if (hour < 21) return 'ערב טוב'
  return 'לילה טוב'
}

export function DashboardPage() {
  const { me } = useHousehold()
  return (
    <div className="space-y-3">
      <p className="text-ink-2">
        {greeting(new Date().getHours())}
        {me ? `, ${me.display_name}` : ''} 👋
      </p>
      {WIDGETS.map(({ id, Widget }) => (
        <ErrorBoundary key={id}>
          <Widget />
        </ErrorBoundary>
      ))}
    </div>
  )
}
