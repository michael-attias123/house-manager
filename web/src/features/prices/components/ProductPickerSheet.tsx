import { useState } from 'react'
import { Search } from 'lucide-react'
import { formatILS } from '@/lib/money'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { EmptyState, ErrorBox, Spinner } from '@/components/ui/Feedback'
import { Sheet } from '@/components/ui/Sheet'
import { useProductSearch } from '../hooks'

interface ProductPickerSheetProps {
  itemName: string
  currentBarcode: string | null
  onPick: (barcode: string | null) => void
  onClose: () => void
}

export function ProductPickerSheet({ itemName, currentBarcode, onPick, onClose }: ProductPickerSheetProps) {
  const [query, setQuery] = useState(itemName)
  const results = useProductSearch(query)

  return (
    <Sheet open onClose={onClose} title={`איזה ${itemName}?`}>
      <div className="space-y-3">
        <p className="text-sm text-ink-2">
          בחירת מוצר מדויק (ברקוד) הופכת את ההשוואה למדויקת. הבחירה נשמרת לפעמים הבאות.
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
          {results.data?.map((p) => (
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
                    {p.manufacturer ? `${p.manufacturer} · ` : ''}
                    {p.store_count} סניפים
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
            ביטול הקישור (השוואה לפי שם)
          </Button>
        )}
      </div>
    </Sheet>
  )
}
