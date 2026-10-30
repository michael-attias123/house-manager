// In-memory tables for the demo build, saved to localStorage so changes
// survive a reload. Storage can be unavailable (private mode, previews), in
// which case the demo still works for the session.
import { todayISO } from '@/lib/dates'
import { DEMO_USERS, MICHAEL, createSeed } from './seed'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>
export type Db = Record<string, Row[]>

const DB_KEY = 'house-manager-demo-db-v4'
const USER_KEY = 'house-manager-demo-user'
const CACHE_KEY = 'house-manager-cache'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Not persisted; fine for a demo.
  }
}

function load(): Db {
  const saved = read(DB_KEY)
  if (saved) {
    try {
      const db = JSON.parse(saved) as Db
      // Tables added since this browser saved its data start empty, so a
      // new table needs no DB_KEY bump (which would reset everyone's demo).
      for (const table of Object.keys(createSeed())) db[table] ??= []
      return db
    } catch {
      // Fall through to a fresh seed.
    }
  }
  return createSeed()
}

export const db: Db = load()

export function save() {
  write(DB_KEY, JSON.stringify(db))
}

export function currentUserId(): string {
  const saved = read(USER_KEY)
  return DEMO_USERS.some((u) => u.id === saved) ? saved! : MICHAEL
}

/** Switch who is "logged in" and reload, like opening the app on the other phone. */
export function switchUser(userId: string) {
  write(USER_KEY, userId)
  write(CACHE_KEY, null)
  window.location.reload()
}

export function resetDemo() {
  write(DB_KEY, null)
  write(CACHE_KEY, null)
  window.location.reload()
}

export function uuid(): string {
  return crypto.randomUUID()
}

const nowIso = () => new Date().toISOString()

/** Column defaults the database would fill in. */
export function withDefaults(table: string, row: Row): Row {
  const today = todayISO()
  const base: Row = {}
  if (!['household_members', 'expense_shares', 'prices', 'product_links', 'item_categories', 'notification_prefs'].includes(table)) base.id = uuid()
  if (['list_items', 'expenses', 'bills', 'chores'].includes(table)) base.updated_at = nowIso()
  base.created_at = nowIso()
  switch (table) {
    case 'list_items':
      Object.assign(base, {
        quantity: 1, unit: null, category: 'other', note: null, barcode: null, checked: false,
        checked_by: null, checked_at: null, added_by: currentUserId(),
      })
      break
    case 'settlements':
      Object.assign(base, { settled_on: today, note: null, created_by: currentUserId() })
      break
    case 'bills':
      Object.assign(base, { active: true, provider: null, notes: null, icon: null })
      break
    case 'chores':
      Object.assign(base, { active: true, next_due: today, interval_days: null, weekdays: null })
      break
    case 'chore_completions':
      Object.assign(base, { done_by: currentUserId(), done_on: today })
      break
    case 'venues':
      // bigint identity.
      Object.assign(base, {
        id: Math.max(0, ...db.venues.map((v) => Number(v.id))) + 1,
        osm_ref: null, lat: null, lng: null, address: null, opening_hours: null, website: null, phone: null,
        instagram: null, cuisine: null, source: 'community', household_id: null, created_by: currentUserId(),
        status: 'approved', hidden: false, review_note: null, updated_at: nowIso(),
      })
      break
    case 'venue_deals':
      Object.assign(base, {
        household_id: null, created_by: currentUserId(), weekdays: [], starts_at: null, ends_at: null,
        valid_from: null, valid_until: null, note: null, status: 'pending', reviewed_by: null, reviewed_at: null,
        review_note: null, last_confirmed_at: nowIso(),
      })
      break
    case 'product_links':
    case 'item_categories':
      base.updated_at = nowIso()
      break
    case 'notification_prefs':
      Object.assign(base, { bills: false, chores: false, partner: false, weekly: false, admin: false, updated_at: nowIso() })
      break
  }
  return { ...base, ...row }
}

/** Columns that are part of each table's primary key (for upsert). */
export const PRIMARY_KEYS: Record<string, string[]> = {
  household_members: ['household_id', 'user_id'],
  expense_shares: ['expense_id', 'user_id'],
  prices: ['store_id', 'barcode'],
  product_links: ['household_id', 'normalized_name'],
  item_categories: ['household_id', 'normalized_name'],
  notification_prefs: ['user_id'],
}

export function primaryKey(table: string): string[] {
  return PRIMARY_KEYS[table] ?? ['id']
}
