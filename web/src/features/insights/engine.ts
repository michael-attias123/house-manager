import type { Insight, InsightData, InsightRule } from './types'

export function runInsightRules(rules: InsightRule[], data: InsightData): Insight[] {
  const insights: Insight[] = []
  for (const rule of rules) {
    try {
      insights.push(...rule.evaluate(data))
    } catch (err) {
      // A broken rule must not take the page down.
      console.error(`insight rule ${rule.id} failed`, err)
    }
  }
  return insights.sort((a, b) => b.priority - a.priority)
}
