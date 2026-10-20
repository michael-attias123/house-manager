import { createElement, lazy } from 'react'
import { Wallet } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'
import { ExpensesWidget } from './Widget'

const ExpensesPage = lazy(() => import('./ExpensesPage').then((m) => ({ default: m.ExpensesPage })))
const SplitwiseImport = lazy(() => import('./import/SplitwiseImport'))

export const expensesFeature: FeatureDefinition = {
  id: 'expenses',
  title: 'התחשבנות',
  icon: Wallet,
  path: '/expenses',
  routes: [{ path: 'expenses', element: createElement(ExpensesPage) }],
  nav: { placement: 'primary', order: 20, group: 'money' },
  Widget: ExpensesWidget,
  SettingsSection: SplitwiseImport,
  widgetOrder: 10,
}
