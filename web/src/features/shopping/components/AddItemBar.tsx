import { useMemo, useRef, useState, type FormEvent } from 'react'
import { Plus } from 'lucide-react'
import type { FrequentItem, ListItem } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { Chip } from '@/components/ui/Chip'
import { Input } from '@/components/ui/Field'
import { getCategory, parseItemInput } from '../lib/categories'

interface AddItemBarProps {
  items: ListItem[]
  frequent: FrequentItem[]
  onAdd: (text: string, from?: FrequentItem) => void
}

export function AddItemBar({ items, frequent, onAdd }: AddItemBarProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  const onList = useMemo(
    () => new Set(items.filter((i) => !i.checked).map((i) => i.name.trim().toLowerCase())),
    [items],
  )

  // While typing: matching items from history. Otherwise: frequent items
  // that are not on the list yet.
  const suggestions = useMemo(() => {
    const query = parseItemInput(text).name.toLowerCase()
    const pool = frequent.filter((f) => !onList.has(f.normalized_name))
    if (!query) return pool.slice(0, 12)
    return pool.filter((f) => f.normalized_name.includes(query)).slice(0, 8)
  }, [text, frequent, onList])

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    onAdd(text)
    setText('')
    inputRef.current?.focus()
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex gap-2">
        <Input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="מה צריך? למשל: 2 חלב"
          enterKeyHint="done"
          aria-label="פריט חדש"
          className="h-12"
        />
        <Button type="submit" size="icon" className="h-12 w-12" aria-label="הוספה" disabled={!text.trim()}>
          <Plus size={22} />
        </Button>
      </form>
      {suggestions.length > 0 && (
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
          {suggestions.map((s) => (
            <Chip
              key={s.normalized_name}
              onClick={() => {
                const { quantity } = parseItemInput(text)
                onAdd(quantity > 1 ? `${quantity} ${s.name}` : s.name, s)
                setText('')
              }}
            >
              <span aria-hidden>{getCategory(s.category).emoji}</span>
              {s.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}
