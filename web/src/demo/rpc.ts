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

export const RPCS: Record<string, (args: Args) => unknown> = {
  create_household: ({ p_name, p_display_name }) => {
    const household = withDefaults('households', {
      name: str(p_name)?.trim() || 'הבית שלנו',
      invite_code: uuid().replace(/-/g, '').slice(0, 6).toUpperCase(),
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
    if (!members(household.id).some((m) => m.user_id === currentUserId())) {
      db.household_members.push({
        household_id: household.id, user_id: currentUserId(), display_name: str(p_display_name)?.trim(),
        color: '#f43f5e', default_share_pct: 0, joined_at: new Date().toISOString(),
      })
      const all = members(household.id)
      for (const m of all) m.default_share_pct = Math.round((100 / all.length) * 100) / 100
    }
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
    const all = members(householdId)
    for (const m of all) m.default_share_pct = Math.round((100 / all.length) * 100) / 100
    return member
  },

  regenerate_invite_code: ({ p_household_id }) => {
    requireMember(String(p_household_id))
    const household = db.households.find((h) => h.id === p_household_id)!
    household.invite_code = uuid().replace(/-/g, '').slice(0, 6).toUpperCase()
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
}
