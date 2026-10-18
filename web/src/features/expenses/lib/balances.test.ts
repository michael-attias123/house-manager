import { simplifyDebts } from './balances'

describe('simplifyDebts', () => {
  it('creates one transfer for two people', () => {
    expect(simplifyDebts({ a: 40, b: -40 })).toEqual([{ from: 'b', to: 'a', amount: 40 }])
  })

  it('returns nothing when settled', () => {
    expect(simplifyDebts({ a: 0, b: 0 })).toEqual([])
    expect(simplifyDebts({ a: 0.001, b: -0.001 })).toEqual([])
  })

  it('settles several people with few transfers', () => {
    const transfers = simplifyDebts({ a: 100, b: -70, c: -30 })
    expect(transfers).toEqual([
      { from: 'b', to: 'a', amount: 70 },
      { from: 'c', to: 'a', amount: 30 },
    ])
  })
})
