import type { ComponentType } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { RouteObject } from 'react-router-dom'

export type NavGroupId = 'money'

export interface FeatureNav {
  /** 'primary' = bottom navigation bar, 'more' = the "עוד" page. */
  placement: 'primary' | 'more'
  order: number
  /** Features in the same group share one bottom-nav slot and get tabs. */
  group?: NavGroupId
}

/**
 * Everything the shell needs to know about a feature. Each feature folder
 * exports one of these from its index.ts and is listed in app/features.ts.
 */
export interface FeatureDefinition {
  id: string
  title: string
  icon: LucideIcon
  /** Base path, used for navigation links, e.g. "/shopping". */
  path: string
  routes: RouteObject[]
  nav?: FeatureNav
  /** Card shown on the home dashboard. */
  Widget?: ComponentType
  /** Extra section at the bottom of the settings page (rarely used tools). */
  SettingsSection?: ComponentType
  widgetOrder?: number
}
