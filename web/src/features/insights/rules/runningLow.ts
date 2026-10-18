import { diffDays } from '@/lib/dates'
import type { InsightRule } from '../types'

/** Items bought regularly whose usual interval has passed since the last purchase. */
export const runningLow: InsightRule = {
  id: 'running-low',
  evaluate: ({ today, frequentItems, listItems }) => {
    const onList = new Set(listItems.filter((i) => !i.checked).map((i) => i.name.trim().toLowerCase()))
    const due = frequentItems
      .filter((f) => f.times_bought >= 3 && !onList.has(f.normalized_name))
      .map((f) => {
        const span = diffDays(f.last_bought_at.slice(0, 10), f.first_bought_at.slice(0, 10))
        const interval = span / (f.times_bought - 1)
        const since = diffDays(today, f.last_bought_at.slice(0, 10))
        return { f, interval, since, ratio: interval > 0 ? since / interval : 0 }
      })
      .filter((x) => x.interval >= 2 && x.ratio >= 1)
      .sort((a, b) => b.ratio - a.ratio)
      .slice(0, 5)
    if (due.length === 0) return []

    const [first] = due
    return [
      {
        id: `running-low:${due.map((d) => d.f.normalized_name).join(',')}`,
        tone: 'tip',
        icon: '🧺',
        title:
          due.length === 1
            ? `כנראה נגמר לכם ${first.f.name}`
            : `כנראה נגמרים לכם: ${due.map((d) => d.f.name).join(', ')}`,
        body:
          due.length === 1
            ? `בדרך כלל קונים כל ${Math.round(first.interval)} ימים, והפעם האחרונה הייתה לפני ${first.since} ימים.`
            : 'לפי הקצב שבו אתם קונים אותם בדרך כלל.',
        link: { to: '/shopping', label: 'לרשימה' },
        priority: 60,
      },
    ]
  },
}
