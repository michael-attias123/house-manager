import { createElement, lazy } from 'react'
import { ListChecks } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'
import { ChoresWidget } from './Widget'

const ChoresPage = lazy(() => import('./ChoresPage').then((m) => ({ default: m.ChoresPage })))

export const choresFeature: FeatureDefinition = {
  id: 'chores',
  title: 'מטלות',
  icon: ListChecks,
  path: '/chores',
  routes: [{ path: 'chores', element: createElement(ChoresPage) }],
  nav: { placement: 'primary', order: 30 },
  Widget: ChoresWidget,
  widgetOrder: 15,
}
