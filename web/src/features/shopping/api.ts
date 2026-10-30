import { supabase, unwrap } from '@/lib/supabase'
import type { FrequentItem, ItemCategory, ListItem, ShoppingList, ShoppingTrip } from '@/lib/db-types'

export async function fetchDefaultList(householdId: string): Promise<ShoppingList> {
  const lists = unwrap(
    await supabase
      .from('shopping_lists')
      .select('*')
      .eq('household_id', householdId)
      .order('is_default', { ascending: false })
      .order('created_at')
      .limit(1),
  ) as ShoppingList[]
  if (lists[0]) return lists[0]
  return unwrap(
    await supabase
      .from('shopping_lists')
      .insert({ household_id: householdId, name: 'קניות', is_default: true })
      .select()
      .single(),
  ) as ShoppingList
}

export async function fetchItems(listId: string): Promise<ListItem[]> {
  return unwrap(
    await supabase.from('list_items').select('*').eq('list_id', listId).order('created_at'),
  ) as ListItem[]
}

export type NewListItem = Pick<ListItem, 'id' | 'list_id' | 'household_id' | 'name' | 'quantity' | 'category'> &
  Partial<Pick<ListItem, 'unit' | 'note' | 'barcode'>>

export async function addItem(item: NewListItem): Promise<void> {
  unwrap(await supabase.from('list_items').upsert(item, { onConflict: 'id', ignoreDuplicates: true }))
}

export type ListItemPatch = Partial<
  Pick<ListItem, 'name' | 'quantity' | 'unit' | 'category' | 'note' | 'barcode' | 'checked' | 'checked_by' | 'checked_at'>
>

export async function updateItem(id: string, patch: ListItemPatch): Promise<void> {
  unwrap(await supabase.from('list_items').update(patch).eq('id', id))
}

export async function deleteItem(id: string): Promise<void> {
  unwrap(await supabase.from('list_items').delete().eq('id', id))
}

export async function deleteItems(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  unwrap(await supabase.from('list_items').delete().in('id', ids))
}

export async function uncheckAll(listId: string): Promise<void> {
  unwrap(
    await supabase
      .from('list_items')
      .update({ checked: false, checked_by: null, checked_at: null })
      .eq('list_id', listId)
      .eq('checked', true),
  )
}

export async function fetchFrequentItems(householdId: string): Promise<FrequentItem[]> {
  return unwrap(
    await supabase
      .from('frequent_items')
      .select('*')
      .eq('household_id', householdId)
      .order('times_bought', { ascending: false })
      .limit(200),
  ) as FrequentItem[]
}

export async function fetchItemCategories(householdId: string): Promise<ItemCategory[]> {
  return unwrap(
    await supabase.from('item_categories').select('*').eq('household_id', householdId),
  ) as ItemCategory[]
}

/** Remembers the department the household chose for a name (key: categoryKey()). */
export async function saveItemCategory(householdId: string, normalizedName: string, category: string): Promise<void> {
  unwrap(
    await supabase.from('item_categories').upsert({
      household_id: householdId,
      normalized_name: normalizedName,
      category,
      updated_at: new Date().toISOString(),
    }),
  )
}

/** The product a household linked to this item name before, if any. */
export async function fetchProductLink(householdId: string, name: string): Promise<string | null> {
  const rows = unwrap(
    await supabase
      .from('product_links')
      .select('barcode')
      .eq('household_id', householdId)
      .eq('normalized_name', name.trim().toLowerCase())
      .limit(1),
  ) as { barcode: string }[]
  return rows[0]?.barcode ?? null
}

export interface CompleteTripInput {
  listId: string
  storeId: number | null
  storeName: string | null
  total: number | null
  tripDate: string
}

export async function completeTrip(input: CompleteTripInput): Promise<string> {
  return unwrap(
    await supabase.rpc('complete_trip', {
      p_list_id: input.listId,
      p_store_id: input.storeId,
      p_store_name: input.storeName,
      p_total: input.total,
      p_trip_date: input.tripDate,
    }),
  ) as string
}

export async function fetchTrips(householdId: string, limit = 50): Promise<ShoppingTrip[]> {
  return unwrap(
    await supabase
      .from('shopping_trips')
      .select('*')
      .eq('household_id', householdId)
      .order('trip_date', { ascending: false })
      .limit(limit),
  ) as ShoppingTrip[]
}
