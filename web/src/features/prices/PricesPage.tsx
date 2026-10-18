import { useMemo, useState } from 'react'
import { ChevronDown, Link2, Trophy } from 'lucide-react'
import type { ListItem } from '@/lib/db-types'
import { formatILS } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { useDefaultList, useListItems } from '@/features/shopping/hooks'
import { ProductPickerSheet } from './components/ProductPickerSheet'
import { useBasketMatches, useChains, useLastIngest, useLinkItem, useStores } from './hooks'
import { compareBaskets } from './lib/basket'

export function PricesPage() {
  const list = useDefaultList()
  const items = useListItems(list.data?.id)
  const stores = useStores()
  const chains = useChains()
  const lastIngest = useLastIngest()
  const open = useMemo(() => (items.data ?? []).filter((i) => !i.checked), [items.data])
  const version = open.map((i) => `${i.id}:${i.barcode ?? ''}:${i.quantity}`).join(',')
  const matches = useBasketMatches(list.data?.id, version)
  const linkItem = useLinkItem(list.data?.id ?? '')
  const [expanded, setExpanded] = useState<number | null>(null)
  const [picking, setPicking] = useState<ListItem | null>(null)

  const chainName = useMemo(() => new Map((chains.data ?? []).map((c) => [c.id, c.name])), [chains.data])
  const comparison = useMemo(
    () => compareBaskets(open, stores.data ?? [], matches.data ?? []),
    [open, stores.data, matches.data],
  )

  if (list.isPending || items.isPending || stores.isPending) return <Loading />
  if (stores.error) return <ErrorBox error={stores.error} />

  if ((stores.data ?? []).length === 0) {
    return (
      <EmptyState icon="🏪" title="עוד אין נתוני מחירים">
        המחירים נטענים פעם ביום מקובצי שקיפות המחירים של הרשתות (GitHub Actions). אחרי ההרצה הראשונה
        הסניפים בבאר שבע יופיעו כאן. ההוראות ב-docs/setup.md.
      </EmptyState>
    )
  }
  if (open.length === 0) {
    return (
      <EmptyState icon="🧺" title="הרשימה ריקה">
        מוסיפים פריטים לרשימת הקניות, ופה רואים איפה הסל הכי זול.
      </EmptyState>
    )
  }

  const best = comparison.baskets[0]

  return (
    <div className="space-y-4 pb-8">
      {matches.isPending ? (
        <Loading />
      ) : matches.error ? (
        <ErrorBox error={matches.error} />
      ) : best ? (
        <Card className="space-y-1 bg-brand-50 dark:bg-brand-800/20">
          <p className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-100">
            <Trophy size={16} />
            הכי משתלם עכשיו
          </p>
          <p className="text-lg font-semibold">
            {chainName.get(best.store.chain_id)} · {best.store.name}
          </p>
          {comparison.maxSavings > 0 && (
            <p className="text-sm text-ink-2">
              חיסכון של עד <span className="num font-semibold">{formatILS(comparison.maxSavings)}</span> על{' '}
              {comparison.commonItemIds.length} פריטים שנמצאו בכל הסניפים
            </p>
          )}
        </Card>
      ) : null}

      <ul className="space-y-2">
        {comparison.baskets.map((b, index) => (
          <li key={b.store.id} className="rounded-2xl border border-line bg-surface">
            <button
              type="button"
              onClick={() => setExpanded(expanded === b.store.id ? null : b.store.id)}
              className="flex w-full items-center gap-3 p-3 text-start"
            >
              <span
                className={cn(
                  'num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
                  index === 0 ? 'bg-brand-700 text-white' : 'bg-surface-2 text-ink-2',
                )}
              >
                {index + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{chainName.get(b.store.chain_id) ?? b.store.chain_id}</span>
                <span className="block truncate text-xs text-ink-3">{b.store.name}</span>
              </span>
              <span className="text-end">
                <span className="num block font-semibold">{formatILS(b.commonTotal)}</span>
                <span className={cn('block text-xs', b.extra > 0 ? 'num text-rose-600' : 'text-emerald-600')}>
                  {b.extra > 0 ? `+${formatILS(b.extra)}` : 'הזול ביותר'}
                </span>
              </span>
              <ChevronDown size={18} className={cn('text-ink-3 transition-transform', expanded === b.store.id && 'rotate-180')} />
            </button>
            {expanded === b.store.id && (
              <div className="space-y-2 border-t border-line p-3 text-sm">
                <ul className="space-y-1">
                  {b.lines.map((line) => (
                    <li key={line.itemId} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">
                        {line.exact ? '' : '≈ '}
                        {line.productName}
                        {line.quantity !== 1 && <span className="num ms-1 text-ink-3">×{line.quantity}</span>}
                      </span>
                      <span className="num text-ink-2">{formatILS(line.lineTotal)}</span>
                    </li>
                  ))}
                </ul>
                {b.missing.length > 0 && (
                  <p className="text-rose-600">לא נמצא: {b.missing.map((m) => m.name).join(', ')}</p>
                )}
                <p className="text-ink-3">
                  סה"כ כל מה שנמצא: <span className="num">{formatILS(b.total)}</span>
                </p>
              </div>
            )}
          </li>
        ))}
      </ul>

      {comparison.storesWithoutData.length > 0 && (
        <p className="text-xs text-ink-3">
          אין מחירים עדיין עבור: {comparison.storesWithoutData.map((s) => s.name).join(', ')}
        </p>
      )}

      <Card className="space-y-2">
        <h2 className="font-semibold">דיוק ההשוואה</h2>
        <p className="text-sm text-ink-2">
          פריטים בלי קישור מושווים לפי שם (≈). קישור למוצר מדויק משפר את ההשוואה.
        </p>
        <ul className="divide-y divide-line">
          {open.map((item) => (
            <li key={item.id} className="flex items-center gap-2 py-2">
              <span className="flex-1">{item.name}</span>
              <Button variant={item.barcode ? 'ghost' : 'secondary'} size="sm" onClick={() => setPicking(item)}>
                <Link2 size={14} />
                {item.barcode ? 'מקושר' : 'קישור'}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      {lastIngest.data?.finished_at && (
        <p className="text-center text-xs text-ink-3">
          מחירים עודכנו: {new Date(lastIngest.data.finished_at).toLocaleString('he-IL')}
        </p>
      )}

      {picking && (
        <ProductPickerSheet
          itemName={picking.name}
          currentBarcode={picking.barcode}
          onPick={(barcode) => linkItem.mutate({ item: picking, barcode })}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}
