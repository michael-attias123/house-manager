import { demoClient } from './client'
import { HOUSEHOLD, MICHAEL, TAL, TEST_HOUSEHOLD, YAHALI } from './seed'
import { db } from './store'

const list = () => db.shopping_lists[0].id

describe('demo client', () => {
  it('filters, orders and limits like PostgREST', async () => {
    const { data } = await demoClient
      .from('list_items')
      .select('*')
      .eq('list_id', list())
      .order('created_at', { ascending: false })
      .limit(2)
    expect((data as { name: string }[]).map((i) => i.name)).toEqual(['במבה', 'ביצים'])
  })

  it('embeds child and parent rows', async () => {
    const expenses = (await demoClient.from('expenses').select('*, expense_shares(user_id, amount)').limit(1)).data as {
      amount: number
      expense_shares: { amount: number }[]
    }[]
    expect(expenses[0].expense_shares.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(expenses[0].amount)
    const member = (await demoClient.from('household_members').select('joined_at, households(*)').eq('user_id', MICHAEL)).data as {
      households: { id: string }
    }[]
    expect(member[0].households.id).toBe(HOUSEHOLD)
  })

  it('returns errors instead of throwing', async () => {
    const { data, error } = await demoClient.from('nope').select('*')
    expect(data).toBeNull()
    expect(error?.message).toMatch('nope')
  })

  it('completes a trip and records a balanced expense', async () => {
    const before = db.list_items.length
    const trip = await demoClient.rpc('complete_trip', { p_list_id: list(), p_total: 100 })
    expect(trip.error).toBeNull()
    expect(db.list_items.length).toBe(before - 1)

    const balance = async () =>
      ((await demoClient.from('member_balances').select('user_id, balance').eq('user_id', MICHAEL)).data as { balance: number }[])[0]
        .balance
    const start = await balance()
    const saved = await demoClient.rpc('save_expense', {
      p_household_id: HOUSEHOLD,
      p_description: 'פיצה',
      p_amount: 120,
      p_paid_by: MICHAEL,
      p_shares: { [MICHAEL]: 72, [YAHALI]: 48 },
    })
    expect(saved.error).toBeNull()
    expect(await balance()).toBeCloseTo(start + 48)

    const bad = await demoClient.rpc('save_expense', {
      p_household_id: HOUSEHOLD,
      p_description: 'x',
      p_amount: 10,
      p_paid_by: MICHAEL,
      p_shares: { [MICHAEL]: 1 },
    })
    expect(bad.error?.message).toMatch('add up')
  })

  it('pays a bill, splits it and advances the due date', async () => {
    const bill = db.bills.find((b) => b.name === 'ארנונה')!
    const due = bill.next_due_date
    const { error } = await demoClient.rpc('pay_bill', { p_bill_id: bill.id, p_amount: 333.33 })
    expect(error).toBeNull()
    expect(bill.next_due_date > due).toBe(true)
    const expense = db.expenses.find((e) => e.source_id === bill.id)!
    const shares = db.expense_shares.filter((s) => s.expense_id === expense.id).map((s) => s.amount)
    expect(shares.sort()).toEqual([166.66, 166.67])
  })

  it('matches products by kind and pack, never the look-alikes', async () => {
    const { data } = await demoClient.rpc('match_candidates', {
      p_items: [
        { id: 'milk', terms: ['חלב'], exclude: [], require: [], weighted: null, barcode: '7290000000001' },
        { id: 'eggs', terms: ['ביצים'], exclude: ['סלט', 'קוצץ'], require: [], weighted: null, barcode: null },
      ],
    })
    const rows = data as { item_id: string; tier: number; store_id: number; product_name: string; price: number }[]
    const exactMilk = rows.filter((m) => m.item_id === 'milk' && m.tier === 0)
    expect(exactMilk).toHaveLength(7)
    expect(exactMilk.find((m) => m.store_id === 3)?.price).toBe(6.8)
    const eggs = rows.filter((m) => m.item_id === 'eggs')
    expect(eggs.length).toBeGreaterThan(0)
    expect(eggs.some((m) => /סלט|קוצץ/.test(m.product_name))).toBe(false)
  })
})

describe('demo admin', () => {
  type Member = { user_id: string; display_name: string; is_placeholder: boolean; email: string | null }
  const households = async () => (await demoClient.rpc('admin_list_households')).data as { id: string; members: Member[] }[]
  const rpcError = async (name: string, args: Record<string, unknown>) => (await demoClient.rpc(name, args)).error?.message

  it('knows מיכאל is an admin, and keeps the admin tables away from the client', async () => {
    expect((await demoClient.rpc('is_admin')).data).toBe(true)
    expect((await demoClient.from('app_admins').select('*')).error?.message).toMatch('permission denied')
    expect((await demoClient.from('allowed_emails').select('*')).error?.message).toMatch('permission denied')
  })

  it('guards the allowlist like the server', async () => {
    expect(await rpcError('admin_remove_allowed_email', { p_email: ' Michael@demo ' })).toBe('cannot remove your own email')
    expect(await rpcError('admin_add_allowed_email', { p_email: 'nope' })).toBe('invalid email')
    const added = await demoClient.rpc('admin_add_allowed_email', { p_email: ' Friend@Example.com ', p_note: 'חבר' })
    expect((added.data as { email: string }).email).toBe('friend@example.com')
    expect(await rpcError('admin_remove_allowed_email', { p_email: 'friend@example.com' })).toBeUndefined()
    expect(await rpcError('admin_remove_allowed_email', { p_email: 'friend@example.com' })).toBe('not found')
  })

  it('deletes טל: out of the household, list items kept without an author', async () => {
    expect(await rpcError('admin_delete_user', { p_user_id: MICHAEL })).toBe('cannot delete your own account')
    expect(await rpcError('admin_delete_user', { p_user_id: TAL })).toBeUndefined()
    const users = (await demoClient.rpc('admin_list_users')).data as { id: string }[]
    expect(users.map((u) => u.id)).not.toContain(TAL)
    expect((await households()).find((h) => h.id === TEST_HOUSEHOLD)?.members).toEqual([])
    const items = db.list_items.filter((i) => i.household_id === TEST_HOUSEHOLD)
    expect(items).toHaveLength(2)
    expect(items.every((i) => i.added_by === null)).toBe(true)
  })

  it('deletes "דירת ניסיון" with every row that belongs to it', async () => {
    expect(await rpcError('admin_delete_household', { p_household_id: HOUSEHOLD })).toBe('cannot delete your own household')
    expect(await rpcError('admin_delete_household', { p_household_id: TEST_HOUSEHOLD })).toBeUndefined()
    expect(db.households.map((h) => h.id)).toEqual([HOUSEHOLD])
    for (const [table, rows] of Object.entries(db)) {
      expect(rows.filter((r) => r.household_id === TEST_HOUSEHOLD), table).toEqual([])
    }
    expect(db.shopping_lists.filter((l) => l.household_id === HOUSEHOLD)).toHaveLength(1)
  })

  it('turns a member with history into a placeholder with the same balance', async () => {
    const balance = async (userId: string) =>
      ((await demoClient.from('member_balances').select('user_id, balance').eq('user_id', userId)).data as { balance: number }[])[0]
        ?.balance
    const before = await balance(YAHALI)
    const code = db.households[0].invite_code
    expect(await rpcError('admin_remove_member', { p_household_id: HOUSEHOLD, p_user_id: MICHAEL })).toBe('cannot remove yourself')
    expect(await rpcError('admin_remove_member', { p_household_id: HOUSEHOLD, p_user_id: YAHALI })).toBeUndefined()
    const placeholder = (await households())[0].members.find((m) => m.display_name === 'יהלי')!
    expect(placeholder).toMatchObject({ is_placeholder: true, email: null })
    expect(placeholder.user_id).not.toBe(YAHALI)
    expect(await balance(placeholder.user_id)).toBeCloseTo(before)
    expect(await balance(YAHALI)).toBeUndefined()
    expect(db.households[0].invite_code).not.toBe(code)
    expect(await rpcError('admin_remove_member', { p_household_id: HOUSEHOLD, p_user_id: placeholder.user_id })).toBe(
      'placeholder has history',
    )
  })
})

describe('demo notifications', () => {
  const prefs = async () =>
    (await demoClient.from('notification_prefs').select('*').eq('user_id', MICHAEL)).data as Record<string, unknown>[]

  it('keeps notification choices, one column at a time, with everything off at first', async () => {
    expect(await prefs()).toEqual([])
    expect((await demoClient.from('notification_prefs').upsert({ user_id: MICHAEL, bills: true })).error).toBeNull()
    expect((await demoClient.from('notification_prefs').upsert({ user_id: MICHAEL, weekly: true })).error).toBeNull()
    expect(await prefs()).toEqual([
      expect.objectContaining({
        user_id: MICHAEL, bills: true, chores: false, partner: false, weekly: true, going_out: false, admin: false,
      }),
    ])
    expect(db.notification_prefs).toHaveLength(1)
  })

  it('"sends" a test notification without an error', async () => {
    expect(await demoClient.rpc('send_test_notification')).toEqual({ data: null, error: null })
  })
})
