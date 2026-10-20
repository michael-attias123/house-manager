import type { Store } from '@/lib/db-types'
import { toAgorot } from '@/lib/money'
import { compareBaskets } from './basket'
import type { ItemMatch, ItemResolution } from './match'

const store = (id: number, chain_id: string, name = `${chain_id} ${id}`): Store => ({
  id,
  chain_id,
  store_code: String(id),
  name,
  city: 'באר שבע',
  address: null,
  active: true,
  last_ingested_at: null,
})

const resolution = (id: string, prices: Record<number, number>): ItemResolution => ({
  item: { id, name: id, quantity: 1, unit: null, barcode: null },
  target: null,
  weighted: false,
  byStore: new Map(
    Object.entries(prices).map(([storeId, price]): [number, ItemMatch] => [
      Number(storeId),
      {
        itemId: id,
        storeId: Number(storeId),
        barcode: id,
        productName: id,
        price,
        pack: null,
        weighted: false,
        kind: 'cheapest',
        multiplier: 1,
        lineTotal: price,
      },
    ]),
  ),
})

describe('compareBaskets', () => {
  const stores = [store(1, 'rami_levy'), store(2, 'rami_levy'), store(3, 'shufersal'), store(4, 'tiv_taam')]

  it('totals are exactly the sum of their lines, missing items at the median', () => {
    const result = compareBaskets(
      [
        resolution('milk', { 1: 7.1, 2: 7.2, 3: 7.35 }),
        resolution('eggs', { 1: 14.2, 3: 14.24, 4: 14.24 }),
        resolution('saffron', {}),
      ],
      stores,
    )
    expect(result.notFound.map((i) => i.id)).toEqual(['saffron'])
    for (const chain of result.chains) {
      for (const b of chain.branches) {
        const sum = b.lines.reduce((s, l) => s + toAgorot(l.lineTotal), 0)
        expect(toAgorot(b.total)).toBe(sum)
        expect(b.lines).toHaveLength(2)
      }
    }
    // Store 2 has no eggs: counted at the median of 14.20, 14.24, 14.24.
    const branch2 = result.chains.find((c) => c.chainId === 'rami_levy')!.branches.find((b) => b.store.id === 2)!
    expect(branch2.lines[1]).toMatchObject({ estimated: true, lineTotal: 14.24 })
    expect(branch2.found).toBe(1)
  })

  it('groups branches by chain and ranks chains by their cheapest branch', () => {
    const result = compareBaskets(
      [resolution('milk', { 1: 7.5, 2: 7.1, 3: 7.35, 4: 9 }), resolution('bread', { 1: 6, 2: 6, 3: 7.36, 4: 8.38 })],
      stores,
    )
    expect(result.chains.map((c) => c.chainId)).toEqual(['rami_levy', 'shufersal', 'tiv_taam'])
    const rami = result.chains[0]
    expect(rami.best.store.id).toBe(2)
    expect(rami.branches.map((b) => b.store.id)).toEqual([2, 1])
    expect(result.chains[1].extra).toBe(1.61)
    expect(result.maxSavings).toBe(4.28)
  })

  it('leaves out stores with none of the items', () => {
    const result = compareBaskets([resolution('milk', { 1: 7 })], stores)
    expect(result.chains.flatMap((c) => c.branches.map((b) => b.store.id))).toEqual([1])
  })
})
