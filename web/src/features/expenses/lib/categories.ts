export interface ExpenseCategory {
  id: string
  label: string
  emoji: string
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { id: 'groceries', label: 'סופר', emoji: '🛒' },
  { id: 'rent', label: 'שכירות / משכנתא', emoji: '🏠' },
  { id: 'bills', label: 'חשבונות', emoji: '💡' },
  { id: 'home', label: 'לבית', emoji: '🛋️' },
  { id: 'eating_out', label: 'אוכל בחוץ', emoji: '🍕' },
  { id: 'transport', label: 'רכב ותחבורה', emoji: '🚗' },
  { id: 'health', label: 'בריאות', emoji: '💊' },
  { id: 'fun', label: 'בילויים', emoji: '🎉' },
  { id: 'travel', label: 'חופשות', emoji: '✈️' },
  { id: 'gifts', label: 'מתנות', emoji: '🎁' },
  { id: 'pets', label: 'חיות מחמד', emoji: '🐾' },
  { id: 'other', label: 'אחר', emoji: '📦' },
]

const byId = new Map(EXPENSE_CATEGORIES.map((c) => [c.id, c]))

export function getExpenseCategory(id: string): ExpenseCategory {
  return byId.get(id) ?? byId.get('other')!
}
