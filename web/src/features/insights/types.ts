import type {
  Bill,
  BillPayment,
  Chore,
  ChoreCompletion,
  FrequentItem,
  HouseholdMember,
  ListItem,
  PriceChange,
  Store,
} from '@/lib/db-types'
import type { ISODate } from '@/lib/dates'
import type { ExpenseWithShares } from '@/features/expenses/api'

/** Everything a rule may look at. Loaded once by useInsightData. */
export interface InsightData {
  today: ISODate
  userId: string
  members: HouseholdMember[]
  /** Roughly the last 6 months. */
  expenses: ExpenseWithShares[]
  balances: Record<string, number>
  bills: Bill[]
  billPayments: BillPayment[]
  frequentItems: FrequentItem[]
  listItems: ListItem[]
  chores: Chore[]
  completions: ChoreCompletion[]
  priceChanges: PriceChange[]
  stores: Store[]
}

export type InsightTone = 'good' | 'tip' | 'warning' | 'info'

export interface Insight {
  /** Stable id, e.g. "running-low:חלב". */
  id: string
  tone: InsightTone
  icon: string
  title: string
  body?: string
  /** In-app link for the call to action. */
  link?: { to: string; label: string }
  /** Higher shows first. Roughly: 80+ act now, 50 useful, 20 nice to know. */
  priority: number
}

/**
 * One insight rule. Add a rule by creating a file in rules/ and listing it
 * in rules/index.ts. Rules must be pure: same data in, same insights out.
 */
export interface InsightRule {
  id: string
  evaluate: (data: InsightData) => Insight[]
}
