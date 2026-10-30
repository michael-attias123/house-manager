import { fromAgorot, toAgorot } from '@/lib/money'

export type SplitInput =
  /** Equal parts between the participants. */
  | { type: 'equal'; participants: string[] }
  /** Percent per member; should total 100. */
  | { type: 'percent'; percents: Record<string, number> }
  /** Exact amount per member; should total the expense amount. */
  | { type: 'exact'; amounts: Record<string, number> }
  /** One member owes everything (e.g. "I paid for you"). */
  | { type: 'full'; owedBy: string }
  /** The household's default ratio (household_members.default_share_pct). */
  | { type: 'default'; weights: Record<string, number> }

export type Shares = Record<string, number>

/**
 * Splits `amount` (shekels) into per-member shares, exact to the agora.
 * The rounding remainder goes to the payer when they take part, otherwise to
 * the member with the largest weight — same rule as default_shares() in SQL.
 */
export function computeShares(amount: number, payer: string, input: SplitInput): Shares {
  const total = toAgorot(amount)

  if (input.type === 'exact') {
    return Object.fromEntries(
      Object.entries(input.amounts).map(([id, value]) => [id, fromAgorot(toAgorot(value))]),
    )
  }
  if (input.type === 'full') return { [input.owedBy]: fromAgorot(total) }

  const weights: Record<string, number> =
    input.type === 'equal'
      ? Object.fromEntries(input.participants.map((id) => [id, 1]))
      : input.type === 'percent'
        ? input.percents
        : input.weights

  const entries = Object.entries(weights).filter(([, w]) => w > 0)
  const weightSum = entries.reduce((sum, [, w]) => sum + w, 0)
  if (entries.length === 0 || weightSum === 0) return { [payer]: fromAgorot(total) }

  const agorot: Record<string, number> = {}
  let allocated = 0
  for (const [id, w] of entries) {
    agorot[id] = Math.floor((total * w) / weightSum)
    allocated += agorot[id]
  }
  const remainderTo =
    payer in agorot ? payer : [...entries].sort((a, b) => b[1] - a[1])[0][0]
  agorot[remainderTo] += total - allocated

  return Object.fromEntries(Object.entries(agorot).map(([id, a]) => [id, fromAgorot(a)]))
}

/** Returns a Hebrew error message, or null if the split is valid. */
export function validateSplit(amount: number, input: SplitInput): string | null {
  if (!(amount > 0)) return 'צריך סכום גדול מאפס'
  switch (input.type) {
    case 'equal':
      return input.participants.length ? null : 'צריך לבחור לפחות משתתף אחד'
    case 'percent': {
      const sum = Object.values(input.percents).reduce((s, v) => s + (v || 0), 0)
      return Math.abs(sum - 100) < 0.001 ? null : `האחוזים מסתכמים ב-${sum}% ולא ב-100%`
    }
    case 'exact': {
      const sum = Object.values(input.amounts).reduce((s, v) => s + toAgorot(v || 0), 0)
      const diff = fromAgorot(toAgorot(amount) - sum)
      if (diff === 0) return null
      return diff > 0 ? `חסרים ₪${diff.toFixed(2)}` : `יש עודף של ₪${(-diff).toFixed(2)}`
    }
    default:
      return null
  }
}
