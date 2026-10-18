import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { ListItem } from '@/lib/db-types'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select } from '@/components/ui/Field'
import { Sheet } from '@/components/ui/Sheet'
import { SHOPPING_CATEGORIES } from '../lib/categories'
import type { ListItemPatch } from '../api'

interface EditItemSheetProps {
  item: ListItem
  onClose: () => void
  onSave: (patch: ListItemPatch) => void
  onDelete: () => void
}

export function EditItemSheet({ item, onClose, onSave, onDelete }: EditItemSheetProps) {
  const [name, setName] = useState(item.name)
  const [quantity, setQuantity] = useState(String(item.quantity))
  const [unit, setUnit] = useState(item.unit ?? '')
  const [category, setCategory] = useState(item.category)
  const [note, setNote] = useState(item.note ?? '')
  const [barcode, setBarcode] = useState(item.barcode)

  function save() {
    const q = Number(quantity.replace(',', '.'))
    onSave({
      name: name.trim() || item.name,
      quantity: q > 0 ? q : 1,
      unit: unit.trim() || null,
      category,
      note: note.trim() || null,
      barcode,
    })
    onClose()
  }

  return (
    <Sheet
      open
      onClose={onClose}
      title="עריכת פריט"
      footer={
        <div className="flex gap-2">
          <Button className="flex-1" onClick={save}>
            שמירה
          </Button>
          <Button
            variant="ghost"
            className="text-rose-600"
            onClick={() => {
              onDelete()
              onClose()
            }}
          >
            <Trash2 size={18} />
            מחיקה
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="שם">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="כמות">
            {(id) => (
              <Input id={id} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            )}
          </Field>
          <Field label="יחידה">
            {(id) => (
              <Input id={id} placeholder='ק"ג, חבילה...' value={unit} onChange={(e) => setUnit(e.target.value)} />
            )}
          </Field>
        </div>
        <Field label="מחלקה">
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              {SHOPPING_CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.emoji} {c.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="הערה">
          {(id) => (
            <Input id={id} placeholder="מותג, גודל..." value={note} onChange={(e) => setNote(e.target.value)} />
          )}
        </Field>
        {barcode && (
          <div className="flex items-center justify-between rounded-xl bg-surface-2 px-3 py-2 text-sm">
            <span>
              מקושר למוצר <span className="num">{barcode}</span>
            </span>
            <Button variant="ghost" size="sm" onClick={() => setBarcode(null)}>
              ביטול קישור
            </Button>
          </div>
        )}
      </div>
    </Sheet>
  )
}
