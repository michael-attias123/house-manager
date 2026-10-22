import { lazy } from 'react'
import { Bell } from 'lucide-react'
import type { FeatureDefinition } from '@/app/types'

const NotificationsCard = lazy(() => import('./NotificationsCard'))

/**
 * Web Push (supabase/migrations/20261022000100_notifications.sql and
 * supabase/functions/send-push). No page or nav entry: a card in Settings
 * turns it on for this device and picks the kinds.
 */
export const notificationsFeature: FeatureDefinition = {
  id: 'notifications',
  title: 'התראות',
  icon: Bell,
  path: '/notifications',
  routes: [],
  SettingsSection: NotificationsCard,
}
