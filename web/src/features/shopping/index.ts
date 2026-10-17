import { createElement, lazy } from 'react'
import { ShoppingCart } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'
import { ShoppingWidget } from './Widget'

const ShoppingPage = lazy(() => import('./ShoppingPage').then((m) => ({ default: m.ShoppingPage })))

export const shoppingFeature: FeatureDefinition = {
  id: 'shopping',
  title: 'קניות',
  icon: ShoppingCart,
  path: '/shopping',
  routes: [{ path: 'shopping', element: createElement(ShoppingPage) }],
  nav: { placement: 'primary', order: 10 },
  Widget: ShoppingWidget,
  widgetOrder: 20,
}
