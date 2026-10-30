import { createElement, lazy } from 'react'
import { Martini } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'
import { GoingOutWidget } from './Widget'

const GoingOutPage = lazy(() => import('./GoingOutPage').then((m) => ({ default: m.GoingOutPage })))

export const goingOutFeature: FeatureDefinition = {
  id: 'going-out',
  title: 'לאן יוצאים',
  icon: Martini,
  path: '/going-out',
  routes: [{ path: 'going-out', element: createElement(GoingOutPage) }],
  // Checked on the way out, so one tap from anywhere; the last bar slot before "עוד".
  nav: { placement: 'primary', order: 40, label: 'יוצאים' },
  Widget: GoingOutWidget,
  // After the shopping list (20) and the bills (30).
  widgetOrder: 35,
}
