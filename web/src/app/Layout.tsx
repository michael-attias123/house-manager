import { Suspense } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { Home, MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/cn'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { Loading } from '@/components/ui/Feedback'
import { useHousehold } from '@/features/household/HouseholdProvider'
import { featureForPath, moreFeatures, primaryNav } from './features'

const NAV = primaryNav()

export function Layout() {
  const { pathname } = useLocation()
  const { household } = useHousehold()
  const feature = featureForPath(pathname)
  const group = NAV.find((n) => n.tabs && n.paths.includes(feature?.path ?? ''))
  const title = pathname === '/' ? household.name : pathname === '/more' ? 'עוד' : (feature?.title ?? '')
  const inMore = pathname === '/more' || moreFeatures().some((f) => f.path === feature?.path)

  return (
    <div className="mx-auto min-h-dvh max-w-lg">
      <header className="pt-safe sticky top-0 z-20 bg-page/90 backdrop-blur">
        <div className="flex h-14 items-center px-4">
          <h1 className="text-xl font-bold">{group ? group.title : title}</h1>
        </div>
        {group?.tabs && (
          <nav className="flex gap-1 px-4 pb-2">
            {group.tabs.map((tab) => (
              <NavLink
                key={tab.to}
                to={tab.to}
                className={({ isActive }) =>
                  cn(
                    'rounded-full px-4 py-1.5 text-sm font-medium',
                    isActive ? 'bg-ink text-page' : 'bg-surface-2 text-ink-2',
                  )
                }
              >
                {tab.title}
              </NavLink>
            ))}
          </nav>
        )}
      </header>

      <main className="px-4 pt-2 pb-28">
        <ErrorBoundary key={pathname}>
          <Suspense fallback={<Loading />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>

      <nav className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 backdrop-blur">
        <ul className="mx-auto flex max-w-lg">
          <NavItem to="/" title="בית" icon={Home} active={pathname === '/'} />
          {NAV.map((entry) => (
            <NavItem
              key={entry.key}
              to={entry.to}
              title={entry.title}
              icon={entry.icon}
              active={entry.paths.some((p) => pathname === p || pathname.startsWith(`${p}/`))}
            />
          ))}
          <NavItem to="/more" title="עוד" icon={MoreHorizontal} active={inMore} />
        </ul>
      </nav>
    </div>
  )
}

function NavItem({
  to,
  title,
  icon: Icon,
  active,
}: {
  to: string
  title: string
  icon: typeof Home
  active: boolean
}) {
  return (
    <li className="flex-1">
      <NavLink
        to={to}
        className={cn(
          'flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium',
          active ? 'text-brand-700 dark:text-brand-200' : 'text-ink-3',
        )}
      >
        <Icon size={22} strokeWidth={active ? 2.4 : 1.8} />
        {title}
      </NavLink>
    </li>
  )
}
