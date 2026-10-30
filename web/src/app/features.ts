import type { LucideIcon } from 'lucide-react'
import { Wallet } from 'lucide-react'
import { adminFeature } from '@/features/admin'
import { billsFeature } from '@/features/bills'
import { choresFeature } from '@/features/chores'
import { expensesFeature } from '@/features/expenses'
import { goingOutFeature } from '@/features/going-out'
import { householdFeature } from '@/features/household'
import { insightsFeature } from '@/features/insights'
import { notificationsFeature } from '@/features/notifications'
import { pricesFeature } from '@/features/prices'
import { shoppingFeature } from '@/features/shopping'
import type { FeatureDefinition, NavGroupId } from './types'

/**
 * The app is the sum of these features. To add one: create
 * src/features/<name>/index.ts exporting a FeatureDefinition, then list it here.
 */
export const FEATURES: FeatureDefinition[] = [
  shoppingFeature,
  // Before expenses so its Settings card comes before the Splitwise import.
  notificationsFeature,
  expensesFeature,
  billsFeature,
  choresFeature,
  pricesFeature,
  // Before insights: both are "more" order 20, and the list order breaks the tie.
  goingOutFeature,
  insightsFeature,
  householdFeature,
  adminFeature,
]

export const NAV_GROUPS: Record<NavGroupId, { title: string; icon: LucideIcon }> = {
  money: { title: 'כסף', icon: Wallet },
}

export interface NavEntry {
  key: string
  title: string
  icon: LucideIcon
  to: string
  /** Paths that make this entry active. */
  paths: string[]
  /** Sibling tabs shown on pages of a group. */
  tabs?: { title: string; to: string }[]
}

export function primaryNav(features: FeatureDefinition[] = FEATURES): NavEntry[] {
  const primary = features
    .filter((f) => f.nav?.placement === 'primary')
    .sort((a, b) => a.nav!.order - b.nav!.order)
  const entries: NavEntry[] = []
  for (const f of primary) {
    const group = f.nav!.group
    if (!group) {
      entries.push({ key: f.id, title: f.title, icon: f.icon, to: f.path, paths: [f.path] })
      continue
    }
    if (entries.some((e) => e.key === group)) continue
    const members = primary.filter((g) => g.nav!.group === group)
    entries.push({
      key: group,
      title: NAV_GROUPS[group].title,
      icon: NAV_GROUPS[group].icon,
      to: members[0].path,
      paths: members.map((m) => m.path),
      tabs: members.map((m) => ({ title: m.title, to: m.path })),
    })
  }
  return entries
}

export function moreFeatures(features: FeatureDefinition[] = FEATURES): FeatureDefinition[] {
  return features.filter((f) => f.nav?.placement === 'more').sort((a, b) => a.nav!.order - b.nav!.order)
}

export function dashboardWidgets(features: FeatureDefinition[] = FEATURES) {
  return features
    .filter((f) => f.Widget)
    .sort((a, b) => (a.widgetOrder ?? 50) - (b.widgetOrder ?? 50))
    .map((f) => ({ id: f.id, Widget: f.Widget! }))
}

export function featureForPath(pathname: string, features: FeatureDefinition[] = FEATURES) {
  return features.find((f) => pathname === f.path || pathname.startsWith(`${f.path}/`))
}
