// TypeScript versions of the database views and RPCs in supabase/migrations,
// for the demo build. Keep behaviour in step with the SQL.
import { addDays, todayISO } from '@/lib/dates'
import { fromAgorot, toAgorot } from '@/lib/money'
import { advanceDueDate } from '@/features/bills/lib/bills'
import { computeShares } from '@/features/expenses/lib/split'
import type { BillFrequency } from '@/lib/db-types'
import { hasWords, normName } from '@/features/prices/lib/normalize'
import { currentUserId, db, uuid, withDefaults, type Row } from './store'

const normalize = (s: string) => s.trim().toLowerCase()

function members(householdId: string) {
  return db.household_members
    .filter((m) => m.household_id === householdId)
    .sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)))
}

function requireMember(householdId: string) {
  if (!members(householdId).some((m) => m.user_id === currentUserId())) throw new Error('not a member')
}

/** default_shares(): by default_share_pct, remainder to the payer. */
function defaultShares(householdId: string, amount: number, paidBy: string) {
  const weights = Object.fromEntries(members(householdId).map((m) => [m.user_id, Number(m.default_share_pct)]))
  return computeShares(amount, paidBy, { type: 'default', weights })
}

function insertExpense(row: Row, shares: Record<string, number>): string {
  const expense = withDefaults('expenses', { note: null, source: 'manual', source_id: null, created_by: currentUserId(), ...row })
  db.expenses.push(expense)
  for (const [userId, amount] of Object.entries(shares)) {
    if (amount > 0) db.expense_shares.push({ expense_id: expense.id, household_id: row.household_id, user_id: userId, amount })
  }
  return expense.id
}

export const VIEWS: Record<string, () => Row[]> = {
  frequent_items: () => {
    const groups = new Map<string, Row[]>()
    for (const p of db.purchases) {
      const key = `${p.household_id}|${p.normalized_name}`
      groups.set(key, [...(groups.get(key) ?? []), p])
    }
    return [...groups.values()].map((list) => {
      const sorted = [...list].sort((a, b) => String(b.purchased_at).localeCompare(String(a.purchased_at)))
      return {
        household_id: sorted[0].household_id,
        normalized_name: sorted[0].normalized_name,
        name: sorted[0].name,
        category: sorted[0].category,
        barcode: sorted.find((p) => p.barcode)?.barcode ?? null,
        times_bought: sorted.length,
        last_bought_at: sorted[0].purchased_at,
        first_bought_at: sorted[sorted.length - 1].purchased_at,
      }
    })
  },
  member_balances: () =>
    db.household_members.map((m) => {
      const mine = (rows: Row[], key: string) =>
        rows.filter((r) => r.household_id === m.household_id && r[key] === m.user_id).reduce((s, r) => s + toAgorot(Number(r.amount)), 0)
      const balance =
        mine(db.expenses, 'paid_by') - mine(db.expense_shares, 'user_id') + mine(db.settlements, 'from_user') - mine(db.settlements, 'to_user')
      return { household_id: m.household_id, user_id: m.user_id, balance: fromAgorot(balance) }
    }),
}

type Args = Record<string, unknown>
const str = (v: unknown) => (v == null ? null : String(v))

function recordBillPayment(bill: Row, amount: number, paidBy: string, paidOn: string): string {
  const expenseId = insertExpense(
    {
      household_id: bill.household_id, description: bill.name, amount, paid_by: paidBy, category: bill.category,
      expense_date: paidOn, split_type: 'default', source: 'bill', source_id: bill.id,
    },
    defaultShares(bill.household_id, amount, paidBy),
  )
  const payment = withDefaults('bill_payments', {
    bill_id: bill.id, household_id: bill.household_id, due_date: bill.next_due_date, amount, paid_on: paidOn,
    paid_by: paidBy, expense_id: expenseId,
  })
  db.bill_payments.push(payment)
  bill.next_due_date = advanceDueDate(bill.next_due_date, bill.frequency as BillFrequency)
  return payment.id
}

/** Like the pg_cron job: pays fixed standing orders that came due. Run on load. */
export function autoPayDueBills() {
  const today = todayISO()
  for (const bill of db.bills) {
    while (bill.active && bill.auto_create && bill.next_due_date <= today) {
      recordBillPayment(bill, Number(bill.amount), bill.paid_by_default, bill.next_due_date)
    }
  }
}

/** products.name_head: the normalized name without leading numbers. */
const productHead = (normalized: string) => normalized.replace(/^([0-9][0-9.]* )+/, '')

function productMatchScore(query: string, name: string): number {
  const q = normalize(query)
  const n = normalize(name)
  if (!q) return 0
  if (n.includes(q)) return 1
  const words = q.split(/\s+/)
  return words.filter((w) => n.includes(w)).length / words.length
}

const inviteCode = () => uuid().replace(/-/g, '').slice(0, 6).toUpperCase()

function rebalanceShares(householdId: string) {
  const all = members(householdId)
  for (const m of all) m.default_share_pct = Math.round((100 / all.length) * 100) / 100
}

// --- Admin (20261021000300_admin.sql) ---------------------------------------

const isAdmin = () => db.app_admins.some((a) => a.user_id === currentUserId())

function requireAdmin() {
  if (!isAdmin()) throw new Error('admin only')
}

const myEmail = () => normalize(String(db.auth_users.find((u) => u.id === currentUserId())?.email ?? ''))

/** move_member_refs(): the one list of columns that name a household member. */
const MEMBER_COLUMNS: [table: string, column: string][] = [
  ['expenses', 'paid_by'],
  ['expense_shares', 'user_id'],
  ['settlements', 'from_user'],
  ['settlements', 'to_user'],
  ['bills', 'paid_by_default'],
  ['bill_payments', 'paid_by'],
  ['chores', 'assignee_id'],
  ['chore_completions', 'done_by'],
  ['venues', 'created_by'],
  ['venue_deals', 'created_by'],
  ['venue_deals', 'reviewed_by'],
]

function moveMemberRefs(householdId: string, from: string, to: string) {
  for (const [table, column] of MEMBER_COLUMNS) {
    for (const row of db[table] ?? []) if (row.household_id === householdId && row[column] === from) row[column] = to
  }
}

/** detach_member(): a placeholder keeps the history, a member without any is removed. */
function detachMember(householdId: string, userId: string) {
  const member = db.household_members.find((m) => m.household_id === householdId && m.user_id === userId)
  if (!member) throw new Error('not found')
  const named = (table: string, ...columns: string[]) =>
    db[table].some((r) => r.household_id === householdId && columns.some((c) => r[c] === userId))
  const hasHistory =
    named('expenses', 'paid_by') ||
    named('expense_shares', 'user_id') ||
    named('settlements', 'from_user', 'to_user') ||
    named('bill_payments', 'paid_by') ||
    named('chore_completions', 'done_by')
  if (hasHistory) {
    if (member.is_placeholder) throw new Error('placeholder has history')
    const placeholder = uuid()
    Object.assign(member, { user_id: placeholder, is_placeholder: true })
    moveMemberRefs(householdId, userId, placeholder)
  } else {
    db.household_members = db.household_members.filter((m) => m !== member)
    for (const b of db.bills) {
      if (b.household_id === householdId && b.paid_by_default === userId) Object.assign(b, { paid_by_default: null, auto_create: false })
    }
    for (const c of db.chores) if (c.household_id === householdId && c.assignee_id === userId) c.assignee_id = null
    rebalanceShares(householdId)
  }
  const household = db.households.find((h) => h.id === householdId)
  if (household) household.invite_code = inviteCode()
}

/** Deleting an auth.users row: the trigger detaches it, then the FKs set null. */
function deleteAuthUser(userId: string) {
  for (const m of db.household_members.filter((x) => x.user_id === userId)) detachMember(m.household_id, userId)
  db.auth_users = db.auth_users.filter((u) => u.id !== userId)
  db.app_admins = db.app_admins.filter((a) => a.user_id !== userId)
  const setNull: [string, string][] = [
    ['list_items', 'added_by'], ['list_items', 'checked_by'], ['shopping_trips', 'created_by'],
    ['expenses', 'created_by'], ['settlements', 'created_by'],
  ]
  for (const [table, column] of setNull) for (const row of db[table]) if (row[column] === userId) row[column] = null
}

const count = (table: string, householdId: string) => db[table].filter((r) => r.household_id === householdId).length

// --- Going out (20261101000100_going_out.sql) -------------------------------

// A browser that saved its demo before these tables existed may not have them.
const venues = () => db.venues ?? []
const venueDeals = () => db.venue_deals ?? []

const isMember = (householdId: string | null) =>
  householdId != null && members(householdId).some((m) => m.user_id === currentUserId())

/** Haversine, in metres. */
function metresBetween(a: Row, b: Row): number {
  const rad = (deg: number) => (deg * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h))
}

/** An approved place a suggested one may repeat: the same normalized name, else the nearest within 50 m. */
function similarVenue(venue: Row): Row | null {
  const approved = venues().filter((v) => v.id !== venue.id && v.status === 'approved' && !v.hidden)
  const name = normName(String(venue.name))
  const sameName = approved.find((v) => normName(String(v.name)) === name)
  if (sameName) return sameName
  if (venue.lat == null || venue.lng == null) return null
  return (
    approved
      .filter((v) => v.lat != null && v.lng != null)
      .map((v) => ({ v, metres: metresBetween(venue, v) }))
      .filter((x) => x.metres <= 50)
      .sort((a, b) => a.metres - b.metres)[0]?.v ?? null
  )
}

// Postgres rejects these rows with the tables' check constraints.
function checkVenue(v: Row) {
  if ((v.household_id == null) !== (v.status === 'approved')) throw new Error('new row for relation "venues" violates check constraint')
}

function checkDeal(d: Row) {
  if (d.household_id == null && d.status !== 'approved') throw new Error('new row for relation "venue_deals" violates check constraint')
}

const VENUE_KINDS = ['bar', 'pub', 'restaurant', 'cafe', 'nightclub', 'other']
const DEAL_KINDS = ['happy_hour', 'special_day', 'event']
const minutes = (t: unknown) => (t == null ? null : Number(String(t).slice(0, 2)) * 60 + Number(String(t).slice(3, 5)))

/** The tables' check constraints on what an admin edit may write. */
function checkDealContent(d: Row) {
  const title = String(d.title ?? '')
  const ok =
    title.length >= 2 && title.length <= 60 && DEAL_KINDS.includes(d.kind) &&
    (d.weekdays ?? []).every((w: number) => Number.isInteger(w) && w >= 0 && w <= 6) &&
    (d.starts_at == null || d.ends_at == null || minutes(d.starts_at) !== minutes(d.ends_at)) &&
    (d.valid_from == null || d.valid_until == null || d.valid_until >= d.valid_from) &&
    (d.note == null || String(d.note).length <= 200)
  if (!ok) throw new Error('new row for relation "venue_deals" violates check constraint')
}

function checkVenueContent(v: Row) {
  const ok = String(v.name ?? '').trim() !== '' && VENUE_KINDS.includes(v.kind) && (v.lat == null) === (v.lng == null)
  if (!ok) throw new Error('new row for relation "venues" violates check constraint')
}

/** One admin_list_suggestions() row, in its column order. */
function suggestionRow(itemType: 'deal' | 'venue', venue: Row, deal: Row | null): Row {
  const similar = venue.status === 'pending' ? similarVenue(venue) : null
  const owner = deal ?? venue
  return {
    item_type: itemType, deal_id: deal?.id ?? null, venue_id: venue.id, venue_name: venue.name, venue_kind: venue.kind,
    venue_status: venue.status, venue_lat: venue.lat ?? null, venue_lng: venue.lng ?? null, venue_address: venue.address ?? null,
    title: deal?.title ?? null, deal_kind: deal?.kind ?? null, weekdays: deal ? (deal.weekdays ?? []) : null,
    starts_at: deal?.starts_at ?? null, ends_at: deal?.ends_at ?? null, valid_from: deal?.valid_from ?? null,
    valid_until: deal?.valid_until ?? null, note: deal?.note ?? null, household_id: owner.household_id,
    household_name: db.households.find((h) => h.id === owner.household_id)?.name ?? null,
    // venues has no created_at: a suggested place was last touched when it was added.
    created_at: deal ? deal.created_at : (venue.updated_at ?? venue.created_at),
    similar_venue_id: similar?.id ?? null, similar_venue_name: similar?.name ?? null,
    venue_opening_hours: venue.opening_hours ?? null, venue_website: venue.website ?? null,
    venue_phone: venue.phone ?? null, venue_instagram: venue.instagram ?? null,
  }
}

export const RPCS: Record<string, (args: Args) => unknown> = {
  create_household: ({ p_name, p_display_name }) => {
    const household = withDefaults('households', {
      name: str(p_name)?.trim() || 'הבית שלנו',
      invite_code: inviteCode(),
    })
    db.households.push(household)
    db.household_members.push({
      household_id: household.id, user_id: currentUserId(), display_name: str(p_display_name)?.trim(),
      color: '#0ea5e9', default_share_pct: 100, joined_at: new Date().toISOString(),
    })
    db.shopping_lists.push(withDefaults('shopping_lists', { household_id: household.id, name: 'קניות', is_default: true }))
    return household
  },

  join_household: ({ p_invite_code, p_display_name }) => {
    const household = db.households.find((h) => h.invite_code === str(p_invite_code)?.trim().toUpperCase())
    if (!household) throw new Error('invalid invite code')
    const me = currentUserId()
    if (members(household.id).some((m) => m.user_id === me)) return household
    // Take over the oldest placeholder, with everything recorded under it.
    const placeholder = members(household.id).find((m) => m.is_placeholder)
    if (placeholder) {
      const from = placeholder.user_id
      Object.assign(placeholder, {
        user_id: me, is_placeholder: false, display_name: str(p_display_name)?.trim() || placeholder.display_name,
        joined_at: new Date().toISOString(),
      })
      moveMemberRefs(household.id, from, me)
      return household
    }
    db.household_members.push({
      household_id: household.id, user_id: me, display_name: str(p_display_name)?.trim(),
      color: '#f43f5e', default_share_pct: 0, joined_at: new Date().toISOString(),
    })
    rebalanceShares(household.id)
    return household
  },

  add_placeholder_member: ({ p_household_id, p_display_name }) => {
    const householdId = String(p_household_id)
    requireMember(householdId)
    const name = str(p_display_name)?.trim()
    if (!name) throw new Error('name required')
    const member = {
      household_id: householdId, user_id: uuid(), display_name: name, color: '#f43f5e',
      default_share_pct: 0, joined_at: new Date().toISOString(), is_placeholder: true,
    }
    db.household_members.push(member)
    rebalanceShares(householdId)
    return member
  },

  regenerate_invite_code: ({ p_household_id }) => {
    requireMember(String(p_household_id))
    const household = db.households.find((h) => h.id === p_household_id)!
    household.invite_code = inviteCode()
    return household.invite_code
  },

  complete_trip: ({ p_list_id, p_store_id, p_store_name, p_total, p_trip_date }) => {
    const list = db.shopping_lists.find((l) => l.id === p_list_id)
    if (!list) throw new Error('list not found')
    requireMember(list.household_id)
    const trip = withDefaults('shopping_trips', {
      household_id: list.household_id, store_id: p_store_id ?? null, store_name: p_store_name ?? null,
      total: p_total ?? null, trip_date: p_trip_date ?? todayISO(), item_count: 0, created_by: currentUserId(),
    })
    db.shopping_trips.push(trip)
    const checked = db.list_items.filter((i) => i.list_id === p_list_id && i.checked)
    for (const item of checked) {
      db.purchases.push(
        withDefaults('purchases', {
          household_id: item.household_id, trip_id: trip.id, name: item.name, normalized_name: normalize(item.name),
          category: item.category, barcode: item.barcode, quantity: item.quantity, unit: item.unit,
          purchased_at: item.checked_at ?? new Date().toISOString(),
        }),
      )
    }
    db.list_items = db.list_items.filter((i) => !(i.list_id === p_list_id && i.checked))
    trip.item_count = checked.length
    return trip.id
  },

  save_expense: (a) => {
    const householdId = String(a.p_household_id)
    requireMember(householdId)
    const ids = new Set(members(householdId).map((m) => m.user_id))
    if (!ids.has(String(a.p_paid_by))) throw new Error('payer is not a member')
    const shares = a.p_shares as Record<string, number>
    if (Object.keys(shares).some((id) => !ids.has(id))) throw new Error('share for a non-member')
    const total = Object.values(shares).reduce((s, v) => s + toAgorot(Number(v)), 0)
    if (total !== toAgorot(Number(a.p_amount))) throw new Error('shares do not add up to amount')

    const fields = {
      household_id: householdId, description: String(a.p_description).trim(), amount: Number(a.p_amount),
      paid_by: a.p_paid_by, category: a.p_category ?? 'other', expense_date: a.p_expense_date ?? todayISO(),
      split_type: a.p_split_type ?? 'equal', note: a.p_note ?? null,
    }
    if (!a.p_id) {
      return insertExpense({ ...fields, source: a.p_source ?? 'manual', source_id: a.p_source_id ?? null }, shares)
    }
    const expense = db.expenses.find((e) => e.id === a.p_id && e.household_id === householdId)
    if (!expense) throw new Error('expense not found')
    Object.assign(expense, fields, { updated_at: new Date().toISOString() })
    db.expense_shares = db.expense_shares.filter((s) => s.expense_id !== expense.id)
    for (const [userId, amount] of Object.entries(shares)) {
      if (amount > 0) db.expense_shares.push({ expense_id: expense.id, household_id: householdId, user_id: userId, amount })
    }
    return expense.id
  },

  import_expenses: ({ p_household_id, p_expenses, p_settlements }) => {
    const householdId = String(p_household_id)
    requireMember(householdId)
    const ids = new Set(members(householdId).map((m) => m.user_id))
    const exists = (rows: Row[], key: unknown) => rows.some((r) => r.household_id === householdId && r.external_id === key)
    let expenses = 0
    let settlements = 0
    let skipped = 0
    // Validate everything first, so a bad row imports nothing (like the SQL transaction).
    for (const s of (p_settlements as Row[]) ?? []) {
      if (!ids.has(s.from_user) || !ids.has(s.to_user)) throw new Error('transfer between non-members')
    }
    for (const e of (p_expenses as Row[]) ?? []) {
      const total = Object.values(e.shares as Record<string, number>).reduce((sum, v) => sum + toAgorot(Number(v)), 0)
      if (total !== toAgorot(Number(e.amount))) throw new Error('shares do not add up to amount')
    }
    for (const e of (p_expenses as Row[]) ?? []) {
      if (exists(db.expenses, e.external_id)) {
        skipped++
        continue
      }
      const id = RPCS.save_expense({
        p_household_id: householdId, p_description: e.description, p_amount: e.amount, p_paid_by: e.paid_by,
        p_shares: e.shares, p_category: e.category, p_expense_date: e.date, p_split_type: e.split_type,
        p_source: 'import',
      }) as string
      db.expenses.find((x) => x.id === id)!.external_id = e.external_id
      expenses++
    }
    for (const s of (p_settlements as Row[]) ?? []) {
      if (exists(db.settlements, s.external_id)) {
        skipped++
        continue
      }
      db.settlements.push(
        withDefaults('settlements', {
          household_id: householdId, from_user: s.from_user, to_user: s.to_user, amount: Number(s.amount),
          settled_on: s.date, note: s.note?.trim() || null, external_id: s.external_id,
        }),
      )
      settlements++
    }
    return { expenses, settlements, skipped }
  },

  pay_bill: ({ p_bill_id, p_amount, p_paid_by, p_paid_on }) => {
    const bill = db.bills.find((b) => b.id === p_bill_id)
    if (!bill) throw new Error('bill not found')
    requireMember(bill.household_id)
    const amount = Number(p_amount ?? bill.amount)
    if (!(amount > 0)) throw new Error('amount is required')
    const paidBy = str(p_paid_by) ?? bill.paid_by_default ?? currentUserId()
    return recordBillPayment(bill, amount, paidBy, str(p_paid_on) ?? todayISO())
  },

  skip_bill: ({ p_bill_id }) => {
    const bill = db.bills.find((b) => b.id === p_bill_id)
    if (!bill) throw new Error('bill not found')
    bill.next_due_date = advanceDueDate(bill.next_due_date, bill.frequency)
    return bill.next_due_date
  },

  // match_candidates(): tiers by name, exclusions, then the cheapest product
  // per item, store and pack size (see 20261021000100_basket_matching.sql).
  match_candidates: ({ p_items }) => {
    const activeStores = new Set(db.stores.filter((s) => s.active).map((s) => s.id))
    const result: Row[] = []
    for (const req of (p_items ?? []) as Row[]) {
      const terms = ((req.terms ?? []) as string[]).map(normName).filter(Boolean)
      const exclude = ((req.exclude ?? []) as string[]).map(normName)
      const require = ((req.require ?? []) as string[]).map(normName)
      const tiers = new Map<string, number>()
      for (const p of db.products) {
        const name = normName(String(p.name))
        const head = productHead(name)
        if (exclude.some((x) => hasWords(name, x))) continue
        if (require.length && !require.some((r) => hasWords(name, r))) continue
        if (req.weighted != null && p.is_weighted !== req.weighted) continue
        for (const t of terms) {
          if (!t.split(' ').every((w) => hasWords(name, w))) continue
          const tier = head === t || head.startsWith(`${t} `) || head.split(' ')[0] === t.split(' ')[0] ? 1 : 2
          tiers.set(String(p.barcode), Math.min(tier, tiers.get(String(p.barcode)) ?? 9))
        }
      }
      const bestTier = Math.min(...tiers.values())
      const chosen = [...tiers].filter(([, tier]) => tier === bestTier)
      if (req.barcode) chosen.push([String(req.barcode), 0])
      const cheapest = new Map<string, Row>()
      for (const [barcode, tier] of chosen) {
        const product = db.products.find((p) => p.barcode === barcode)
        if (!product) continue
        for (const price of db.prices.filter((x) => x.barcode === barcode && activeStores.has(x.store_id))) {
          const key = [tier === 0, price.store_id, product.pack_unit, product.pack_qty, product.is_weighted].join('|')
          const current = cheapest.get(key)
          if (current && Number(current.price) <= Number(price.price)) continue
          cheapest.set(key, {
            item_id: req.id, tier, store_id: price.store_id, barcode, product_name: product.name,
            price: Number(price.price), pack_unit: product.pack_unit ?? null, pack_qty: product.pack_qty ?? null,
            is_weighted: product.is_weighted,
          })
        }
      }
      result.push(...cheapest.values())
    }
    return result
  },

  search_products: ({ p_query, p_limit }) => {
    const raw = String(p_query ?? '').trim()
    const q = normName(raw)
    if (!q) return []
    return db.products
      .map((p) => {
        const name = normName(String(p.name))
        const head = productHead(name)
        const words = q.split(' ').every((w) => hasWords(name, w))
        const tier = p.barcode === raw ? 0 : words ? (head.split(' ')[0] === q.split(' ')[0] ? 1 : 2) : productMatchScore(q, name) >= 0.6 ? 3 : 9
        const prices = db.prices.filter((x) => x.barcode === p.barcode).map((x) => Number(x.price))
        return {
          tier,
          barcode: p.barcode, name: p.name, manufacturer: p.manufacturer,
          pack_unit: p.pack_unit ?? null, pack_qty: p.pack_qty ?? null, is_weighted: p.is_weighted,
          min_price: prices.length ? Math.min(...prices) : null,
          max_price: prices.length ? Math.max(...prices) : null,
          store_count: prices.length,
        }
      })
      .filter((x) => x.tier < 9)
      .sort((a, b) => a.tier - b.tier || b.store_count - a.store_count || String(a.name).localeCompare(String(b.name)))
      .slice(0, Number(p_limit ?? 25))
      .map(({ tier: _tier, ...rest }) => rest)
  },

  recent_price_changes: ({ p_household_id, p_days }) => {
    const householdId = String(p_household_id)
    if (!members(householdId).some((m) => m.user_id === currentUserId())) return []
    const since = addDays(todayISO(), -Number(p_days ?? 30))
    const bought = new Map(
      VIEWS.frequent_items()
        .filter((f) => f.household_id === householdId && f.barcode)
        .map((f) => [f.barcode, f.times_bought]),
    )
    const latest = new Map<string, Row>()
    for (const h of db.price_history) {
      if (!bought.has(h.barcode) || h.changed_on < since) continue
      const key = `${h.barcode}|${h.store_id}`
      if (!latest.has(key) || latest.get(key)!.changed_on < h.changed_on) latest.set(key, h)
    }
    return [...latest.values()].map((h) => ({
      ...h,
      product_name: db.products.find((p) => p.barcode === h.barcode)?.name ?? '',
      times_bought: bought.get(h.barcode),
    }))
  },

  // "עדיין בתוקף?": any member who can see the deal (RLS), at most once per 12 hours.
  confirm_deal: ({ p_id }) => {
    const deal = venueDeals().find((d) => d.id === p_id)
    if (!deal || (deal.status !== 'approved' && !isMember(deal.household_id))) throw new Error('not found')
    const now = Date.now()
    const last = deal.last_confirmed_at ? Date.parse(deal.last_confirmed_at) : 0
    if (now - last >= 12 * 3_600_000) deal.last_confirmed_at = new Date(now).toISOString()
    return null
  },

  is_admin: () => isAdmin(),

  // No push in the demo: the card says so, and the test button only "sends".
  send_test_notification: () => null,

  admin_list_allowed_emails: () => {
    requireAdmin()
    return [...db.allowed_emails].sort((a, b) => String(a.email).localeCompare(String(b.email)))
  },

  admin_add_allowed_email: ({ p_email, p_note }) => {
    requireAdmin()
    const email = normalize(String(p_email ?? ''))
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('invalid email')
    const note = str(p_note)?.trim() || null
    const mine = myEmail()
    if (db.allowed_emails.length === 0 && mine && mine !== email) {
      db.allowed_emails.push({ email: mine, note: null, added_at: new Date().toISOString() })
    }
    const existing = db.allowed_emails.find((e) => e.email === email)
    if (existing) {
      existing.note = note ?? existing.note
      return existing
    }
    const row = { email, note, added_at: new Date().toISOString() }
    db.allowed_emails.push(row)
    return row
  },

  admin_remove_allowed_email: ({ p_email }) => {
    requireAdmin()
    const email = normalize(String(p_email ?? ''))
    if (email === myEmail()) throw new Error('cannot remove your own email')
    if (!db.allowed_emails.some((e) => e.email === email)) throw new Error('not found')
    if (db.allowed_emails.length === 1) throw new Error('allowlist cannot be empty')
    db.allowed_emails = db.allowed_emails.filter((e) => e.email !== email)
    return null
  },

  admin_list_households: () => {
    requireAdmin()
    return [...db.households]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((h) => ({
        id: h.id, name: h.name, created_at: h.created_at,
        members: members(h.id).map((m) => ({
          user_id: m.user_id, display_name: m.display_name, is_placeholder: Boolean(m.is_placeholder),
          email: db.auth_users.find((u) => u.id === m.user_id)?.email ?? null,
        })),
        expense_count: count('expenses', h.id), bill_count: count('bills', h.id),
        chore_count: count('chores', h.id), list_item_count: count('list_items', h.id),
      }))
  },

  admin_delete_household: ({ p_household_id }) => {
    requireAdmin()
    const householdId = String(p_household_id)
    if (members(householdId).some((m) => m.user_id === currentUserId())) throw new Error('cannot delete your own household')
    if (!db.households.some((h) => h.id === householdId)) throw new Error('not found')
    // The before-delete trigger: approved deals belong to everyone, so they stay.
    for (const d of venueDeals()) if (d.household_id === householdId && d.status === 'approved') d.household_id = null
    // venues.suggested_household_id: on delete set null.
    for (const v of venues()) if (v.suggested_household_id === householdId) v.suggested_household_id = null
    // on delete cascade: every row that belongs to the household goes with it.
    db.households = db.households.filter((h) => h.id !== householdId)
    for (const table of Object.keys(db)) db[table] = db[table].filter((r) => r.household_id !== householdId)
    return null
  },

  admin_remove_member: ({ p_household_id, p_user_id }) => {
    requireAdmin()
    if (p_user_id === currentUserId()) throw new Error('cannot remove yourself')
    detachMember(String(p_household_id), String(p_user_id))
    return null
  },

  admin_list_users: () => {
    requireAdmin()
    const allowed = new Set(db.allowed_emails.map((e) => e.email))
    return [...db.auth_users]
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
      .map((u) => ({
        id: u.id, email: u.email, full_name: u.raw_user_meta_data?.full_name ?? null, created_at: u.created_at,
        last_sign_in_at: u.last_sign_in_at ?? null, is_admin: db.app_admins.some((a) => a.user_id === u.id),
        on_allowlist: allowed.has(normalize(String(u.email ?? ''))),
        household_names: db.household_members
          .filter((m) => m.user_id === u.id)
          .map((m) => db.households.find((h) => h.id === m.household_id)?.name)
          .filter(Boolean)
          .sort(),
      }))
  },

  admin_delete_user: ({ p_user_id }) => {
    requireAdmin()
    const userId = String(p_user_id)
    if (userId === currentUserId()) throw new Error('cannot delete your own account')
    if (db.app_admins.some((a) => a.user_id === userId)) throw new Error('cannot delete an admin')
    if (!db.auth_users.some((u) => u.id === userId)) throw new Error('not found')
    deleteAuthUser(userId)
    return null
  },

  // Pending deals and suggested places, oldest first; a place before its deals.
  admin_list_suggestions: () => {
    requireAdmin()
    const deals = venueDeals()
      .filter((d) => d.status === 'pending')
      .flatMap((d) => {
        const venue = venues().find((v) => v.id === d.venue_id)
        return venue ? [suggestionRow('deal', venue, d)] : []
      })
    const places = venues()
      .filter((v) => v.status === 'pending')
      .map((v) => suggestionRow('venue', v, null))
    return [...places, ...deals].sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))
  },

  admin_review_deal: ({ p_id, p_approve, p_note }) => {
    requireAdmin()
    const deal = venueDeals().find((d) => d.id === p_id)
    if (!deal) throw new Error('not found')
    const approve = Boolean(p_approve)
    if (approve && venues().find((v) => v.id === deal.venue_id)?.status !== 'approved') throw new Error('venue not approved')
    const next = {
      status: approve ? 'approved' : 'rejected', reviewed_by: currentUserId(), reviewed_at: new Date().toISOString(),
      review_note: str(p_note)?.trim() || null,
    }
    checkDeal({ ...deal, ...next })
    Object.assign(deal, next)
    return null
  },

  admin_review_venue: ({ p_id, p_approve, p_note }) => {
    requireAdmin()
    const venue = venues().find((v) => v.id === Number(p_id))
    if (!venue) throw new Error('not found')
    const note = str(p_note)?.trim() || null
    const next = p_approve
      ? { household_id: null, status: 'approved', review_note: note }
      : { status: 'rejected', review_note: note }
    checkVenue({ ...venue, ...next })
    Object.assign(venue, next, { updated_at: new Date().toISOString() })
    return null
  },

  // A suggested place that repeats an approved one: its deals move over, and it goes.
  admin_merge_venue: ({ p_from, p_into }) => {
    requireAdmin()
    const from = venues().find((v) => v.id === Number(p_from) && v.status !== 'approved')
    const into = venues().find((v) => v.id === Number(p_into))
    if (!from || !into) throw new Error('not found')
    if (into.status !== 'approved') throw new Error('venue not approved')
    for (const d of venueDeals()) if (d.venue_id === from.id) d.venue_id = into.id
    // Its stars move too; a household that starred both keeps one.
    const starred = new Set(db.venue_favorites.filter((f) => f.venue_id === into.id).map((f) => f.household_id))
    db.venue_favorites = db.venue_favorites.flatMap((f) => {
      if (f.venue_id !== from.id) return [f]
      if (starred.has(f.household_id)) return []
      starred.add(f.household_id)
      return [{ ...f, venue_id: into.id }]
    })
    db.venues = venues().filter((v) => v !== from)
    return null
  },

  // An admin's edit of any deal, in any status; the status stays as it is.
  admin_update_deal: ({ p_id, p_title, p_kind, p_weekdays, p_starts_at, p_ends_at, p_valid_from, p_valid_until, p_note }) => {
    requireAdmin()
    const deal = venueDeals().find((d) => d.id === p_id)
    if (!deal) throw new Error('not found')
    const next = {
      title: str(p_title)?.trim() ?? '', kind: p_kind, weekdays: [...((p_weekdays as number[] | null) ?? [])],
      starts_at: str(p_starts_at), ends_at: str(p_ends_at), valid_from: str(p_valid_from), valid_until: str(p_valid_until),
      note: str(p_note)?.trim() || null,
    }
    checkDealContent({ ...deal, ...next })
    Object.assign(deal, next)
    return null
  },

  // Any place, in any status; marked, so the weekly ingest keeps the admin's details.
  admin_update_venue: ({ p_id, p_name, p_kind, p_address, p_opening_hours, p_website, p_phone, p_instagram, p_lat, p_lng }) => {
    requireAdmin()
    const venue = venues().find((v) => v.id === Number(p_id))
    if (!venue) throw new Error('not found')
    const text = (v: unknown) => str(v)?.trim() || null
    const next = {
      name: str(p_name)?.trim() ?? '', kind: p_kind, address: text(p_address), opening_hours: text(p_opening_hours),
      website: text(p_website), phone: text(p_phone), instagram: text(p_instagram),
      lat: p_lat == null ? null : Number(p_lat), lng: p_lng == null ? null : Number(p_lng),
    }
    checkVenueContent({ ...venue, ...next })
    const now = new Date().toISOString()
    Object.assign(venue, next, { admin_edited_at: now, updated_at: now })
    return null
  },

  admin_delete_deal: ({ p_id }) => {
    requireAdmin()
    if (!venueDeals().some((d) => d.id === p_id)) throw new Error('not found')
    db.venue_deals = venueDeals().filter((d) => d.id !== p_id)
    return null
  },

  // Out of every list (and back); hidden_by_admin keeps the ingest from showing it again.
  admin_hide_venue: ({ p_id, p_hidden }) => {
    requireAdmin()
    const venue = venues().find((v) => v.id === Number(p_id))
    if (!venue) throw new Error('not found')
    const hidden = Boolean(p_hidden)
    Object.assign(venue, { hidden, hidden_by_admin: hidden, updated_at: new Date().toISOString() })
    return null
  },
}
