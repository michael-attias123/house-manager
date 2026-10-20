import {
  balanceFromRows,
  convertRow,
  guessExpenseCategory,
  guessKind,
  guessPeople,
  parseCsv,
  parseSplitwise,
  rowKeys,
} from './splitwise'

// Same shape as a real Splitwise export (blank lines, a quoted field with "",
// trailing spaces, a "Total balance" row); names and amounts are made up.
const CSV = [
  'Date,Description,Category,Cost,Currency,Dana Levi,Avi Cohen',
  '',
  '2026-08-25,שכר דירה ספטמבר,General,1900.00,ILS,950.00,-950.00',
  '2026-09-01,דלק ,General,300.00,ILS,-300.00,300.00',
  '2026-09-08,דלק,General,305.00,ILS,-152.50,152.50',
  '2026-09-12,להחזיר כסף,General,710.00,ILS,-710.00,710.00',
  '2026-09-28,"טיול בח""ול ",General,1100.00,ILS,1100.00,-1100.00',
  '2026-10-09,סופר דבאח,General,494.00,ILS,247.00,-247.00',
  '2026-10-15,החזר ,General,1750.00,ILS,-1750.00,1750.00',
  '2026-10-16,Dinner in Rome,Dining out,40.00,EUR,20.00,-20.00',
  '',
  '2026-10-20,Total balance, , ,ILS,-615.50,615.50',
  '',
].join('\r\n')

const DANA = 'u-dana'
const AVI = 'u-avi'

describe('parseCsv', () => {
  it('handles quotes, escaped quotes and CRLF', () => {
    expect(parseCsv('a,"b ""c"", d"\r\n1,2')).toEqual([
      ['a', 'b "c", d'],
      ['1', '2'],
    ])
  })
})

describe('parseSplitwise', () => {
  const file = parseSplitwise(CSV)

  it('reads people, rows and the total', () => {
    expect(file.people).toEqual(['Dana Levi', 'Avi Cohen'])
    expect(file.rows).toHaveLength(8)
    expect(file.rows[4].description).toBe('טיול בח"ול')
    expect(file.totals).toEqual([-615.5, 615.5])
  })

  it('rejects other files', () => {
    expect(() => parseSplitwise('name,amount\nx,1')).toThrow('Splitwise')
  })

  it('guesses categories and repayments', () => {
    const kinds = file.rows.map(guessKind)
    expect(kinds).toEqual([
      'expense',
      'expense',
      'expense',
      'transfer',
      'expense',
      'expense',
      'transfer',
      'expense',
    ])
    expect(file.rows.map((r) => guessExpenseCategory(r.description, r.category))).toEqual([
      'rent',
      'transport',
      'transport',
      'other',
      'travel',
      'groceries',
      'other',
      'eating_out',
    ])
  })

  it('converts rows into expenses and transfers that reproduce the balance', () => {
    const people = [DANA, AVI]
    const keys = rowKeys(file.rows)
    const results = file.rows.map((row, i) =>
      convertRow(
        row,
        keys[i],
        people,
        guessKind(row),
        guessExpenseCategory(row.description, row.category),
      ),
    )

    expect(results[0]).toMatchObject({
      ok: true,
      expense: {
        paidBy: DANA,
        amount: 1900,
        splitType: 'equal',
        shares: { [DANA]: 950, [AVI]: 950 },
      },
    })
    // Avi paid fuel that is all Dana's.
    expect(results[1]).toMatchObject({
      ok: true,
      expense: { paidBy: AVI, splitType: 'full', shares: { [DANA]: 300 } },
    })
    // "להחזיר כסף": Avi pays Dana back.
    expect(results[3]).toMatchObject({ ok: true, transfer: { from: AVI, to: DANA, amount: 710 } })
    expect(results[7]).toEqual({ ok: false, reason: 'מטבע EUR' })

    // Applying the imported rows gives the same net balance as Splitwise
    // (excluding the EUR row, which Splitwise's ILS total also leaves out).
    const net: Record<string, number> = { [DANA]: 0, [AVI]: 0 }
    for (const r of results) {
      if (!r.ok) continue
      if ('expense' in r) {
        net[r.expense.paidBy] += r.expense.amount
        for (const [id, s] of Object.entries(r.expense.shares)) net[id] -= s
      } else {
        net[r.transfer.from] += r.transfer.amount
        net[r.transfer.to] -= r.transfer.amount
      }
    }
    expect(net[DANA]).toBeCloseTo(-615.5)
    expect(net[AVI]).toBeCloseTo(615.5)
    expect(balanceFromRows(file.rows.slice(0, 7), people)).toEqual({ [DANA]: -615.5, [AVI]: 615.5 })
  })

  it('refuses rows involving someone outside the household', () => {
    const [row] = file.rows
    expect(convertRow(row, 'k', [DANA, null], 'expense', 'rent')).toEqual({
      ok: false,
      reason: 'כולל מישהו שלא בבית',
    })
  })

  it('keeps identical rows distinct', () => {
    const twice = [file.rows[2], file.rows[2]]
    const [a, b] = rowKeys(twice)
    expect(a).not.toBe(b)
  })
})

describe('guessPeople', () => {
  const members = [
    { user_id: 'me', display_name: 'מיכאל' },
    { user_id: 'partner', display_name: 'יהלי' },
  ]

  it('matches my Google name and pairs the rest', () => {
    expect(
      guessPeople(['Yahli Brosh', 'Michael Attias'], members, {
        id: 'me',
        names: ['Michael Attias'],
      }),
    ).toEqual(['partner', 'me'])
  })

  it('matches display names', () => {
    expect(guessPeople(['יהלי', 'מיכאל'], members, { id: 'me', names: [] })).toEqual([
      'partner',
      'me',
    ])
  })

  it('leaves extra people unassigned', () => {
    expect(
      guessPeople(['Michael Attias', 'Friend', 'Other'], members, {
        id: 'me',
        names: ['Michael Attias'],
      }),
    ).toEqual(['me', null, null])
  })
})
