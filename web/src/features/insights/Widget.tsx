import { useMemo } from 'react'
import { InsightCard } from './components/InsightCard'
import { runInsightRules } from './engine'
import { INSIGHT_RULES } from './rules'
import { useInsightData } from './useInsightData'

/** The single most important insight, on the home dashboard. */
export function InsightsWidget() {
  const { data } = useInsightData()
  const top = useMemo(() => (data ? runInsightRules(INSIGHT_RULES, data)[0] : undefined), [data])
  return top ? <InsightCard insight={top} /> : null
}
