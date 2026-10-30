// Row shapes of the tables in supabase/migrations. Keep in sync when a
// migration changes a table (or replace with `pnpm db:types` output).
import type { ISODate } from './dates'

export interface Household {
  id: string
  name: string
  invite_code: string
  created_at: string
}

export interface HouseholdMember {
  household_id: string
  user_id: string
  display_name: string
  color: string
  default_share_pct: number
  joined_at: string
  /** Added before signing in; joining with the invite code claims it. */
  is_placeholder?: boolean
}

export interface ShoppingList {
  id: string
  household_id: string
  name: string
  is_default: boolean
}

export interface ListItem {
  id: string
  list_id: string
  household_id: string
  name: string
  quantity: number
  unit: string | null
  category: string
  note: string | null
  barcode: string | null
  checked: boolean
  checked_by: string | null
  checked_at: string | null
  added_by: string | null
  created_at: string
  updated_at: string
}

export interface ShoppingTrip {
  id: string
  household_id: string
  store_id: number | null
  store_name: string | null
  total: number | null
  trip_date: ISODate
  item_count: number
  created_at: string
}

export interface Purchase {
  id: string
  household_id: string
  trip_id: string | null
  name: string
  normalized_name: string
  category: string
  barcode: string | null
  quantity: number
  unit: string | null
  purchased_at: string
}

export interface FrequentItem {
  household_id: string
  normalized_name: string
  name: string
  category: string
  barcode: string | null
  times_bought: number
  last_bought_at: string
  first_bought_at: string
}

/** A department the household chose by hand (features/shopping/lib/classify.ts). */
export interface ItemCategory {
  household_id: string
  normalized_name: string
  category: string
  updated_at: string
}

// "לאן יוצאים" (20261101000100_going_out.sql): places from OpenStreetMap, the
// "חבר טעמים" list (20261103000100_hever_teamim.sql), the city's tourism site
// (20261104000100_visitbr7_bars.sql) or added by a household, and deals the
// households suggest.
export type VenueKind = 'bar' | 'pub' | 'restaurant' | 'cafe' | 'nightclub' | 'other'
/** member_card: a discount for keva club card ("כרטיס חבר") holders; standing, not a happening. */
export type DealKind = 'happy_hour' | 'special_day' | 'event' | 'member_card'
export type SuggestionStatus = 'approved' | 'pending' | 'rejected'

export interface Venue {
  id: number
  osm_ref: string | null
  name: string
  kind: VenueKind
  lat: number | null
  lng: number | null
  address: string | null
  opening_hours: string | null
  website: string | null
  phone: string | null
  instagram: string | null
  cuisine: string | null
  source: 'osm' | 'community' | 'hever' | 'visitbr7'
  /** null = in the shared catalog; set = a household's suggestion, not approved yet. */
  household_id: string | null
  created_by: string | null
  status: SuggestionStatus
  /** Not in the catalog: gone from OSM, or hidden by an admin. */
  hidden: boolean
  /** Hidden with admin_hide_venue; the weekly ingest leaves it hidden. */
  hidden_by_admin: boolean
  review_note: string | null
  /** The household that added it; kept after approval (household_id is cleared then). */
  suggested_household_id: string | null
  /** Set by admin_update_venue; the ingest then keeps the admin's details. */
  admin_edited_at: string | null
  created_at: string
  updated_at: string
}

export interface VenueDeal {
  id: string
  venue_id: number
  household_id: string | null
  created_by: string | null
  title: string
  kind: DealKind
  /** 0 = Sunday … 6 = Saturday; empty = every day. */
  weekdays: number[]
  /** 'HH:MM:SS' as PostgREST returns time; both null = whenever the place is open. */
  starts_at: string | null
  ends_at: string | null
  valid_from: string | null
  valid_until: string | null
  note: string | null
  status: SuggestionStatus
  reviewed_by: string | null
  reviewed_at: string | null
  review_note: string | null
  last_confirmed_at: string
  created_at: string
}

/** A place the household starred; shown on top of the going-out list. */
export interface VenueFavorite {
  household_id: string
  venue_id: number
  created_at: string
}

export type SplitType = 'equal' | 'percent' | 'exact' | 'full' | 'default'

export interface Expense {
  id: string
  household_id: string
  description: string
  amount: number
  paid_by: string
  category: string
  expense_date: ISODate
  split_type: SplitType
  note: string | null
  source: 'manual' | 'trip' | 'bill' | 'import'
  source_id: string | null
  external_id?: string | null
  created_at: string
}

export interface ExpenseShare {
  expense_id: string
  household_id: string
  user_id: string
  amount: number
}

export interface Settlement {
  id: string
  household_id: string
  from_user: string
  to_user: string
  amount: number
  settled_on: ISODate
  note: string | null
  created_at: string
}

export type BillFrequency = 'monthly' | 'bimonthly' | 'quarterly' | 'yearly'

export interface Bill {
  id: string
  household_id: string
  name: string
  provider: string | null
  category: string
  icon: string | null
  amount_type: 'fixed' | 'variable'
  amount: number | null
  frequency: BillFrequency
  next_due_date: ISODate
  paid_by_default: string | null
  auto_create: boolean
  active: boolean
  notes: string | null
}

export interface BillPayment {
  id: string
  bill_id: string
  household_id: string
  due_date: ISODate
  amount: number
  paid_on: ISODate
  paid_by: string
  expense_id: string | null
}

export type ChoreRecurrence = 'once' | 'daily' | 'weekly' | 'every_n_days' | 'monthly'

export interface Chore {
  id: string
  household_id: string
  title: string
  emoji: string | null
  recurrence: ChoreRecurrence
  interval_days: number | null
  weekdays: number[] | null
  assignment: 'fixed' | 'rotate' | 'anyone'
  assignee_id: string | null
  next_due: ISODate
  active: boolean
}

export interface ChoreCompletion {
  id: string
  chore_id: string
  household_id: string
  done_by: string
  done_on: ISODate
}

export interface Chain {
  id: string
  name: string
}

export interface Store {
  id: number
  chain_id: string
  store_code: string
  name: string
  city: string | null
  address: string | null
  active: boolean
  last_ingested_at: string | null
}

/** Normalized pack size unit (products.pack_unit): grams, ml, units, meters. */
export type PackUnit = 'g' | 'ml' | 'u' | 'm'

/** A row of match_candidates(): the cheapest product per item, store and pack size. */
export interface MatchCandidate {
  item_id: string
  /** 0: the linked barcode, 1: name starts with the item, 2: has its words, 3: similar. */
  tier: number
  store_id: number
  barcode: string
  product_name: string
  price: number
  pack_unit: PackUnit | null
  pack_qty: number | null
  is_weighted: boolean
}

export interface ProductSearchResult {
  barcode: string
  name: string
  manufacturer: string | null
  pack_unit: PackUnit | null
  pack_qty: number | null
  is_weighted: boolean
  min_price: number | null
  max_price: number | null
  store_count: number
}

export interface PriceChange {
  barcode: string
  product_name: string
  store_id: number
  changed_on: ISODate
  old_price: number
  new_price: number
  times_bought: number
}

export interface IngestRun {
  id: number
  started_at: string
  finished_at: string | null
  status: 'running' | 'ok' | 'partial' | 'failed'
  stats: Record<string, unknown>
}

/** public.allowed_emails: who may create an account (admin screen only). */
export interface AllowedEmail {
  email: string
  note: string | null
  added_at: string
}

/** A member as admin_list_households() returns it. */
export interface AdminHouseholdMember {
  user_id: string
  display_name: string
  is_placeholder: boolean
  /** null for a placeholder, or when the account was deleted. */
  email: string | null
}

/** A row of admin_list_households(). */
export interface AdminHousehold {
  id: string
  name: string
  created_at: string
  members: AdminHouseholdMember[]
  expense_count: number
  bill_count: number
  chore_count: number
  list_item_count: number
}

/** public.notification_prefs: which notification kinds a user wants, on all their devices. */
export interface NotificationPrefs {
  user_id: string
  bills: boolean
  chores: boolean
  partner: boolean
  weekly: boolean
  /** A going-out suggestion of the household was approved or rejected. */
  going_out: boolean
  /** Only counts for admins. */
  admin: boolean
  updated_at?: string
}

/** public.push_subscriptions: a browser or phone that turned notifications on. */
export interface PushSubscriptionRow {
  id: string
  user_id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: string
  last_success_at: string | null
}

/** A row of admin_list_users(). */
export interface AdminUser {
  id: string
  email: string | null
  full_name: string | null
  created_at: string | null
  last_sign_in_at: string | null
  is_admin: boolean
  on_allowlist: boolean
  household_names: string[]
}
