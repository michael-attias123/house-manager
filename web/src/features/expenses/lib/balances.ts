import { fromAgorot, toAgorot } from '@/lib/money'

export interface Transfer {
  from: string
  to: string
  amount: number
}

/**
 * Turns net balances (positive = is owed money) into the fewest transfers
 * that settle everyone. With two people this is a single transfer.
 */
export function simplifyDebts(balances: Record<string, number>): Transfer[] {
  const creditors: [string, number][] = []
  const debtors: [string, number][] = []
  for (const [id, balance] of Object.entries(balances)) {
    const a = toAgorot(balance)
    if (a > 0) creditors.push([id, a])
    else if (a < 0) debtors.push([id, -a])
  }
  creditors.sort((a, b) => b[1] - a[1])
  debtors.sort((a, b) => b[1] - a[1])

  const transfers: Transfer[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const amount = Math.min(debtors[i][1], creditors[j][1])
    transfers.push({ from: debtors[i][0], to: creditors[j][0], amount: fromAgorot(amount) })
    debtors[i][1] -= amount
    creditors[j][1] -= amount
    if (debtors[i][1] === 0) i++
    if (creditors[j][1] === 0) j++
  }
  return transfers
}
