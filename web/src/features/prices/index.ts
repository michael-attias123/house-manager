import { createElement, lazy } from 'react'
import { Store } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'

const PricesPage = lazy(() => import('./PricesPage').then((m) => ({ default: m.PricesPage })))

export const pricesFeature: FeatureDefinition = {
  id: 'prices',
  title: 'השוואת סלים',
  icon: Store,
  path: '/prices',
  routes: [{ path: 'prices', element: createElement(PricesPage) }],
  nav: { placement: 'more', order: 10 },
}
