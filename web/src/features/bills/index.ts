import { createElement, lazy } from 'react'
import { Receipt } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'
import { BillsWidget } from './Widget'

const BillsPage = lazy(() => import('./BillsPage').then((m) => ({ default: m.BillsPage })))

export const billsFeature: FeatureDefinition = {
  id: 'bills',
  title: 'חשבונות',
  icon: Receipt,
  path: '/bills',
  routes: [{ path: 'bills', element: createElement(BillsPage) }],
  nav: { placement: 'primary', order: 21, group: 'money' },
  Widget: BillsWidget,
  widgetOrder: 30,
}
