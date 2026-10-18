import type { InsightRule } from '../types'
import { billSpike, fixedCosts, overdueBills } from './bills'
import { choreBalance, compareBeforeShopping, settleUp } from './household'
import { priceChanges } from './priceChanges'
import { runningLow } from './runningLow'
import { spendingPace } from './spendingPace'

/** Every active insight rule. New rule = new file + one line here. */
export const INSIGHT_RULES: InsightRule[] = [
  overdueBills,
  billSpike,
  spendingPace,
  runningLow,
  settleUp,
  priceChanges,
  choreBalance,
  compareBeforeShopping,
  fixedCosts,
]
