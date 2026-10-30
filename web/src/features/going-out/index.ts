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
  nav: { placement: 'more', order: 20 },
  Widget: GoingOutWidget,
  // After the shopping list (20) and the bills (30).
  widgetOrder: 35,
}
