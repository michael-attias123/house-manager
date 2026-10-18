import { demoClient } from './client'
import { HOUSEHOLD, MICHAEL, YAHALI } from './seed'
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
    expect((data as { name: string }[]).map((i) => i.name)).toEqual(['ביצים', 'פסטה'])
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

  it('matches the basket across stores', async () => {
    db.list_items.push({
      id: 'milk', list_id: list(), household_id: HOUSEHOLD, name: 'חלב', quantity: 1, barcode: '7290000000001', checked: false,
    })
    const { data } = await demoClient.rpc('basket_matches', { p_list_id: list() })
    const milk = (data as { item_id: string; store_id: number; price: number; exact: boolean }[]).filter((m) => m.item_id === 'milk')
    expect(milk).toHaveLength(5)
    expect(milk.every((m) => m.exact)).toBe(true)
    expect(milk.find((m) => m.store_id === 3)?.price).toBe(6.1)
  })
})
