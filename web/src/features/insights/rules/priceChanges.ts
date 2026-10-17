import { formatILS } from '@/lib/money'
import type { Insight, InsightRule } from '../types'

/** Notable price moves (last 30 days) on products the household buys. */
export const priceChanges: InsightRule = {
  id: 'price-changes',
  evaluate: ({ priceChanges, stores }) => {
    const storeName = new Map(stores.map((s) => [s.id, s.name]))
    const byProduct = new Map<string, (typeof priceChanges)[number] & { pct: number }>()
    for (const c of priceChanges) {
      const pct = Math.round(((Number(c.new_price) - Number(c.old_price)) / Number(c.old_price)) * 100)
      const current = byProduct.get(c.barcode)
      if (!current || Math.abs(pct) > Math.abs(current.pct)) byProduct.set(c.barcode, { ...c, pct })
    }
    const insights: Insight[] = []
    for (const c of [...byProduct.values()].sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct))) {
      if (c.pct >= 5 && insights.filter((i) => i.tone === 'warning').length < 3) {
        insights.push({
          id: `price-up:${c.barcode}`,
          tone: 'warning',
          icon: '🏷️',
          title: `${c.product_name} התייקר ב-${c.pct}%`,
          body: `ב${storeName.get(c.store_id) ?? 'סניף'}: ${formatILS(Number(c.old_price))} ← ${formatILS(Number(c.new_price))}. כדאי לבדוק בהשוואת הסלים.`,
          link: { to: '/prices', label: 'להשוואה' },
          priority: 45,
        })
      } else if (c.pct <= -10 && insights.filter((i) => i.tone === 'good').length < 2) {
        insights.push({
          id: `price-down:${c.barcode}`,
          tone: 'good',
          icon: '🎉',
          title: `${c.product_name} הוזל ב-${-c.pct}%`,
          body: `ב${storeName.get(c.store_id) ?? 'סניף'}: עכשיו ${formatILS(Number(c.new_price))}.`,
          priority: 30,
        })
      }
    }
    return insights
  },
}
