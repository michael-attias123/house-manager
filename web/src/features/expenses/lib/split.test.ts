import { computeShares, validateSplit } from './split'

const A = 'michael'
const B = 'partner'

describe('computeShares', () => {
  it('splits equally to the agora, remainder to the payer', () => {
    expect(computeShares(100, A, { type: 'equal', participants: [A, B] })).toEqual({ [A]: 50, [B]: 50 })
    expect(computeShares(333.33, A, { type: 'equal', participants: [A, B] })).toEqual({ [A]: 166.67, [B]: 166.66 })
    expect(computeShares(10, B, { type: 'equal', participants: [A, B, 'c'] })).toEqual({ [A]: 3.33, [B]: 3.34, c: 3.33 })
  })

  it('gives the remainder to the largest share when the payer is not splitting', () => {
    expect(computeShares(0.05, A, { type: 'equal', participants: [B, 'c'] })).toEqual({ [B]: 0.03, c: 0.02 })
  })

  it('splits by percent and by default weights', () => {
    expect(computeShares(200, A, { type: 'percent', percents: { [A]: 60, [B]: 40 } })).toEqual({ [A]: 120, [B]: 80 })
    expect(computeShares(99.99, B, { type: 'default', weights: { [A]: 50, [B]: 50 } })).toEqual({ [A]: 49.99, [B]: 50 })
  })

  it('supports exact amounts and "owed in full"', () => {
    expect(computeShares(50, A, { type: 'exact', amounts: { [A]: 20, [B]: 30 } })).toEqual({ [A]: 20, [B]: 30 })
    expect(computeShares(80, A, { type: 'full', owedBy: B })).toEqual({ [B]: 80 })
  })

  it('always adds up to the amount', () => {
    for (const amount of [0.01, 1, 7.77, 101.01, 1234.56]) {
      const shares = computeShares(amount, A, { type: 'percent', percents: { [A]: 33.3, [B]: 66.7 } })
      const sum = Object.values(shares).reduce((s, v) => s + Math.round(v * 100), 0)
      expect(sum).toBe(Math.round(amount * 100))
    }
  })
})

describe('validateSplit', () => {
  it('flags percent and exact mismatches', () => {
    expect(validateSplit(100, { type: 'percent', percents: { [A]: 50, [B]: 40 } })).toMatch('90%')
    expect(validateSplit(100, { type: 'exact', amounts: { [A]: 50, [B]: 40 } })).toMatch('חסרים')
    expect(validateSplit(100, { type: 'exact', amounts: { [A]: 50, [B]: 60 } })).toMatch('עודף')
    expect(validateSplit(100, { type: 'exact', amounts: { [A]: 50, [B]: 50 } })).toBeNull()
    expect(validateSplit(0, { type: 'equal', participants: [A] })).not.toBeNull()
  })
})
