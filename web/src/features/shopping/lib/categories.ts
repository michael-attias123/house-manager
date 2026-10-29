import { classify } from './classify'

export interface ShoppingCategory {
  id: string
  label: string
  emoji: string
}

/** Supermarket departments, in a typical walking order. */
export const SHOPPING_CATEGORIES: ShoppingCategory[] = [
  { id: 'produce', label: 'פירות וירקות', emoji: '🥦' },
  { id: 'dairy', label: 'חלב וביצים', emoji: '🥛' },
  { id: 'bakery', label: 'לחם ומאפים', emoji: '🥖' },
  { id: 'meat', label: 'בשר, עוף ודגים', emoji: '🍗' },
  { id: 'pantry', label: 'מזווה', emoji: '🥫' },
  { id: 'frozen', label: 'קפואים', emoji: '🧊' },
  { id: 'drinks', label: 'שתייה', emoji: '🥤' },
  { id: 'cleaning', label: 'ניקיון וכביסה', emoji: '🧽' },
  { id: 'hygiene', label: 'טיפוח ופארם', emoji: '🧴' },
  { id: 'other', label: 'שונות', emoji: '🛒' },
]

const byId = new Map(SHOPPING_CATEGORIES.map((c, i) => [c.id, { ...c, order: i }]))

export function getCategory(id: string) {
  return byId.get(id) ?? byId.get('other')!
}

/** The department for a name, from the lexicon alone (see classify.ts). */
export function guessCategory(name: string): string {
  return classify(name).category
}

/**
 * Splits a quick-add line into name and quantity: "2 חלב", "חלב 2",
 * "חלב x3" and "3x חלב" all work.
 */
export function parseItemInput(input: string): { name: string; quantity: number } {
  const text = input.trim().replace(/\s+/g, ' ')
  const patterns = [/^(\d+(?:\.\d+)?)\s*[x×*]?\s+(.+)$/i, /^(.+?)\s+[x×*]?\s*(\d+(?:\.\d+)?)$/i]
  const leading = text.match(patterns[0])
  if (leading) return { name: leading[2].trim(), quantity: Number(leading[1]) }
  const trailing = text.match(patterns[1])
  // Avoid treating "חלב 3%" or "קוקה קולה 1.5" (litres) as a quantity.
  if (trailing && !/[%.]/.test(trailing[2]) && Number(trailing[2]) <= 30) {
    return { name: trailing[1].trim(), quantity: Number(trailing[2]) }
  }
  return { name: text, quantity: 1 }
}
