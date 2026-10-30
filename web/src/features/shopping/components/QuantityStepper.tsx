import { useEffect, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { cn } from '@/lib/cn'

interface QuantityStepperProps {
  name: string
  quantity: number
  unit: string | null
  onChange: (quantity: number) => void
}

const CLOSE_AFTER_MS = 3000

/** The quantity as a pill; a tap opens − n + in place, which closes by itself. */
export function QuantityStepper({ name, quantity, unit, onChange }: QuantityStepperProps) {
  const [open, setOpen] = useState(false)
  const [touched, setTouched] = useState(0)

  useEffect(() => {
    if (!open) return
    const timer = setTimeout(() => setOpen(false), CLOSE_AFTER_MS)
    return () => clearTimeout(timer)
  }, [open, touched])

  const label = `${quantity}${unit ? ` ${unit}` : ''}`

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          'num flex h-8 min-w-10 shrink-0 items-center justify-center rounded-lg px-2 text-sm active:bg-surface-2',
          quantity === 1 ? 'text-ink-3' : 'bg-surface-2 font-medium text-ink',
        )}
        aria-label={`כמות של ${name}: ${label}. שינוי כמות`}
      >
        ×{label}
      </button>
    )
  }

  const step = (delta: number) => {
    setTouched((n) => n + 1)
    onChange(Math.max(1, quantity + delta))
  }

  return (
    <div className="flex shrink-0 items-center rounded-lg bg-surface-2" role="group" aria-label={`כמות של ${name}`}>
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={quantity <= 1}
        className="flex h-8 w-8 items-center justify-center rounded-lg active:bg-line disabled:opacity-30"
        aria-label="פחות"
      >
        <Minus size={16} />
      </button>
      <span className="num min-w-6 text-center text-sm font-medium" aria-live="polite">
        {label}
      </span>
      <button
        type="button"
        onClick={() => step(1)}
        className="flex h-8 w-8 items-center justify-center rounded-lg active:bg-line"
        aria-label="יותר"
      >
        <Plus size={16} />
      </button>
    </div>
  )
}
