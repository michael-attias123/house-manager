import { createElement, lazy } from 'react'
import { Martini } from 'lucide-react'
import type { FeatureDefinition, RouteHandle } from '@/app/types'
import { GoingOutWidget } from './Widget'

const GoingOutPage = lazy(() => import('./GoingOutPage').then((m) => ({ default: m.GoingOutPage })))
const MySuggestionsPage = lazy(() => import('./MySuggestionsPage').then((m) => ({ default: m.MySuggestionsPage })))
const SuggestionsSettingsCard = lazy(() => import('./SuggestionsSettingsCard'))

export const goingOutFeature: FeatureDefinition = {
  id: 'going-out',
  title: 'לאן יוצאים',
  icon: Martini,
  path: '/going-out',
  routes: [
    { path: 'going-out', element: createElement(GoingOutPage) },
    // Reached from the Settings card, and from the approved / rejected notifications.
    {
      path: 'going-out/suggestions',
      element: createElement(MySuggestionsPage),
      handle: { title: 'ההצעות שלי' } satisfies RouteHandle,
    },
  ],
  // Checked on the way out, so one tap from anywhere; the last bar slot before "עוד".
  nav: { placement: 'primary', order: 40, label: 'יוצאים' },
  Widget: GoingOutWidget,
  // After the shopping list (20) and the bills (30).
  widgetOrder: 35,
  SettingsSection: SuggestionsSettingsCard,
}
