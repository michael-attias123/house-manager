import type { BasketMatch, Store } from '@/lib/db-types'
import { compareBaskets } from './basket'

const store = (id: number, name: string): Store => ({
  id,
  chain_id: 'x',
  store_code: String(id),
  name,
  city: 'באר שבע',
  address: null,
  active: true,
  last_ingested_at: null,
})
const match = (store_id: number, item_id: string, price: number): BasketMatch => ({
  store_id,
  item_id,
  barcode: `${item_id}-bc`,
  product_name: item_id,
  price,
  exact: true,
})

describe('compareBaskets', () => {
  const items = [
    { id: 'milk', name: 'חלב', quantity: 2 },
    { id: 'bread', name: 'לחם', quantity: 1 },
    { id: 'saffron', name: 'זעפרן', quantity: 1 },
  ]
  const stores = [store(1, 'יקר'), store(2, 'זול'), store(3, 'בלי נתונים')]
  const matches = [
    match(1, 'milk', 7),
    match(1, 'bread', 8),
    match(1, 'saffron', 30),
    match(2, 'milk', 6),
    match(2, 'bread', 7.5),
  ]

  it('ranks by the items both stores carry', () => {
    const result = compareBaskets(items, stores, matches)
    expect(result.baskets.map((b) => b.store.name)).toEqual(['זול', 'יקר'])
    expect(result.commonItemIds).toEqual(['milk', 'bread'])
    expect(result.baskets[0].commonTotal).toBe(19.5)
    expect(result.baskets[1].commonTotal).toBe(22)
    expect(result.baskets[1].total).toBe(52)
    expect(result.baskets[1].extra).toBe(2.5)
    expect(result.maxSavings).toBe(2.5)
  })

  it('reports missing items and stores without data', () => {
    const result = compareBaskets(items, stores, matches)
    expect(result.baskets[0].missing.map((m) => m.id)).toEqual(['saffron'])
    expect(result.storesWithoutData.map((s) => s.name)).toEqual(['בלי נתונים'])
  })

  it('handles no data at all', () => {
    expect(compareBaskets(items, stores, []).baskets).toEqual([])
  })
})
