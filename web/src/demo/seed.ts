// Sample data for the demo build: a couple in Be'er Sheva with half a year of
// history. Dates are relative to the day the demo is first opened.
import { addDays, addMonths, startOfMonth, todayISO } from '@/lib/dates'
import type { Db, Row } from './store'

export const MICHAEL = '11111111-1111-4111-8111-111111111111'
export const YAHALI = '22222222-2222-4222-8222-222222222222'
/** A third account, in another household; only the admin screen shows it. */
export const TAL = '33333333-3333-4333-8333-333333333333'
export const HOUSEHOLD = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
export const TEST_HOUSEHOLD = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const LIST = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const TEST_LIST = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

/** Whose phone the demo banner can switch to. מיכאל is an admin, יהלי is not. */
export const DEMO_USERS = [
  { id: MICHAEL, email: 'michael@demo', name: 'מיכאל' },
  { id: YAHALI, email: 'yahali@demo', name: 'יהלי' },
]

let counter = 0
const id = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`
const at = (date: string, time = '12:00') => new Date(`${date}T${time}:00`).toISOString()

export function createSeed(now: Date = new Date()): Db {
  counter = 0
  const today = todayISO(now)
  const monthStart = startOfMonth(today)
  const daysAgo = (n: number) => addDays(today, -n)
  const thisMonth = (day: number) => {
    const d = addDays(monthStart, day - 1)
    return d > today ? today : d
  }

  const db: Db = {
    households: [
      { id: HOUSEHOLD, name: 'הבית שלנו', invite_code: 'K7M2QX', created_at: at(daysAgo(200)) },
      // Someone who tried the app; the admin screen can remove it.
      { id: TEST_HOUSEHOLD, name: 'דירת ניסיון', invite_code: 'T3ST9P', created_at: at(daysAgo(12)) },
    ],
    household_members: [
      { household_id: HOUSEHOLD, user_id: MICHAEL, display_name: 'מיכאל', color: '#0ea5e9', default_share_pct: 50, joined_at: at(daysAgo(200)) },
      { household_id: HOUSEHOLD, user_id: YAHALI, display_name: 'יהלי', color: '#f43f5e', default_share_pct: 50, joined_at: at(daysAgo(199)) },
      { household_id: TEST_HOUSEHOLD, user_id: TAL, display_name: 'טל', color: '#8b5cf6', default_share_pct: 100, joined_at: at(daysAgo(12)) },
    ],
    shopping_lists: [
      { id: LIST, household_id: HOUSEHOLD, name: 'קניות', is_default: true, created_at: at(daysAgo(200)) },
      { id: TEST_LIST, household_id: TEST_HOUSEHOLD, name: 'קניות', is_default: true, created_at: at(daysAgo(12)) },
    ],
    list_items: [],
    shopping_trips: [],
    purchases: [],
    expenses: [],
    expense_shares: [],
    settlements: [],
    bills: [],
    bill_payments: [],
    chores: [],
    chore_completions: [],
    chains: [
      { id: 'shufersal', name: 'שופרסל', chain_code: '7290027600007' },
      { id: 'rami_levy', name: 'רמי לוי', chain_code: '7290058140886' },
      { id: 'osher_ad', name: 'אושר עד', chain_code: '7290103152017' },
      { id: 'carrefour', name: 'קרפור', chain_code: '7290055700007' },
      { id: 'tiv_taam', name: 'טיב טעם', chain_code: '7290873255550' },
    ],
    stores: [],
    products: [],
    prices: [],
    price_history: [],
    ingest_runs: [],
    product_links: [],
    // Departments the household chose by hand: cookies live with the snacks.
    item_categories: [
      { household_id: HOUSEHOLD, normalized_name: 'עוגיות', category: 'pantry', updated_at: at(daysAgo(20)) },
    ],
    // "לאן יוצאים" (20261101000100_going_out.sql), filled in below.
    venues: [],
    venue_deals: [],
    // Starred by the household (20261102000100_venue_favorites.sql).
    venue_favorites: [],
    // Stand-ins for auth.users and the admin tables (20261021000300_admin.sql).
    auth_users: [
      { id: MICHAEL, email: 'michael@demo', raw_user_meta_data: { full_name: 'מיכאל' }, created_at: at(daysAgo(200)), last_sign_in_at: at(today, '08:05') },
      { id: YAHALI, email: 'yahali@demo', raw_user_meta_data: { full_name: 'יהלי' }, created_at: at(daysAgo(199)), last_sign_in_at: at(daysAgo(1), '21:40') },
      { id: TAL, email: 'tal@demo', raw_user_meta_data: { full_name: 'טל' }, created_at: at(daysAgo(12)), last_sign_in_at: at(daysAgo(12), '19:02') },
    ],
    app_admins: [{ user_id: MICHAEL, added_at: at(daysAgo(200)) }],
    // Notifications (20261022000100_notifications.sql). Push itself does not
    // work in the demo; the choices are kept like any other table.
    notification_prefs: [],
    push_subscriptions: [],
    // Added after טל signed up, so that account is not on the list.
    allowed_emails: [
      { email: 'michael@demo', note: null, added_at: at(daysAgo(5)) },
      { email: 'yahali@demo', note: 'יהלי', added_at: at(daysAgo(5)) },
    ],
  }

  // Shopping list
  const items: [string, number, string, string, boolean, string | null][] = [
    ['חלב', 2, 'dairy', MICHAEL, false, '7290000000001'],
    ['קוטג׳', 1, 'dairy', YAHALI, false, null],
    ['עגבניות', 1.5, 'produce', YAHALI, false, null],
    ['מלפפונים', 1, 'produce', MICHAEL, false, null],
    ['לחם אחיד', 1, 'bakery', MICHAEL, false, '7290000000020'],
    ['חזה עוף', 1, 'meat', YAHALI, false, null],
    ['סבון כלים', 1, 'cleaning', MICHAEL, false, null],
    ['אוכל לחתולים', 1, 'other', MICHAEL, false, null],
    ['פסטה', 3, 'pantry', YAHALI, false, null],
    ['ביצים', 1, 'dairy', YAHALI, false, null],
    ['במבה', 2, 'pantry', YAHALI, true, null],
  ]
  items.forEach(([name, quantity, category, by, checked, barcode], i) => {
    const created = new Date(now.getTime() - (items.length - i) * 60_000).toISOString()
    db.list_items.push({
      id: id(), list_id: LIST, household_id: HOUSEHOLD, name, quantity, unit: null, category, note: null, barcode,
      checked, checked_by: checked ? by : null, checked_at: checked ? created : null, added_by: by,
      created_at: created, updated_at: created,
    })
  })

  // Purchase history: things bought regularly
  const history: [string, string, number][] = [
    ['שמן זית', 'pantry', 60], ['שמן זית', 'pantry', 40], ['שמן זית', 'pantry', 21],
    ['קפה', 'pantry', 45], ['קפה', 'pantry', 30], ['קפה', 'pantry', 16],
    ['חלב', 'dairy', 9], ['חלב', 'dairy', 5], ['חלב', 'dairy', 2],
    ['בננות', 'produce', 12], ['בננות', 'produce', 6], ['אבוקדו', 'produce', 7],
    ['נייר טואלט', 'cleaning', 30], ['יוגורט', 'dairy', 4], ['יוגורט', 'dairy', 11],
    ['במבה', 'pantry', 8], ['פיתות', 'bakery', 3], ['גבינה צהובה', 'dairy', 10],
  ]
  for (const [name, category, ago] of history) {
    db.purchases.push({
      id: id(), household_id: HOUSEHOLD, trip_id: null, name, normalized_name: name, category,
      barcode: name === 'חלב' ? '7290000000001' : null, quantity: 1, unit: null, purchased_at: at(daysAgo(ago)),
    })
  }

  // Expenses: six months back plus this month
  const addExpense = (description: string, amount: number, paidBy: string, category: string, date: string, source = 'manual') => {
    const expenseId = id()
    const half = Math.floor(amount * 50) / 100
    const other = paidBy === MICHAEL ? YAHALI : MICHAEL
    db.expenses.push({
      id: expenseId, household_id: HOUSEHOLD, description, amount, paid_by: paidBy, category, expense_date: date,
      split_type: 'equal', note: null, source, source_id: null, created_by: paidBy, created_at: at(date), updated_at: at(date),
    })
    db.expense_shares.push(
      { expense_id: expenseId, household_id: HOUSEHOLD, user_id: paidBy, amount: Math.round((amount - half) * 100) / 100 },
      { expense_id: expenseId, household_id: HOUSEHOLD, user_id: other, amount: half },
    )
  }
  for (let m = 6; m >= 1; m--) {
    const start = addMonths(monthStart, -m)
    addExpense('שכירות', 4800, MICHAEL, 'rent', addDays(start, 0), 'bill')
    addExpense('קניות ברמי לוי', 480 + m * 23, MICHAEL, 'groceries', addDays(start, 2), 'trip')
    addExpense('דלק', 280, YAHALI, 'transport', addDays(start, 4))
    addExpense('מסעדה', 210 + m * 11, YAHALI, 'eating_out', addDays(start, 9))
    addExpense('קניות בשופרסל', 390 + m * 17, YAHALI, 'groceries', addDays(start, 12), 'trip')
    addExpense('ארנונה', 600 + (m % 2) * 25, YAHALI, 'bills', addDays(start, 15), 'bill')
    db.settlements.push({
      id: id(), household_id: HOUSEHOLD, from_user: YAHALI, to_user: MICHAEL, amount: 1900, settled_on: addDays(start, 20),
      note: 'ביט', created_by: YAHALI, created_at: at(addDays(start, 20)),
    })
  }
  addExpense('שכירות', 4800, MICHAEL, 'rent', thisMonth(1), 'bill')
  addExpense('קניות ברמי לוי', 612.4, MICHAEL, 'groceries', thisMonth(3), 'trip')
  addExpense('סושי', 286, YAHALI, 'eating_out', thisMonth(5))
  addExpense('פיצה', 118, MICHAEL, 'eating_out', thisMonth(7))
  addExpense('בורגר', 236, YAHALI, 'eating_out', thisMonth(9))
  addExpense('מתנה ליום הולדת', 250, YAHALI, 'gifts', daysAgo(1))
  addExpense('קניות בשופרסל', 344.9, YAHALI, 'groceries', daysAgo(2), 'trip')
  db.settlements.push({
    id: id(), household_id: HOUSEHOLD, from_user: YAHALI, to_user: MICHAEL, amount: 2000, settled_on: thisMonth(2),
    note: 'ביט', created_by: YAHALI, created_at: at(thisMonth(2)),
  })

  // Bills
  const bill = (name: string, icon: string, category: string, amountType: string, amount: number, frequency: string, due: string, paidBy: string, auto = false): Row => ({
    id: id(), household_id: HOUSEHOLD, name, provider: null, category, icon, amount_type: amountType, amount, frequency,
    next_due_date: due, paid_by_default: paidBy, auto_create: auto, active: true, notes: null,
    created_at: at(daysAgo(200)), updated_at: at(daysAgo(200)),
  })
  const electricity = bill('חשמל', '💡', 'bills', 'variable', 450, 'bimonthly', addDays(today, 4), YAHALI)
  db.bills.push(
    bill('שכירות', '🏠', 'rent', 'fixed', 4800, 'monthly', addMonths(monthStart, 1), MICHAEL, true),
    bill('ארנונה', '🏛️', 'bills', 'variable', 620, 'bimonthly', daysAgo(2), YAHALI),
    electricity,
    bill('אינטרנט', '🌐', 'bills', 'fixed', 99, 'monthly', addDays(today, 9), YAHALI),
    bill('נטפליקס', '🎬', 'fun', 'fixed', 69.9, 'monthly', addDays(today, 21), MICHAEL),
  )
  for (const [ago, amount] of [[60, 610], [120, 420], [180, 395], [240, 430]] as const) {
    db.bill_payments.push({
      id: id(), bill_id: electricity.id, household_id: HOUSEHOLD, due_date: daysAgo(ago), amount,
      paid_on: daysAgo(ago), paid_by: YAHALI, expense_id: null, created_at: at(daysAgo(ago)),
    })
  }

  // Chores
  const chore = (title: string, emoji: string, recurrence: string, extra: Row, assignment: string, assignee: string | null, due: string): Row => ({
    id: id(), household_id: HOUSEHOLD, title, emoji, recurrence, interval_days: null, weekdays: null, ...extra,
    assignment, assignee_id: assignee, next_due: due, active: true, created_at: at(daysAgo(100)), updated_at: at(daysAgo(100)),
  })
  const dishwasher = chore('לרוקן מדיח', '🍽️', 'daily', {}, 'anyone', null, today)
  db.chores.push(
    chore('להוציא זבל', '🗑️', 'every_n_days', { interval_days: 2 }, 'rotate', MICHAEL, today),
    chore('כביסה', '🧺', 'weekly', { weekdays: [0, 3] }, 'rotate', YAHALI, daysAgo(1)),
    dishwasher,
    chore('שטיפת רצפה', '🧹', 'weekly', { weekdays: [5] }, 'fixed', MICHAEL, addDays(today, 3)),
    chore('ניקוי פילטר מזגן', '❄️', 'every_n_days', { interval_days: 60 }, 'fixed', YAHALI, addDays(today, 25)),
  )
  for (let g = 1; g <= 12; g++) {
    db.chore_completions.push({
      id: id(), chore_id: dishwasher.id, household_id: HOUSEHOLD, done_by: g % 4 === 0 ? MICHAEL : YAHALI,
      done_on: daysAgo(g), created_at: at(daysAgo(g)),
    })
  }

  // Supermarkets in Be'er Sheva and their prices: two branches for some
  // chains, and look-alike products (egg salad, chocolate milk, canned
  // tomatoes) so the comparison has something to tell apart.
  const stores: [number, string, string, string][] = [
    [1, 'rami_levy', '39', 'רמי לוי באר שבע'],
    [6, 'rami_levy', '41', 'רמי לוי ביג באר שבע'],
    [2, 'shufersal', '413', 'שופרסל דיל עמק שרה'],
    [7, 'shufersal', '277', 'שופרסל אקספרס באר שבע'],
    [3, 'osher_ad', '22', 'אושר עד באר שבע'],
    [4, 'carrefour', '480', 'קרפור באר שבע'],
    [5, 'tiv_taam', '12', 'טיב טעם באר שבע'],
  ]
  for (const [storeId, chain, code, name] of stores) {
    db.stores.push({ id: storeId, chain_id: chain, store_code: code, name, city: 'באר שבע', address: null, active: true, last_ingested_at: at(today, '06:20') })
  }
  // barcode, name, manufacturer, pack (unit, qty) or 'kg' for weighted
  const products: [string, string, string | null, [string, number] | 'kg'][] = [
    ['7290000000001', 'חלב תנובה 3% 1 ליטר', 'תנובה', ['ml', 1000]],
    ['7290000000002', 'חלב טרי מהגולן 3% בקרטון 1 ליטר', 'רמת הגולן', ['ml', 1000]],
    ['7290000000003', 'חלב תנובה 3% 2 ליטר', 'תנובה', ['ml', 2000]],
    ['7290000000004', 'שוקולד חלב 100 גרם', 'עלית', ['g', 100]],
    ['7290000000010', 'קוטג׳ תנובה 5% 250 גרם', 'תנובה', ['g', 250]],
    ['7290000000011', 'גבינת קוטג 5% 250 גרם', 'טרה', ['g', 250]],
    ['7290000000020', 'לחם אחיד פרוס', 'אנג׳ל', ['g', 750]],
    ['7290000000021', 'לחם כוסמין 500 גרם', 'ברמן', ['g', 500]],
    ['7290000000022', 'פירורי לחם 500 גרם', 'אסם', ['g', 500]],
    ['7290000000040', 'נוזל כלים לימון 750 מ"ל', 'סנו', ['ml', 750]],
    ['7290000000041', 'סבון כלים פיירי 750 מ"ל', 'P&G', ['ml', 750]],
    ['7290000000050', 'פסטה ספגטי 500 גרם', 'אסם', ['g', 500]],
    ['7290000000051', 'פסטה פוסילי 500 גרם', 'ברילה', ['g', 500]],
    ['7290000000060', 'ביצים אריזון 12 גדול', 'משק', ['u', 12]],
    ['7290000000061', 'ביצים 12 יח בינוני M', 'משק', ['u', 12]],
    ['7290000000062', 'ביצים אומגה 3 12 יח L', 'משק', ['u', 12]],
    ['7290000000063', 'ביצים 30יח גדול L', 'משק', ['u', 30]],
    ['7290000000064', 'סלט ביצים 400 גרם', 'שמיר', ['g', 400]],
    ['7290000000065', 'קוצץ ביצים 200 גרם', 'שמיר', ['g', 200]],
    ['7290000000070', 'קפה נמס עלית 200 גרם', 'עלית', ['g', 200]],
    ['7290000000080', 'שמן זית כתית 750 מ"ל', 'יד מרדכי', ['ml', 750]],
    ['7290000000090', 'שמנת מתוקה 38% 250 מ"ל', 'תנובה', ['ml', 250]],
    ['7290000000100', 'עגבניות מרוסקות 850 גרם', 'יכין', ['g', 850]],
  ]
  for (const [barcode, name, manufacturer, pack] of products) {
    db.products.push({
      barcode, name, manufacturer, quantity: null, unit: null, is_weighted: pack === 'kg',
      pack_unit: pack === 'kg' ? 'g' : pack[0], pack_qty: pack === 'kg' ? 1000 : pack[1], updated_at: at(today),
    })
  }
  // Produce and fresh chicken: chain-internal codes, priced per kg.
  const fresh: [string, string][] = [['1', 'עגבניה'], ['2', 'מלפפון'], ['3', 'חזה עוף טרי ארוז']]
  for (const chain of ['rami_levy', 'shufersal', 'osher_ad', 'carrefour', 'tiv_taam']) {
    for (const [code, name] of fresh) {
      if (chain === 'tiv_taam' && code === '2') continue
      db.products.push({
        barcode: `${chain}:${code}`, name, manufacturer: null, quantity: 1, unit: 'קילוגרם', is_weighted: true,
        pack_unit: 'g', pack_qty: 1000, updated_at: at(today),
      })
    }
  }
  const base: Record<string, number> = {
    '7290000000001': 7.2, '7290000000002': 6.9, '7290000000003': 13.9, '7290000000004': 5.9,
    '7290000000010': 5.9, '7290000000011': 5.7, '7290000000020': 7.36, '7290000000021': 16.9, '7290000000022': 6.9,
    '7290000000040': 7.9, '7290000000041': 11.9, '7290000000050': 4.9, '7290000000051': 7.9,
    '7290000000060': 14.24, '7290000000061': 13.13, '7290000000062': 22.9, '7290000000063': 35.5,
    '7290000000064': 9.9, '7290000000065': 8.9, '7290000000070': 25.9, '7290000000080': 39.9,
    '7290000000090': 6.9, '7290000000100': 10.9, ':1': 7.9, ':2': 5.9, ':3': 36.9,
  }
  // Each store's price level, and what it doesn't sell.
  const level: Record<number, number> = { 1: 0.92, 6: 0.95, 2: 1.05, 7: 1.18, 3: 0.94, 4: 1.0, 5: 1.12 }
  const missing: Record<number, string[]> = {
    1: ['7290000000002', '7290000000041'], 6: ['7290000000002', '7290000000021'],
    2: ['7290000000011'], 7: ['7290000000011', '7290000000063', '7290000000051'],
    3: ['7290000000062'], 4: [], 5: ['7290000000020', '7290000000040', '7290000000060'],
  }
  for (const [storeId, chain] of stores.map(([id, c]): [number, string] => [id, c])) {
    for (const [key, price] of Object.entries(base)) {
      const barcode = key.startsWith(':') ? `${chain}${key}` : key
      if (missing[storeId].includes(key) || !db.products.some((p) => p.barcode === barcode)) continue
      db.prices.push({
        store_id: storeId, barcode, price: Math.round(price * level[storeId] * 10) / 10,
        unit_price: null, price_updated_at: at(today, '05:40'),
      })
    }
  }
  db.price_history.push(
    { store_id: 1, barcode: '7290000000001', changed_on: daysAgo(6), old_price: 5.6, new_price: 6.2 },
    { store_id: 2, barcode: '7290000000080', changed_on: daysAgo(10), old_price: 49.9, new_price: 44.9 },
  )
  db.purchases.push({
    id: id(), household_id: HOUSEHOLD, trip_id: null, name: 'שמן זית', normalized_name: 'שמן זית', category: 'pantry',
    barcode: '7290000000080', quantity: 1, unit: null, purchased_at: at(daysAgo(80)),
  })

  // The daily price updates, with stats shaped like house_ingest writes them:
  // {chain: {stores: {code: {name, file, items, ...} | {name, error}}}}.
  const chainCode = Object.fromEntries(db.chains.map((c) => [c.id, c.chain_code]))
  const runStats = (day: string, withoutFile: string[] = []) => {
    const stats: Row = {}
    for (const [, chain, code, name] of stores) {
      stats[chain] ??= { stores: {} }
      stats[chain].stores[code] = withoutFile.includes(code)
        ? { name, error: 'no PriceFull file' }
        : {
            name, file: `PriceFull${chainCode[chain]}-${code.padStart(3, '0')}-${day.replace(/-/g, '')}0600.xml`,
            items: 3800 + ((Number(code) * 131) % 2400), products_written: 12 + (Number(code) % 40),
            prices_written: 150 + ((Number(code) * 17) % 300), prices_removed: Number(code) % 7,
          }
    }
    return stats
  }
  db.ingest_runs.push(
    { id: 1, started_at: at(daysAgo(2), '06:17'), finished_at: at(daysAgo(2), '06:23'), status: 'ok', stats: runStats(daysAgo(2)) },
    { id: 2, started_at: at(daysAgo(1), '06:17'), finished_at: at(daysAgo(1), '06:22'), status: 'partial', stats: runStats(daysAgo(1), ['277']) },
    { id: 3, started_at: at(today, '06:17'), finished_at: at(today, '06:21'), status: 'ok', stats: runStats(today) },
  )

  // Going out: made-up places (no real business is named or located here) in
  // the Old City, Ringelblum and by the university, standing in for the OSM
  // catalog; most have no opening hours, like most of the real ones.
  const venues: [string, string, number, number, string | null, Row?][] = [
    ['בר הדוגמה', 'bar', 31.2412, 34.7878, 'Su-Th 18:00-02:00; Fr 21:00-04:00; Sa 20:00-02:00',
      { address: 'רחוב הדוגמה 7', website: 'https://example.com/bar', instagram: 'demo.bar' }],
    ['פאב השכונה', 'pub', 31.2648, 34.7968, 'Su-Th 15:00-04:00; Sa "צאת שבת עד 04:00"'],
    ['הבית של הקפה', 'cafe', 31.26, 34.8, 'Su-Th 07:30-20:00; Fr 07:30-14:00'],
    ['מטבח החצר', 'restaurant', 31.2398, 34.7905, '10:00-24:00; Fr,Sa 09:00-24:00', { phone: '08-0000000' }],
    ['הכוס החצי מלאה', 'bar', 31.266, 34.799, null],
    ['פינת הבירה', 'pub', 31.2613, 34.8035, null],
    ['קפה המרפסת', 'cafe', 31.242, 34.7921, null],
    ['הסלט המדברי', 'restaurant', 31.2535, 34.7935, 'Mo-We, Su 12:00-00:00; Th-Sa 12:00-01:00', { cuisine: 'mediterranean' }],
    ['מועדון החול', 'nightclub', 31.2391, 34.7869, 'Th-Sa 23:00-05:00'],
    ['גינת השקיעה', 'bar', 31.2639, 34.7952, 'Sa-Th 21:00-02:00; Fr 12:00-16:30, 21:00-02:00'],
    ['השולחן הארוך', 'restaurant', 31.259, 34.7985, null],
    ['קיוסק הכיכר', 'cafe', 31.2508, 34.7899, '24/7'],
  ]
  venues.forEach(([name, kind, lat, lng, hours, extra], i) => {
    db.venues.push({
      id: i + 1, osm_ref: `demo:node/${i + 1}`, name, kind, lat, lng, address: null, opening_hours: hours,
      website: null, phone: null, instagram: null, cuisine: null, source: 'osm', household_id: null, created_by: null,
      status: 'approved', hidden: false, hidden_by_admin: false, review_note: null, suggested_household_id: null,
      admin_edited_at: null, created_at: at(daysAgo(40), '05:40'), updated_at: at(daysAgo(3), '05:40'), ...extra,
    })
  })
  // Places the household added: one waiting for approval (יהלי's, no
  // location), one approved and in everyone's list since (מיכאל's).
  db.venues.push(
    {
      id: 13, osm_ref: null, name: 'בר הגג החדש', kind: 'bar', lat: null, lng: null, address: 'רחוב הדוגמה 12',
      opening_hours: null, website: null, phone: null, instagram: null, cuisine: null, source: 'community',
      household_id: HOUSEHOLD, created_by: YAHALI, status: 'pending', hidden: false, hidden_by_admin: false,
      review_note: null, suggested_household_id: HOUSEHOLD, admin_edited_at: null,
      created_at: at(daysAgo(1), '22:10'), updated_at: at(daysAgo(1), '22:10'),
    },
    {
      id: 14, osm_ref: null, name: 'מרפסת הסמטה', kind: 'cafe', lat: 31.2425, lng: 34.7889, address: 'סמטת הדוגמה 3',
      opening_hours: null, website: null, phone: null, instagram: 'demo.alley', cuisine: null, source: 'community',
      household_id: null, created_by: MICHAEL, status: 'approved', hidden: false, hidden_by_admin: false,
      review_note: null, suggested_household_id: HOUSEHOLD, admin_edited_at: null,
      created_at: at(daysAgo(25), '18:00'), updated_at: at(daysAgo(18), '09:00'),
    },
  )
  const venueDeal = (venueId: number, title: string, kind: string, weekdays: number[], hours: [string, string] | null, extra: Row = {}): Row => ({
    id: id(), venue_id: venueId, household_id: null, created_by: null, title, kind, weekdays,
    starts_at: hours ? `${hours[0]}:00` : null, ends_at: hours ? `${hours[1]}:00` : null, valid_from: null,
    valid_until: null, note: null, status: 'approved', reviewed_by: MICHAEL, reviewed_at: at(daysAgo(20)),
    review_note: null, last_confirmed_at: at(daysAgo(3), '21:00'), created_at: at(daysAgo(30)), ...extra,
  })
  const jazzNight = addDays(today, 2)
  db.venue_deals.push(
    // מיכאל's suggestion, approved: in everyone's list, and under "אושרו" in ההצעות שלי.
    venueDeal(1, 'יין ללא תחתית', 'special_day', [2], ['19:00', '23:00'], {
      note: 'בקנייה של מנה עיקרית', household_id: HOUSEHOLD, created_by: MICHAEL,
    }),
    venueDeal(2, 'בירה מהחבית בחצי מחיר', 'happy_hour', [], ['17:00', '19:00']),
    venueDeal(6, '1+1 על בירה', 'special_day', [4], ['21:00', '01:00'], { last_confirmed_at: at(daysAgo(75), '22:30') }),
    venueDeal(4, 'עסקית צהריים', 'happy_hour', [0, 1, 2, 3, 4, 5], ['12:00', '16:00'], { note: 'מנה ראשונה ועיקרית' }),
    venueDeal(3, 'הנחת סטודנטים', 'special_day', [0, 1, 2, 3, 4, 5], null, {
      note: 'בהצגת תעודת סטודנט', last_confirmed_at: at(daysAgo(0), '09:15'),
    }),
    venueDeal(8, 'ערב ג׳אז', 'event', [], ['21:00', '23:30'], {
      valid_from: jazzNight, valid_until: jazzNight, note: 'כניסה חופשית', created_at: at(daysAgo(4)),
    }),
    // יהלי's suggestions: one seen only in this household until an admin
    // approves it, one an admin rejected (with a reply; only in ההצעות שלי).
    venueDeal(10, 'קוקטייל הבית 1+1', 'happy_hour', [0, 1, 2, 3, 4], ['21:00', '22:30'], {
      household_id: HOUSEHOLD, created_by: YAHALI, status: 'pending', reviewed_by: null, reviewed_at: null,
      last_confirmed_at: at(daysAgo(1), '20:30'), created_at: at(daysAgo(1), '20:30'),
    }),
    venueDeal(9, 'כניסה חינם לפני חצות', 'special_day', [4], ['23:00', '00:00'], {
      household_id: HOUSEHOLD, created_by: YAHALI, status: 'rejected', reviewed_at: at(daysAgo(3)),
      review_note: 'לא מצאנו את הדיל בעמוד של המקום', last_confirmed_at: at(daysAgo(6)), created_at: at(daysAgo(6)),
    }),
    // Keva card discounts: standing, so on the places but never in "עכשיו".
    venueDeal(5, '10% הנחה בכרטיס חבר', 'member_card', [], null, { note: 'לא כולל אלכוהול' }),
    venueDeal(4, '15% על הארוחה בכרטיס חבר', 'member_card', [0, 1, 2, 3, 4], null),
    // יהלי's, waiting for approval.
    venueDeal(7, 'קפה ומאפה ב־20% בכרטיס חבר', 'member_card', [], null, {
      household_id: HOUSEHOLD, created_by: YAHALI, status: 'pending', reviewed_by: null, reviewed_at: null,
      last_confirmed_at: at(daysAgo(2), '10:00'), created_at: at(daysAgo(2), '10:00'),
    }),
  )
  // The household's stars: shown first, for both of them.
  for (const venueId of [1, 8]) {
    db.venue_favorites.push({ household_id: HOUSEHOLD, venue_id: venueId, created_at: at(daysAgo(10)) })
  }

  // דירת ניסיון: two items on טל's list, nothing else.
  for (const [name, category] of [['חלב', 'dairy'], ['לחם', 'bakery']]) {
    db.list_items.push({
      id: id(), list_id: TEST_LIST, household_id: TEST_HOUSEHOLD, name, quantity: 1, unit: null, category, note: null,
      barcode: null, checked: false, checked_by: null, checked_at: null, added_by: TAL,
      created_at: at(daysAgo(11)), updated_at: at(daysAgo(11)),
    })
  }
  return db
}
