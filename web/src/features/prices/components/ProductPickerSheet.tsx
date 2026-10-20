import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { formatILS } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { EmptyState, ErrorBox, Spinner } from '@/components/ui/Feedback'
import { Sheet } from '@/components/ui/Sheet'
import { useProductSearch } from '../hooks'
import { formatPack, packsMatch, type Pack } from '../lib/normalize'

interface ProductPickerSheetProps {
  itemName: string
  currentBarcode: string | null
  /** The size the comparison uses for this item: products of that size first. */
  preferredPack?: Pack | null
  onPick: (barcode: string | null) => void
  onClose: () => void
}

export function ProductPickerSheet({ itemName, currentBarcode, preferredPack, onPick, onClose }: ProductPickerSheetProps) {
  const [query, setQuery] = useState(itemName)
  const results = useProductSearch(query)
  const products = useMemo(() => {
    const rows = results.data ?? []
    if (!preferredPack) return rows
    const fits = (p: (typeof rows)[number]) =>
      p.pack_unit != null && p.pack_qty != null && packsMatch({ unit: p.pack_unit, qty: p.pack_qty }, preferredPack)
    return [...rows.filter(fits), ...rows.filter((p) => !fits(p))]
  }, [results.data, preferredPack])

  return (
    <Sheet open onClose={onClose} title={`איזה ${itemName}?`}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          בלי קישור, בכל סניף נבחר המוצר הזול מאותו סוג וגודל. קישור למוצר מסוים משווה בדיוק אותו
          (ובסניפים שאין בהם אותו, מוצר באותו גודל). הבחירה נשמרת לפעמים הבאות.
        </p>
        <div className="relative">
          <Search size={18} className="absolute top-3 right-3 text-ink-3" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="שם מוצר או ברקוד"
            className="pr-10"
          />
        </div>
        {results.isFetching && <Spinner />}
        {results.error && <ErrorBox error={results.error} />}
        {results.data?.length === 0 && <EmptyState title="לא נמצאו מוצרים" />}
        <ul className="divide-y divide-line">
          {products.map((p) => (
            <li key={p.barcode}>
              <button
                type="button"
                onClick={() => {
                  onPick(p.barcode)
                  onClose()
                }}
                className="flex w-full items-center gap-3 py-2.5 text-start"
              >
                <span className="min-w-0 flex-1">
                  <span className={`block ${p.barcode === currentBarcode ? 'font-semibold text-brand-700' : ''}`}>
                    {p.name}
                  </span>
                  <span className="block text-xs text-ink-3">
                    {[
                      formatPack(
                        p.pack_unit && p.pack_qty != null ? { unit: p.pack_unit, qty: p.pack_qty } : null,
                        p.is_weighted,
                      ),
                      p.manufacturer,
                      `${p.store_count} סניפים`,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
                {p.min_price != null && (
                  <span className="num text-sm text-ink-2">
                    {p.min_price === p.max_price
                      ? formatILS(Number(p.min_price))
                      : `${formatILS(Number(p.min_price))}–${formatILS(Number(p.max_price))}`}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {currentBarcode && (
          <Button
            variant="ghost"
            className="w-full"
            onClick={() => {
              onPick(null)
              onClose()
            }}
          >
            ביטול הקישור (הזול מאותו סוג וגודל)
          </Button>
        )}
      </div>
    </Sheet>
  )
}
