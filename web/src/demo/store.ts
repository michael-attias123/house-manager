// In-memory tables for the demo build, saved to localStorage so changes
// survive a reload. Storage can be unavailable (private mode, previews), in
// which case the demo still works for the session.
import { todayISO } from '@/lib/dates'
import { DEMO_USERS, MICHAEL, createSeed } from './seed'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>
export type Db = Record<string, Row[]>

const DB_KEY = 'house-manager-demo-db-v1'
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
      return JSON.parse(saved) as Db
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
  if (!['household_members', 'expense_shares', 'prices', 'product_links'].includes(table)) base.id = uuid()
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
    case 'product_links':
      base.updated_at = nowIso()
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
}

export function primaryKey(table: string): string[] {
  return PRIMARY_KEYS[table] ?? ['id']
}
