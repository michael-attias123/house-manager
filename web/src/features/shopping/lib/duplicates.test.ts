import type { ListItem } from '@/lib/db-types'
import { itemKey } from './classify'
import { findDuplicate } from './duplicates'

const item = (id: string, name: string, checked = false) => ({ id, name, checked }) as ListItem

describe('itemKey', () => {
  it('ignores punctuation, spacing and final letters but keeps numbers', () => {
    expect(itemKey('קוטג׳')).toBe(itemKey('קוטג'))
    expect(itemKey(' חלב  ')).toBe(itemKey('חלב'))
    expect(itemKey('חלב 3%')).not.toBe(itemKey('חלב 1%'))
    expect(itemKey('חלב 3%')).not.toBe(itemKey('חלב'))
    expect(itemKey('תותים')).toBe(itemKey('תות'))
    expect(itemKey('עגבנייה')).toBe(itemKey('עגבניות'))
    expect(itemKey('עגבניות שרי')).toBe(itemKey('עגבניה שרי'))
    expect(itemKey('חלבה')).not.toBe(itemKey('חלב'))
  })
})

describe('findDuplicate', () => {
  const items = [item('a', 'חלב'), item('b', 'קוטג׳', true), item('c', 'לחם', true), item('d', 'לחם')]

  it('finds the same item, however it was typed', () => {
    expect(findDuplicate(items, 'חלב ')?.id).toBe('a')
    expect(findDuplicate(items, 'קוטג')?.id).toBe('b')
  })

  it('treats singular and plural as the same item', () => {
    expect(findDuplicate([item('t', 'תותים')], 'תות')?.id).toBe('t')
    expect(findDuplicate([item('g', 'עגבנייה')], 'עגבניות')?.id).toBe('g')
  })

  it('prefers the open item to the one in the cart', () => {
    expect(findDuplicate(items, 'לחם')?.id).toBe('d')
  })

  it('treats a different size as a different item', () => {
    expect(findDuplicate(items, 'חלב 1%')).toBeUndefined()
    expect(findDuplicate(items, 'גבינה')).toBeUndefined()
    expect(findDuplicate(items, '')).toBeUndefined()
  })
})
