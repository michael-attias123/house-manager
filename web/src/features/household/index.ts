import { lazy } from 'react'
import { createElement } from 'react'
import { Settings } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'

const SettingsPage = lazy(() => import('./SettingsPage').then((m) => ({ default: m.SettingsPage })))

export const householdFeature: FeatureDefinition = {
  id: 'household',
  title: 'הגדרות',
  icon: Settings,
  path: '/settings',
  routes: [{ path: 'settings', element: createElement(SettingsPage) }],
  nav: { placement: 'more', order: 100 },
}
