import { Link } from 'react-router-dom'
import { ShoppingCart } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { useDefaultList, useListItems } from './hooks'

export function ShoppingWidget() {
  const list = useDefaultList()
  const items = useListItems(list.data?.id)
  const open = (items.data ?? []).filter((i) => !i.checked)

  return (
    <Link to="/shopping" className="block">
      <Card className="space-y-2">
        <div className="flex items-center gap-2">
          <ShoppingCart size={18} className="text-brand-700" />
          <h2 className="flex-1 font-semibold">רשימת קניות</h2>
          <span className="num text-sm text-ink-2">{open.length}</span>
        </div>
        {open.length === 0 ? (
          <p className="text-sm text-ink-3">הרשימה ריקה</p>
        ) : (
          <p className="line-clamp-2 text-sm text-ink-2">{open.map((i) => i.name).join(' · ')}</p>
        )}
      </Card>
    </Link>
  )
}
