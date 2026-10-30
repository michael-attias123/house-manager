import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, CheckSquare, RotateCcw, ShoppingBag } from 'lucide-react'
import type { ListItem } from '@/lib/db-types'
import { cn } from '@/lib/cn'
import { Button } from '@/components/ui/Button'
import { EmptyState, ErrorBox, Loading } from '@/components/ui/Feedback'
import { AddItemBar } from './components/AddItemBar'
import { CategoryPicker } from './components/CategoryPicker'
import { CompleteTripSheet } from './components/CompleteTripSheet'
import { EditItemSheet } from './components/EditItemSheet'
import { ItemRow } from './components/ItemRow'
import { SelectionBar } from './components/SelectionBar'
import { SHOPPING_CATEGORIES, getCategory, parseItemInput } from './lib/categories'
import { categoryKey } from './lib/classify'
import { findDuplicate } from './lib/duplicates'
import { learnedMap } from './lib/resolve'
import {
  useAddItem,
  useDefaultList,
  useDeleteItem,
  useDeleteItems,
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
  const deleteItems = useDeleteItems(listId)
  // Selection mode (a long press on an item): null when not selecting.
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null)
  // "Already on the list": the item that was added again, for 3 seconds.
  const [repeated, setRepeated] = useState<ListItem | null>(null)

  const { groups, checked } = useMemo(() => groupItems(items.data ?? []), [items.data])
  const openCount = groups.reduce((n, g) => n + g.items.length, 0)
  const allIds = useMemo(() => (items.data ?? []).map((i) => i.id), [items.data])
  // Items the partner deleted meanwhile drop out of the selection.
  const selectedIds = selected ? allIds.filter((id) => selected.has(id)) : []
  const selecting = selected !== null

  useEffect(() => {
    if (!selecting) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setSelected(null)
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selecting])

  useEffect(() => {
    if (!repeated) return
    document.querySelector(`[data-item-id="${repeated.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    const timer = setTimeout(() => setRepeated(null), 3000)
    return () => clearTimeout(timer)
  }, [repeated])

  /** Adds or removes ids from the selection; an empty selection ends it. */
  const select = (ids: string[]) =>
    setSelected((current) => {
      const next = new Set(current ?? [])
      const all = ids.every((id) => next.has(id))
      for (const id of ids) {
        if (all) next.delete(id)
        else next.add(id)
      }
      return next.size > 0 ? next : null
    })

  const add = (text: string, from?: { category: string; barcode: string | null }) => {
    const same = findDuplicate(items.data ?? [], parseItemInput(text).name)
    if (same) {
      setRepeated(same)
      return
    }
    addItem.mutate({ id: crypto.randomUUID(), text, category: from?.category, barcode: from?.barcode })
  }

  const rowProps = (item: ListItem) => ({
    item,
    onEdit: () => setEditing(item),
    onLongPress: () => select([item.id]),
    selecting,
    selected: selected?.has(item.id) ?? false,
    onSelect: () => select([item.id]),
    highlighted: repeated?.id === item.id,
  })

  if (items.isPending) return <Loading />

  return (
    <div className={cn('space-y-4', selecting ? 'pb-40' : 'pb-24')}>
      <AddItemBar items={items.data ?? []} frequent={suggestions} onAdd={add} />
      {repeated && (
        <p role="status" className="rounded-xl bg-surface-2 px-3 py-2 text-sm text-ink-2">
          {repeated.name} כבר {repeated.checked ? 'בעגלה' : 'ברשימה'}
        </p>
      )}
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
          {!selecting && (
            <Button variant="ghost" size="sm" className="ms-auto me-2" onClick={() => setSelected(new Set())}>
              <CheckSquare size={14} />
              בחירה
            </Button>
          )}
          <Link to="/prices" className="flex items-center gap-1 text-brand-700 dark:text-brand-200">
            <BarChart3 size={16} />
            איפה הכי זול?
          </Link>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.id}>
          <h3 className="mb-1 px-2 text-sm font-semibold text-ink-2">
            <SectionTitle
              selecting={selecting}
              onSelectAll={() => select(group.items.map((i) => i.id))}
              label={`בחירת כל ${group.label}`}
            >
              <span aria-hidden>{group.emoji}</span>
              {group.label}
            </SectionTitle>
          </h3>
          {group.id === 'other' && !selecting && (
            <p className="mb-1 px-2 text-xs text-ink-3">
              לא זיהינו את המחלקה. נוגעים באייקון כדי לסדר, והאפליקציה תזכור.
            </p>
          )}
          <ul className="rounded-2xl border border-line bg-surface p-1">
            {group.items.map((item) => (
              <ItemRow
                key={item.id}
                {...rowProps(item)}
                onToggle={() => toggleItem.mutate({ id: item.id, checked: true })}
                onMove={() => setMoving(item)}
                onQuantity={(quantity) => updateItem.mutate({ id: item.id, patch: { quantity } })}
              />
            ))}
          </ul>
        </section>
      ))}

      {checked.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between px-2">
            <h3 className="text-sm font-semibold text-ink-2">
              <SectionTitle
                selecting={selecting}
                onSelectAll={() => select(checked.map((i) => i.id))}
                label="בחירת כל מה שבעגלה"
              >
                בעגלה ({checked.length})
              </SectionTitle>
            </h3>
            {!selecting && (
              <Button variant="ghost" size="sm" onClick={() => uncheckAll.mutate()}>
                <RotateCcw size={14} />
                ביטול סימון
              </Button>
            )}
          </div>
          <ul className="rounded-2xl border border-line bg-surface p-1">
            {checked.map((item) => (
              <ItemRow
                key={item.id}
                {...rowProps(item)}
                onToggle={() => toggleItem.mutate({ id: item.id, checked: false })}
              />
            ))}
          </ul>
          {!selecting && (
            <Button className="w-full" size="lg" onClick={() => setCompleting(true)}>
              <ShoppingBag size={20} />
              סיימתי קנייה
            </Button>
          )}
        </section>
      )}

      {selecting && (
        <SelectionBar
          count={selectedIds.length}
          total={allIds.length}
          onSelectAll={() => setSelected(new Set(allIds))}
          onDelete={() => {
            deleteItems.mutate(selectedIds)
            setSelected(null)
          }}
          onCancel={() => setSelected(null)}
        />
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

/** A section heading; while selecting, a button that selects the section. */
function SectionTitle({
  selecting,
  onSelectAll,
  label,
  children,
}: {
  selecting: boolean
  onSelectAll: () => void
  label: string
  children: ReactNode
}) {
  if (!selecting) return <span className="flex items-center gap-2">{children}</span>
  return (
    <button
      type="button"
      onClick={onSelectAll}
      className="flex items-center gap-2 rounded-lg py-1 text-brand-700 active:bg-surface-2 dark:text-brand-200"
      aria-label={label}
    >
      {children}
    </button>
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
