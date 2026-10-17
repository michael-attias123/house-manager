import type { BasketMatch, Store } from '@/lib/db-types'
import { fromAgorot, toAgorot } from '@/lib/money'

export interface BasketItem {
  id: string
  name: string
  quantity: number
}

export interface BasketLine {
  itemId: string
  itemName: string
  productName: string
  barcode: string
  price: number
  quantity: number
  lineTotal: number
  exact: boolean
}

export interface StoreBasket {
  store: Store
  /** Sum of every item found in this store. */
  total: number
  /** Sum of the items found in every compared store — the fair comparison. */
  commonTotal: number
  lines: BasketLine[]
  missing: BasketItem[]
  /** How much more than the cheapest store, on the common items. */
  extra: number
}

export interface BasketComparison {
  baskets: StoreBasket[]
  /** Stores with no prices at all (not loaded yet). */
  storesWithoutData: Store[]
  commonItemIds: string[]
  /** Cheapest vs most expensive store on the common items. */
  maxSavings: number
}

export function compareBaskets(items: BasketItem[], stores: Store[], matches: BasketMatch[]): BasketComparison {
  const byStore = new Map<number, Map<string, BasketMatch>>()
  for (const m of matches) {
    if (!byStore.has(m.store_id)) byStore.set(m.store_id, new Map())
    byStore.get(m.store_id)!.set(m.item_id, m)
  }

  const withData = stores.filter((s) => byStore.has(s.id))
  const storesWithoutData = stores.filter((s) => !byStore.has(s.id))
  const commonItemIds = items
    .filter((i) => withData.length > 0 && withData.every((s) => byStore.get(s.id)!.has(i.id)))
    .map((i) => i.id)
  const common = new Set(commonItemIds)

  const baskets = withData.map((store) => {
    const found = byStore.get(store.id)!
    const lines: BasketLine[] = []
    const missing: BasketItem[] = []
    let total = 0
    let commonTotal = 0
    for (const item of items) {
      const match = found.get(item.id)
      if (!match) {
        missing.push(item)
        continue
      }
      const line = toAgorot(Number(match.price) * item.quantity)
      total += line
      if (common.has(item.id)) commonTotal += line
      lines.push({
        itemId: item.id,
        itemName: item.name,
        productName: match.product_name,
        barcode: match.barcode,
        price: Number(match.price),
        quantity: item.quantity,
        lineTotal: fromAgorot(line),
        exact: match.exact,
      })
    }
    return { store, total: fromAgorot(total), commonTotal: fromAgorot(commonTotal), lines, missing, extra: 0 }
  })

  baskets.sort((a, b) => a.commonTotal - b.commonTotal || a.missing.length - b.missing.length || a.total - b.total)
  const cheapest = baskets[0]?.commonTotal ?? 0
  for (const b of baskets) b.extra = fromAgorot(toAgorot(b.commonTotal) - toAgorot(cheapest))
  const maxSavings = baskets.length ? baskets[baskets.length - 1].extra : 0

  return { baskets, storesWithoutData, commonItemIds, maxSavings }
}
