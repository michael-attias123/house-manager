import type { MatchCandidate } from '@/lib/db-types'
import { fromAgorot, toAgorot } from '@/lib/money'
import { hasWords, normName, packsMatch, type Pack } from './normalize'
import { findStaple, findStapleFamily, GENERIC_EXCLUDE } from './staples'

/** A shopping-list item as the comparison sees it. */
export interface BasketItem {
  id: string
  name: string
  quantity: number
  unit: string | null
  barcode: string | null
}

/** What match_candidates is asked for one item. */
export interface MatchRequest {
  id: string
  terms: string[]
  exclude: string[]
  require: string[]
  weighted: boolean | null
  barcode: string | null
}

/** How a store's product was chosen for an item. */
export type MatchKind =
  /** The linked product itself. */
  | 'exact'
  /** The linked product is not sold there: same kind and size instead. */
  | 'similar'
  /** Not linked: the cheapest product of this kind and size. */
  | 'cheapest'

export interface ItemMatch {
  itemId: string
  storeId: number
  barcode: string
  productName: string
  price: number
  pack: Pack | null
  weighted: boolean
  kind: MatchKind
  /** Packs (or kg for weighted products) this line pays for. */
  multiplier: number
  lineTotal: number
}

export interface ItemResolution {
  item: BasketItem
  /** The pack size compared in every store, if one was found. */
  target: Pack | null
  weighted: boolean
  /** Store id → chosen product. */
  byStore: Map<number, ItemMatch>
}

/** Builds the match_candidates request: terms, excluded words, required words. */
export function buildRequest(item: BasketItem): MatchRequest {
  const name = normName(item.name)
  const staple = findStaple(name)
  const family = staple ?? findStapleFamily(name)
  // A word the item itself uses is never excluded ("סלט ביצים" may match salads).
  const exclude = [...GENERIC_EXCLUDE, ...(family?.exclude ?? [])]
    .map(normName)
    .filter((w) => !hasWords(name, w))
  return {
    id: item.id,
    terms: staple?.terms ?? [item.name],
    exclude: [...new Set(exclude)],
    require: staple?.require ?? [],
    weighted: family?.weighted ?? null,
    barcode: item.barcode,
  }
}

const GRAM_UNITS = new Set(['גרם', 'גר', 'ג', 'g'])

/** kg to price a weighted product at: the quantity, in kg unless the unit says grams. */
export function weightInKg(item: BasketItem): number {
  return GRAM_UNITS.has(normName(item.unit ?? '')) ? item.quantity / 1000 : item.quantity
}

const storesWith = (rows: MatchCandidate[]) => new Set(rows.map((c) => c.store_id)).size

const packOf = (c: MatchCandidate): Pack | null =>
  c.pack_unit && c.pack_qty != null ? { unit: c.pack_unit, qty: Number(c.pack_qty) } : null

/**
 * The pack size to compare: the staple's, the linked product's, or the size
 * most stores carry, counting sizes within 15% as one (ties: the more common
 * size, then the smaller one).
 */
export function choosePack(candidates: MatchCandidate[], preferred: Pack | null): Pack | null {
  if (preferred) return preferred
  const byKey = new Map<string, { pack: Pack; stores: Set<number>; rows: number }>()
  for (const c of candidates) {
    const pack = packOf(c)
    if (!pack) continue
    const key = `${pack.unit}:${pack.qty}`
    const entry = byKey.get(key) ?? { pack, stores: new Set(), rows: 0 }
    entry.stores.add(c.store_id)
    entry.rows++
    byKey.set(key, entry)
  }
  // Count a size's neighbours within tolerance too: 700 g and 750 g bread are one size.
  const scored = [...byKey.values()].map((e) => {
    const stores = new Set<number>()
    let rows = 0
    for (const other of byKey.values()) {
      if (packsMatch(other.pack, e.pack)) {
        other.stores.forEach((s) => stores.add(s))
        rows += other.rows
      }
    }
    return { pack: e.pack, stores: stores.size, rows, own: e.stores.size }
  })
  // Among equal neighbourhoods, the size itself sold in the most stores.
  scored.sort(
    (a, b) => b.stores - a.stores || b.rows - a.rows || b.own - a.own || a.pack.qty - b.pack.qty,
  )
  return scored[0]?.pack ?? null
}

/** Picks, per store, what this item costs there. */
export function resolveItem(item: BasketItem, candidates: MatchCandidate[]): ItemResolution {
  const name = normName(item.name)
  const staple = findStaple(name)
  const family = staple ?? findStapleFamily(name)
  const exact = candidates.filter((c) => c.tier === 0)
  const others = candidates.filter((c) => c.tier !== 0)
  const linked = exact[0]
  const packaged = others.filter((c) => !c.is_weighted)
  const packTarget = choosePack(packaged, linked ? packOf(linked) : (staple?.pack ?? null))
  // Sold by weight or in packs: as linked, as the staple says, or whichever more stores have.
  const weighted = linked
    ? linked.is_weighted
    : (family?.weighted ??
      storesWith(others.filter((c) => c.is_weighted)) >
        storesWith(packaged.filter((c) => packsMatch(packOf(c), packTarget))))
  const target = weighted ? null : packTarget
  const multiplier = weighted ? weightInKg(item) : item.quantity

  const byStore = new Map<number, ItemMatch>()
  const consider = (c: MatchCandidate, kind: MatchKind) => {
    if (c.is_weighted !== weighted) return
    if (!weighted && !packsMatch(packOf(c), target)) return
    const current = byStore.get(c.store_id)
    if (current && (current.kind === 'exact' || Number(current.price) <= Number(c.price))) return
    const price = Number(c.price)
    byStore.set(c.store_id, {
      itemId: item.id,
      storeId: c.store_id,
      barcode: c.barcode,
      productName: c.product_name,
      price,
      pack: packOf(c),
      weighted: c.is_weighted,
      kind,
      multiplier,
      lineTotal: fromAgorot(toAgorot(price * multiplier)),
    })
  }
  for (const c of exact) consider(c, 'exact')
  for (const c of others) {
    if (byStore.get(c.store_id)?.kind === 'exact') continue
    consider(c, item.barcode ? 'similar' : 'cheapest')
  }
  return { item, target, weighted, byStore }
}
