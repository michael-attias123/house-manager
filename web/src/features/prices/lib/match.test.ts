import type { MatchCandidate, PackUnit } from '@/lib/db-types'
import { buildRequest, choosePack, resolveItem, weightInKg, type BasketItem } from './match'
import { normName, formatPack, packsMatch } from './normalize'

const item = (name: string, extra: Partial<BasketItem> = {}): BasketItem => ({
  id: name,
  name,
  quantity: 1,
  unit: null,
  barcode: null,
  ...extra,
})

const row = (
  store_id: number,
  product_name: string,
  price: number,
  pack: [PackUnit, number] | null,
  extra: Partial<MatchCandidate> = {},
): MatchCandidate => ({
  item_id: 'x',
  tier: 1,
  store_id,
  barcode: `${store_id}-${product_name}`,
  product_name,
  price,
  pack_unit: pack?.[0] ?? null,
  pack_qty: pack?.[1] ?? null,
  is_weighted: false,
  ...extra,
})

describe('normName', () => {
  it('matches the SQL rules', () => {
    expect(normName('קמח לבן 1 ק"ג.')).toBe('קמח לבן 1 קג')
    expect(normName('18ביצים L מ.לסר.')).toBe('18 ביצים l מ לסר')
    expect(normName('טונה 4*160גר')).toBe('טונה 4 * 160 גר')
    expect(normName('גבינה 5%250 גרם')).toBe('גבינה 5% 250 גרם')
  })
})

describe('buildRequest', () => {
  it('uses the staple for a plain item', () => {
    const req = buildRequest(item('ביצים'))
    expect(req.terms).toEqual(['ביצים'])
    expect(req.require).toContain('גדול')
    expect(req.exclude).toEqual(expect.arrayContaining(['סלט', 'קוצץ', 'אומגה']))
  })

  it('never excludes a word the item itself uses', () => {
    expect(buildRequest(item('סלט ביצים')).exclude).not.toContain('סלט')
    expect(buildRequest(item('ביצים אורגניות')).exclude).not.toContain('אורגניות')
  })

  it('keeps a variant in its staple family', () => {
    const req = buildRequest(item('חלב 1%'))
    expect(req.terms).toEqual(['חלב 1%'])
    expect(req.exclude).toContain('סויה')
    expect(req.require).toEqual([])
  })

  it('weighs produce', () => {
    expect(buildRequest(item('עגבניות')).weighted).toBe(true)
    expect(buildRequest(item('מלפפון')).terms).toContain('מלפפון')
  })
})

describe('resolveItem', () => {
  it('compares the cheapest product of the standard pack in each store', () => {
    const r = resolveItem(item('ביצים'), [
      row(1, 'ביצים אריזון 12 גדול', 14.24, ['u', 12]),
      row(1, 'ביצים 30יח גדול L', 35.5, ['u', 30]),
      row(2, 'ביצים 12 יח גדול L', 14.2, ['u', 12]),
      row(2, 'ביצים L רגילות 12 יח', 13.9, ['u', 12]),
      row(3, 'ביצים 18יח גדול L', 21.3, ['u', 18]),
    ])
    expect(r.target).toEqual({ unit: 'u', qty: 12 })
    expect(r.byStore.get(1)?.price).toBe(14.24)
    expect(r.byStore.get(2)?.productName).toBe('ביצים L רגילות 12 יח')
    // Only 18 or 30 eggs there: not the same thing, so not found.
    expect(r.byStore.has(3)).toBe(false)
  })

  it('without a staple, compares the size most stores carry', () => {
    const r = resolveItem(item('טחינה גולמית'), [
      row(1, 'טחינה גולמית 500 גרם', 15.9, ['g', 500]),
      row(2, 'טחינה גולמית 500 גר', 14.9, ['g', 500]),
      row(2, 'טחינה גולמית 1 קג', 26.9, ['g', 1000]),
      row(3, 'טחינה גולמית 480 גרם', 13.9, ['g', 480]),
    ])
    expect(r.target).toEqual({ unit: 'g', qty: 500 })
    expect(r.byStore.get(3)?.price).toBe(13.9) // 480 g is within 15%
    expect(r.byStore.get(2)?.price).toBe(14.9)
  })

  it('prices produce per kg, times the quantity', () => {
    const r = resolveItem(item('עגבניות', { quantity: 2 }), [
      row(1, 'עגבניה', 7.9, ['g', 1000], { is_weighted: true }),
      row(1, 'עגבניות 2.5 A מרוסקות 850 גרם', 9.9, ['g', 850]),
    ])
    expect(r.weighted).toBe(true)
    expect(r.byStore.get(1)).toMatchObject({ productName: 'עגבניה', multiplier: 2, lineTotal: 15.8 })
    expect(weightInKg(item('עגבניות', { quantity: 500, unit: 'גרם' }))).toBe(0.5)
  })

  it('uses the linked product, and the same size where it is not sold', () => {
    const r = resolveItem(item('חלב', { barcode: 'tnuva' }), [
      row(1, 'חלב תנובה 3% 1 ליטר', 7.35, ['ml', 1000], { tier: 0, barcode: 'tnuva' }),
      row(1, 'חלב טרי מהגולן 3% 1 ליטר', 7.2, ['ml', 1000]),
      row(2, 'חלב טרי מהגולן 3% 1 ליטר', 7.2, ['ml', 1000]),
      row(2, 'חלב 3% 2 ליטר', 13.9, ['ml', 2000]),
    ])
    expect(r.byStore.get(1)).toMatchObject({ kind: 'exact', price: 7.35 })
    expect(r.byStore.get(2)).toMatchObject({ kind: 'similar', price: 7.2 })
  })

  it('multiplies packaged items by quantity, in whole agorot', () => {
    const r = resolveItem(item('פסטה', { quantity: 3 }), [row(1, 'פסטה פוסילי 500 גר', 4.33, ['g', 500])])
    expect(r.byStore.get(1)?.lineTotal).toBe(12.99)
  })
})

describe('packs', () => {
  it('formats and compares', () => {
    expect(formatPack({ unit: 'u', qty: 12 })).toBe("12 יח'")
    expect(formatPack({ unit: 'ml', qty: 1500 })).toBe('1.5 ליטר')
    expect(formatPack({ unit: 'g', qty: 750 })).toBe('750 גרם')
    expect(formatPack(null, true)).toBe('לק"ג')
    expect(packsMatch({ unit: 'g', qty: 700 }, { unit: 'g', qty: 750 })).toBe(true)
    expect(packsMatch({ unit: 'g', qty: 500 }, { unit: 'g', qty: 750 })).toBe(false)
    expect(packsMatch({ unit: 'ml', qty: 750 }, { unit: 'g', qty: 750 })).toBe(false)
  })

  it('choosePack prefers the most stores, then the more common size', () => {
    expect(
      choosePack(
        [row(1, 'a', 1, ['g', 500]), row(2, 'b', 1, ['g', 500]), row(1, 'c', 1, ['g', 1000])],
        null,
      ),
    ).toEqual({ unit: 'g', qty: 500 })
    expect(choosePack([], { unit: 'u', qty: 12 })).toEqual({ unit: 'u', qty: 12 })
  })
})
