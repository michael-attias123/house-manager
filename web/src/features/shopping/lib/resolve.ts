import type { FrequentItem, ItemCategory } from '@/lib/db-types'
import { categoryKey, classify } from './classify'

/** categoryKey() → department, from the rows of item_categories. */
export function learnedMap(rows: ItemCategory[] | undefined): Map<string, string> {
  return new Map((rows ?? []).map((r) => [r.normalized_name, r.category]))
}

/**
 * The department for a new item: one picked explicitly (a suggestion), one
 * the household chose for this name, the one it was bought under last time,
 * then the classifier, which also generalizes from what was learned.
 */
export function resolveCategory(
  name: string,
  explicit: string | undefined,
  learned: ReadonlyMap<string, string>,
  previous: FrequentItem | undefined,
): string {
  return explicit ?? learned.get(categoryKey(name)) ?? previous?.category ?? classify(name, learned).category
}
