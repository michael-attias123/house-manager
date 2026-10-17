import { createElement, lazy } from 'react'
import { Lightbulb } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'
import { InsightsWidget } from './Widget'

const InsightsPage = lazy(() => import('./InsightsPage').then((m) => ({ default: m.InsightsPage })))

export const insightsFeature: FeatureDefinition = {
  id: 'insights',
  title: 'תובנות',
  icon: Lightbulb,
  path: '/insights',
  routes: [{ path: 'insights', element: createElement(InsightsPage) }],
  nav: { placement: 'more', order: 20 },
  Widget: InsightsWidget,
  widgetOrder: 5,
}
