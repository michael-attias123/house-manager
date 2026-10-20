import { useMemo, useState } from 'react'
import { ChevronDown, Link2, Trophy } from 'lucide-react'
import type { ListItem, MatchCandidate, Store } from '@/lib/db-types'
import { formatILS } from '@/lib/money'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { useDefaultList, useListItems } from '@/features/shopping/hooks'
import { ProductPickerSheet } from './components/ProductPickerSheet'
import { useChains, useLastIngest, useLinkItem, useMatchCandidates, useStores } from './hooks'
import { compareBaskets, type BasketLine, type ChainBasket } from './lib/basket'
import { buildRequest, resolveItem, type BasketItem, type ItemResolution } from './lib/match'
import { formatPack } from './lib/normalize'

const toBasketItem = (i: ListItem): BasketItem => ({
  id: i.id,
  name: i.name,
  quantity: i.quantity,
  unit: i.unit,
  barcode: i.barcode,
})

export function PricesPage() {
  const list = useDefaultList()
  const items = useListItems(list.data?.id)
  const stores = useStores()
  const chains = useChains()
  const lastIngest = useLastIngest()
  const open = useMemo(() => (items.data ?? []).filter((i) => !i.checked).map(toBasketItem), [items.data])
  const requests = useMemo(() => open.map(buildRequest), [open])
  const candidates = useMatchCandidates(requests)
  const linkItem = useLinkItem(list.data?.id ?? '')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [picking, setPicking] = useState<ItemResolution | null>(null)

  const chainName = useMemo(() => new Map((chains.data ?? []).map((c) => [c.id, c.name])), [chains.data])
  const resolutions = useMemo(() => {
    const byItem = new Map<string, MatchCandidate[]>()
    for (const c of candidates.data ?? []) byItem.set(c.item_id, [...(byItem.get(c.item_id) ?? []), c])
    return open.map((item) => resolveItem(item, byItem.get(item.id) ?? []))
  }, [open, candidates.data])
  const comparison = useMemo(() => compareBaskets(resolutions, stores.data ?? []), [resolutions, stores.data])

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

  const best = comparison.chains[0]
  const total = comparison.compared.length

  return (
    <div className="space-y-4 pb-8">
      {candidates.isPending ? (
        <Loading />
      ) : candidates.error ? (
        <ErrorBox error={candidates.error} />
      ) : best ? (
        <Card className="space-y-1 bg-brand-50 dark:bg-brand-800/20">
          <p className="flex items-center gap-2 text-sm text-brand-800 dark:text-brand-100">
            <Trophy size={16} />
            הכי משתלם עכשיו
          </p>
          <p className="text-lg font-semibold">
            {chainName.get(best.chainId) ?? best.chainId} · {best.best.store.name}
          </p>
          <p className="text-sm text-ink-2">
            הסל: <span className="num font-semibold">{formatILS(best.best.total)}</span>
            {comparison.maxSavings > 0 && (
              <>
                {' '}
                · חיסכון של עד <span className="num font-semibold">{formatILS(comparison.maxSavings)}</span>
              </>
            )}
          </p>
        </Card>
      ) : null}

      <ul className="space-y-2">
        {comparison.chains.map((chain, index) => (
          <ChainRow
            key={chain.chainId}
            chain={chain}
            rank={index + 1}
            name={chainName.get(chain.chainId) ?? chain.chainId}
            itemCount={total}
            expanded={expanded === chain.chainId}
            onToggle={() => setExpanded(expanded === chain.chainId ? null : chain.chainId)}
          />
        ))}
      </ul>

      {comparison.notFound.length > 0 && (
        <p className="text-sm text-ink-2">
          לא נמצאו באף סניף, ולכן לא בסכום: {comparison.notFound.map((i) => i.name).join(', ')}
        </p>
      )}

      <Card className="space-y-2">
        <h2 className="font-semibold">מה הושווה</h2>
        <p className="text-sm text-ink-2">
          בכל סניף נבחר המוצר הזול מאותו סוג וגודל. פריט שמקושר למוצר מסוים מושווה בדיוק לפיו.
        </p>
        <ul className="divide-y divide-line">
          {resolutions.map((r) => (
            <li key={r.item.id} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1">
                <span className="block">{r.item.name}</span>
                <span className="block truncate text-xs text-ink-3">{describe(r, best?.best.store)}</span>
              </span>
              <Button variant={r.item.barcode ? 'ghost' : 'secondary'} size="sm" onClick={() => setPicking(r)}>
                <Link2 size={14} />
                {r.item.barcode ? 'מקושר' : 'לא נכון?'}
              </Button>
            </li>
          ))}
        </ul>
      </Card>

      <p className="text-center text-xs text-ink-3">
        מחירי מדף, בלי מבצעים
        {lastIngest.data?.finished_at && (
          <> · עודכנו {new Date(lastIngest.data.finished_at).toLocaleString('he-IL')}</>
        )}
      </p>

      {picking && (
        <ProductPickerSheet
          itemName={picking.item.name}
          currentBarcode={picking.item.barcode}
          preferredPack={picking.target}
          onPick={(barcode) => linkItem.mutate({ item: picking.item, barcode })}
          onClose={() => setPicking(null)}
        />
      )}
    </div>
  )
}

/** "12 יח' · הזול מסוגו (ביצים אריזון 12 גדול)" */
function describe(r: ItemResolution, store: Store | undefined): string {
  if (r.byStore.size === 0) return 'לא נמצא באף סניף'
  const sample = (store && r.byStore.get(store.id)) ?? r.byStore.values().next().value!
  const size = formatPack(r.target, r.weighted)
  const how = r.item.barcode ? 'המוצר שקושר' : 'הזול מסוגו'
  return [size, `${how}: ${sample.productName}`].filter(Boolean).join(' · ')
}

function ChainRow({
  chain,
  rank,
  name,
  itemCount,
  expanded,
  onToggle,
}: {
  chain: ChainBasket
  rank: number
  name: string
  itemCount: number
  expanded: boolean
  onToggle: () => void
}) {
  const { best, branches } = chain
  return (
    <li className="rounded-2xl border border-line bg-surface">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 p-3 text-start">
        <span
          className={cn(
            'num flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold',
            rank === 1 ? 'bg-brand-700 text-white' : 'bg-surface-2 text-ink-2',
          )}
        >
          {rank}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-medium">{name}</span>
          <span className="block truncate text-xs text-ink-3">
            {best.store.name}
            {branches.length > 1 && ` · ועוד ${branches.length - 1} סניפים`}
          </span>
          {best.found < itemCount && (
            <span className="block text-xs text-ink-3">
              נמצאו <span className="num">{best.found}</span> מתוך <span className="num">{itemCount}</span>
            </span>
          )}
        </span>
        <span className="text-end">
          <span className="num block font-semibold">{formatILS(best.total)}</span>
          <span className={cn('block text-xs', chain.extra > 0 ? 'num text-rose-600' : 'text-emerald-600')}>
            {chain.extra > 0 ? `+${formatILS(chain.extra)}` : 'הזול ביותר'}
          </span>
        </span>
        <ChevronDown size={18} className={cn('text-ink-3 transition-transform', expanded && 'rotate-180')} />
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-line p-3 text-sm">
          <ul className="space-y-1.5">
            {best.lines.map((line) => (
              <Line key={line.item.id} line={line} />
            ))}
          </ul>
          <p className="flex justify-between border-t border-line pt-2 font-medium">
            <span>סה"כ ב{best.store.name}</span>
            <span className="num">{formatILS(best.total)}</span>
          </p>
          {branches.length > 1 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-ink-2">סניפים נוספים</p>
              <ul className="space-y-1 text-ink-2">
                {branches.slice(1).map((b) => (
                  <li key={b.store.id} className="flex gap-2">
                    <span className="min-w-0 flex-1 truncate">{b.store.name}</span>
                    <span className="num">{formatILS(b.total)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  )
}

function Line({ line }: { line: BasketLine }) {
  const { match, item } = line
  if (!match) {
    return (
      <li className="flex gap-2 text-ink-3">
        <span className="min-w-0 flex-1">
          <span className="block truncate">{item.name}</span>
          <span className="block text-xs">לא נמכר כאן, לפי המחיר החציוני בסניפים האחרים</span>
        </span>
        <span className="num">≈ {formatILS(line.lineTotal)}</span>
      </li>
    )
  }
  // Numbers isolated one by one: the text around them stays right-to-left.
  const detail = match.weighted ? (
    <>
      <span className="num">{match.multiplier}</span> ק"ג × {formatILS(match.price)}
    </>
  ) : match.multiplier !== 1 ? (
    <>
      <span className="num">{match.multiplier}</span> × {formatILS(match.price)}
    </>
  ) : (
    formatPack(match.pack)
  )
  return (
    <li className="flex gap-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate">
          {match.kind === 'similar' && '≈ '}
          {match.productName}
        </span>
        <span className="block text-xs text-ink-3">
          {item.name}
          {detail && <> · {detail}</>}
        </span>
      </span>
      <span className="num text-ink-2">{formatILS(line.lineTotal)}</span>
    </li>
  )
}
