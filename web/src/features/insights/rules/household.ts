import { addDays } from '@/lib/dates'
import { formatILS } from '@/lib/money'
import { simplifyDebts } from '@/features/expenses/lib/balances'
import type { InsightRule } from '../types'

export const settleUp: InsightRule = {
  id: 'settle-up',
  evaluate: ({ balances, members, userId }) => {
    const [transfer] = simplifyDebts(balances)
    if (!transfer || transfer.amount < 300) return []
    const name = (id: string) => members.find((m) => m.user_id === id)?.display_name ?? ''
    return [
      {
        id: 'settle-up',
        tone: 'tip',
        icon: '🤝',
        title: `היתרה ביניכם הגיעה ל-${formatILS(transfer.amount)}`,
        body:
          transfer.to === userId
            ? `העברה מ${name(transfer.from)} (ביט / פייבוקס) תאפס את היתרה.`
            : `העברה ל${name(transfer.to)} תאפס את היתרה.`,
        link: { to: '/expenses', label: 'לסגירת חשבון' },
        priority: 50,
      },
    ]
  },
}

/** One partner doing most of the chores lately. */
export const choreBalance: InsightRule = {
  id: 'chore-balance',
  evaluate: ({ today, completions, members }) => {
    if (members.length < 2) return []
    const since = addDays(today, -30)
    const recent = completions.filter((c) => c.done_on >= since)
    if (recent.length < 6) return []
    const counts = new Map<string, number>()
    for (const c of recent) counts.set(c.done_by, (counts.get(c.done_by) ?? 0) + 1)
    const [topId, top] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    const share = Math.round((top / recent.length) * 100)
    if (share < 65) return []
    const name = members.find((m) => m.user_id === topId)?.display_name ?? ''
    return [
      {
        id: 'chore-balance',
        tone: 'tip',
        icon: '⚖️',
        title: `${share}% מהמטלות בחודש האחרון בוצעו ע״י ${name}`,
        body: 'אולי להעביר כמה מטלות לתורנות?',
        link: { to: '/chores', label: 'למטלות' },
        priority: 40,
      },
    ]
  },
}

export const compareBeforeShopping: InsightRule = {
  id: 'compare-before-shopping',
  evaluate: ({ listItems, stores }) => {
    const open = listItems.filter((i) => !i.checked).length
    if (open < 8 || stores.length < 2) return []
    return [
      {
        id: 'compare-before-shopping',
        tone: 'info',
        icon: '🏪',
        title: `יש ${open} פריטים ברשימה`,
        body: 'לפני שיוצאים — כדאי לבדוק באיזה סניף הסל הכי זול.',
        link: { to: '/prices', label: 'להשוואת סלים' },
        priority: 30,
      },
    ]
  },
}
