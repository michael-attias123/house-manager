import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { useChains } from '@/features/prices/hooks'
import type { IngestRun } from '@/lib/db-types'
import { useIngestRuns } from '../hooks'
import { formatDateTime, INGEST_STATUS_LABELS, ingestErrorLabel, summarizeIngest } from '../lib/admin'
import { Count, Tag, type TagTone } from './Tag'

const STATUS_TONE: Record<IngestRun['status'], TagTone> = {
  ok: 'brand',
  partial: 'warn',
  failed: 'danger',
  running: 'neutral',
}

export function IngestRuns() {
  const runs = useIngestRuns()
  const chains = useChains()
  const chainName = (id: string) => chains.data?.find((c) => c.id === id)?.name ?? id

  if (runs.isPending) return <Loading />
  if (runs.error) return <ErrorBox error={runs.error} />
  if (runs.data.length === 0) return <EmptyState icon="🛒" title="עוד לא היו עדכונים" />

  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
      {runs.data.map((run) => {
        const summary = summarizeIngest(run.stats)
        return (
          <li key={run.id} className="space-y-1 px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Tag tone={STATUS_TONE[run.status]}>{INGEST_STATUS_LABELS[run.status]}</Tag>
              <span className="num text-sm">{formatDateTime(run.started_at)}</span>
            </div>
            {run.status !== 'running' && (
              <p className="text-sm text-ink-2">
                <Count n={summary.storesOk} one="סניף" many="סניפים" /> ·{' '}
                <Count n={summary.items} one="מוצר" many="מוצרים" />
              </p>
            )}
            {summary.problems.length > 0 && (
              <ul className="space-y-0.5 text-xs text-ink-3">
                {summary.problems.map((p, i) => (
                  <li key={i}>
                    {chainName(p.chain)}
                    {p.store && ` · ${p.store}`}: {ingestErrorLabel(p.error)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        )
      })}
    </ul>
  )
}
