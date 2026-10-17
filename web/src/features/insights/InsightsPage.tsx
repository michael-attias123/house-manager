import { useMemo } from 'react'
import { monthKey } from '@/lib/dates'
import { Card, CardTitle } from '@/components/ui/Card'
import { EmptyState, Loading } from '@/components/ui/Feedback'
import { CategoryBreakdown } from './components/CategoryBreakdown'
import { InsightCard } from './components/InsightCard'
import { MonthlyTrend } from './components/MonthlyTrend'
import { runInsightRules } from './engine'
import { lastMonths, totalsByCategory, totalsByMonth } from './lib/aggregate'
import { INSIGHT_RULES } from './rules'
import { useInsightData } from './useInsightData'

export function InsightsPage() {
  const { data, isPending } = useInsightData()
  const insights = useMemo(() => (data ? runInsightRules(INSIGHT_RULES, data) : []), [data])
  const trend = useMemo(() => (data ? totalsByMonth(data.expenses, lastMonths(data.today, 6)) : []), [data])
  const categories = useMemo(
    () => (data ? totalsByCategory(data.expenses, (d) => monthKey(d) === monthKey(data.today)) : {}),
    [data],
  )

  if (isPending || !data) return <Loading />

  return (
    <div className="space-y-4 pb-8">
      <section className="space-y-2">
        {insights.length === 0 ? (
          <EmptyState icon="🔍" title="עוד אין מספיק נתונים">
            ככל שתשתמשו ברשימה, בהתחשבנות ובחשבונות — יופיעו כאן תובנות לחיסכון.
          </EmptyState>
        ) : (
          insights.map((insight) => <InsightCard key={insight.id} insight={insight} />)
        )}
      </section>
      <Card className="space-y-3">
        <CardTitle>הוצאות הבית לפי חודש</CardTitle>
        <MonthlyTrend data={trend} />
      </Card>
      <Card className="space-y-3">
        <CardTitle>לאן הלך הכסף החודש</CardTitle>
        <CategoryBreakdown totals={categories} />
      </Card>
    </div>
  )
}
