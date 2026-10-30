import type { FrequentItem } from '@/lib/db-types'
import { categoryKey } from './classify'
import { learnedMap, resolveCategory } from './resolve'

const bought = (name: string, category: string) => ({ normalized_name: name, name, category }) as FrequentItem

describe('resolveCategory', () => {
  const learned = learnedMap([
    { household_id: 'h', normalized_name: categoryKey('עוגיות'), category: 'pantry', updated_at: '' },
  ])

  it('takes an explicit department first', () => {
    expect(resolveCategory('עוגיות', 'frozen', learned, bought('עוגיות', 'bakery'))).toBe('frozen')
  })

  it('then what the household chose for the name', () => {
    expect(resolveCategory('עוגיות', undefined, learned, bought('עוגיות', 'bakery'))).toBe('pantry')
  })

  it('then the department of the last purchase', () => {
    expect(resolveCategory('לחם', undefined, learned, bought('לחם', 'other'))).toBe('other')
  })

  it('then the classifier, which also uses what was learned', () => {
    expect(resolveCategory('חלב', undefined, learned, undefined)).toBe('dairy')
    expect(resolveCategory('עוגיות שוקולד', undefined, learned, undefined)).toBe('pantry')
  })
})
