import { createElement, lazy } from 'react'
import { ShieldCheck } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'

const AdminPage = lazy(() => import('./AdminPage').then((m) => ({ default: m.AdminPage })))
const AdminSettingsCard = lazy(() => import('./AdminSettingsCard'))

/**
 * App-wide management for admins (public.app_admins). No nav entry: it is
 * reached from a card at the bottom of Settings that only admins see.
 */
export const adminFeature: FeatureDefinition = {
  id: 'admin',
  title: 'ניהול האפליקציה',
  icon: ShieldCheck,
  path: '/admin',
  routes: [{ path: 'admin', element: createElement(AdminPage) }],
  SettingsSection: AdminSettingsCard,
}
