import type { Store } from '@/lib/db-types'
import { fromAgorot, toAgorot } from '@/lib/money'
import type { BasketItem, ItemMatch, ItemResolution } from './match'

export interface BasketLine {
  item: BasketItem
  /** What this store sells for the item; null when it doesn't (estimated). */
  match: ItemMatch | null
  /** The store doesn't carry it: priced at the median of the stores that do. */
  estimated: boolean
  lineTotal: number
}

export interface StoreBasket {
  store: Store
  /** One line per compared item, found or estimated; they add up to `total`. */
  lines: BasketLine[]
  total: number
  found: number
}

export interface ChainBasket {
  chainId: string
  /** The cheapest branch. */
  best: StoreBasket
  /** Every branch, cheapest first. */
  branches: StoreBasket[]
  /** How much more than the cheapest chain. */
  extra: number
}

export interface BasketComparison {
  chains: ChainBasket[]
  /** Items found in at least one store: these are what every basket prices. */
  compared: BasketItem[]
  /** Items no store sells (or that match nothing): left out of every total. */
  notFound: BasketItem[]
  /** Cheapest vs most expensive chain. */
  maxSavings: number
}

function medianAgorot(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

const byTotal = (a: StoreBasket, b: StoreBasket) =>
  a.total - b.total || b.found - a.found || a.store.name.localeCompare(b.store.name, 'he')

/**
 * Prices the same basket in every store. An item a store doesn't sell counts
 * at the median price of the stores that do, so a store never looks cheap
 * just for missing things, and every total is exactly the sum of its lines.
 */
export function compareBaskets(resolutions: ItemResolution[], stores: Store[]): BasketComparison {
  const compared = resolutions.filter((r) => r.byStore.size > 0)
  const notFound = resolutions.filter((r) => r.byStore.size === 0).map((r) => r.item)
  const median = new Map(
    compared.map((r) => [r.item.id, medianAgorot([...r.byStore.values()].map((m) => toAgorot(m.lineTotal)))]),
  )

  const baskets: StoreBasket[] = []
  for (const store of stores) {
    let total = 0
    let found = 0
    const lines = compared.map((r): BasketLine => {
      const match = r.byStore.get(store.id) ?? null
      const agorot = match ? toAgorot(match.lineTotal) : median.get(r.item.id)!
      total += agorot
      if (match) found++
      return { item: r.item, match, estimated: !match, lineTotal: fromAgorot(agorot) }
    })
    // A store that has none of the items has nothing to compare.
    if (found > 0) baskets.push({ store, lines, total: fromAgorot(total), found })
  }

  const byChain = new Map<string, StoreBasket[]>()
  for (const b of baskets) byChain.set(b.store.chain_id, [...(byChain.get(b.store.chain_id) ?? []), b])
  const chains = [...byChain].map(([chainId, branches]) => {
    branches.sort(byTotal)
    return { chainId, best: branches[0], branches, extra: 0 }
  })
  chains.sort((a, b) => byTotal(a.best, b.best))
  const cheapest = toAgorot(chains[0]?.best.total ?? 0)
  for (const c of chains) c.extra = fromAgorot(toAgorot(c.best.total) - cheapest)

  return {
    chains,
    compared: compared.map((r) => r.item),
    notFound,
    maxSavings: chains.length ? chains[chains.length - 1].extra : 0,
  }
}
