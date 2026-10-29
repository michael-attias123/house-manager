import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, RotateCcw, ShoppingBag } from 'lucide-react'
import type { ListItem } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { AddItemBar } from './components/AddItemBar'
import { CategoryPicker } from './components/CategoryPicker'
import { CompleteTripSheet } from './components/CompleteTripSheet'
import { EditItemSheet } from './components/EditItemSheet'
import { ItemRow } from './components/ItemRow'
import { SHOPPING_CATEGORIES, getCategory } from './lib/categories'
import { categoryKey } from './lib/classify'
import { learnedMap } from './lib/resolve'
import {
  useAddItem,
  useDefaultList,
  useDeleteItem,
  useFrequentItems,
  useItemCategories,
  useLearnCategory,
  useListItems,
  useMoveItem,
  useToggleItem,
  useUncheckAll,
  useUpdateItem,
} from './hooks'

export function ShoppingPage() {
  const list = useDefaultList()
  if (list.isPending) return <Loading />
  if (list.error) return <ErrorBox error={list.error} />
  return <ShoppingList listId={list.data.id} />
}

function ShoppingList({ listId }: { listId: string }) {
  const items = useListItems(listId)
  const frequent = useFrequentItems()
  const addItem = useAddItem(listId)
  const toggleItem = useToggleItem(listId)
  const updateItem = useUpdateItem(listId)
  const deleteItem = useDeleteItem(listId)
  const uncheckAll = useUncheckAll(listId)
  const moveItem = useMoveItem(listId)
  const learnCategory = useLearnCategory()
  // Loaded here so a new item can use what the household taught the list.
  const categories = useItemCategories()
  // A suggestion from the purchase history follows the department chosen
  // since, not the one it was bought under.
  const suggestions = useMemo(() => {
    const learned = learnedMap(categories.data)
    return (frequent.data ?? []).map((f) => ({ ...f, category: learned.get(categoryKey(f.name)) ?? f.category }))
  }, [frequent.data, categories.data])
  const [editing, setEditing] = useState<ListItem | null>(null)
  const [moving, setMoving] = useState<ListItem | null>(null)
  const [completing, setCompleting] = useState(false)

  const { groups, checked } = useMemo(() => groupItems(items.data ?? []), [items.data])
  const openCount = groups.reduce((n, g) => n + g.items.length, 0)

  if (items.isPending) return <Loading />

  return (
    <div className="space-y-4 pb-24">
      <AddItemBar
        items={items.data ?? []}
        frequent={suggestions}
        onAdd={(text, from) =>
          addItem.mutate({ id: crypto.randomUUID(), text, category: from?.category, barcode: from?.barcode })
        }
      />
      {items.error && <ErrorBox error={items.error} />}

      {openCount === 0 && checked.length === 0 ? (
        <EmptyState icon="🧺" title="הרשימה ריקה">
          מוסיפים פריט למעלה, והוא מופיע מיד גם אצל השני.
        </EmptyState>
      ) : (
        <div className="flex items-center justify-between text-sm text-ink-2">
          <span>
            {openCount > 0 ? `${openCount} פריטים לקנות` : 'הכל בעגלה 🎉'}
          </span>
          <Link to="/prices" className="flex items-center gap-1 text-brand-700 dark:text-brand-200">
            <BarChart3 size={16} />
            איפה הכי זול?
          </Link>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="mb-1 flex items-center gap-2 px-2 text-sm font-semibold text-ink-2">
            <span aria-hidden>{group.emoji}</span>
            {group.label}
          </h3>
          {group.id === 'other' && (
            <p className="mb-1 px-2 text-xs text-ink-3">
              לא זיהינו את המחלקה. נוגעים באייקון כדי לסדר, והאפליקציה תזכור.
            </p>
          )}
          <ul className="rounded-2xl border border-line bg-surface p-1">
            {group.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => toggleItem.mutate({ id: item.id, checked: true })}
                onEdit={() => setEditing(item)}
                onMove={() => setMoving(item)}
              />
            ))}
          </ul>
        </section>
      ))}

      {checked.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-sm font-semibold text-ink-2">בעגלה ({checked.length})</h3>
            <Button variant="ghost" size="sm" onClick={() => uncheckAll.mutate()}>
              <RotateCcw size={14} />
              ביטול סימון
            </Button>
          </div>
          <ul className="rounded-2xl border border-line bg-surface p-1">
            {checked.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => toggleItem.mutate({ id: item.id, checked: false })}
                onEdit={() => setEditing(item)}
              />
            ))}
          </ul>
          <Button className="w-full" size="lg" onClick={() => setCompleting(true)}>
            <ShoppingBag size={20} />
            סיימתי קנייה
          </Button>
        </section>
      )}

      {editing && (
        <EditItemSheet
          item={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            updateItem.mutate({ id: editing.id, patch })
            if (patch.category && patch.category !== editing.category) {
              learnCategory.mutate({ name: patch.name ?? editing.name, category: patch.category })
            }
          }}
          onDelete={() => deleteItem.mutate(editing.id)}
        />
      )}
      {moving && (
        <CategoryPicker
          item={moving}
          onPick={(category) => moveItem.mutate({ item: moving, category })}
          onClose={() => setMoving(null)}
        />
      )}
      {completing && (
        <CompleteTripSheet listId={listId} checkedCount={checked.length} onClose={() => setCompleting(false)} />
      )}
    </div>
  )
}

function groupItems(items: ListItem[]) {
  const open = items.filter((i) => !i.checked)
  const checked = items
    .filter((i) => i.checked)
    .sort((a, b) => (b.checked_at ?? '').localeCompare(a.checked_at ?? ''))
  const groups = SHOPPING_CATEGORIES.map((c) => ({
    ...getCategory(c.id),
    items: open.filter((i) => getCategory(i.category).id === c.id),
  })).filter((g) => g.items.length > 0)
  return { groups, checked }
}
