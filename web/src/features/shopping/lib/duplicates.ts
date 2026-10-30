import type { ListItem } from '@/lib/db-types'
import { itemKey } from './classify'

/**
 * The item already on the list under this name, if any (an open one before
 * one in the cart). Adding it again is ignored rather than making a twin row.
 */
export function findDuplicate(items: ListItem[], name: string): ListItem | undefined {
  const key = itemKey(name)
  if (!key) return undefined
  const same = items.filter((i) => itemKey(i.name) === key)
  return same.find((i) => !i.checked) ?? same[0]
}
