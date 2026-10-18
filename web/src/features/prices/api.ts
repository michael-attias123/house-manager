import { supabase, unwrap } from '@/lib/supabase'
import type { BasketMatch, Chain, IngestRun, ProductSearchResult, Store } from '@/lib/db-types'

export async function fetchChains(): Promise<Chain[]> {
  return unwrap(await supabase.from('chains').select('id, name').order('name')) as Chain[]
}

export async function fetchStores(): Promise<Store[]> {
  return unwrap(
    await supabase.from('stores').select('*').eq('active', true).order('chain_id').order('name'),
  ) as Store[]
}

export async function fetchBasketMatches(listId: string): Promise<BasketMatch[]> {
  const rows = unwrap(await supabase.rpc('basket_matches', { p_list_id: listId })) as BasketMatch[]
  return rows.map((r) => ({ ...r, price: Number(r.price) }))
}

export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  return unwrap(await supabase.rpc('search_products', { p_query: query, p_limit: 25 })) as ProductSearchResult[]
}

export async function linkItemToProduct(
  householdId: string,
  item: { id: string; name: string },
  barcode: string | null,
): Promise<void> {
  unwrap(await supabase.from('list_items').update({ barcode }).eq('id', item.id))
  const normalized = item.name.trim().toLowerCase()
  if (barcode) {
    unwrap(
      await supabase
        .from('product_links')
        .upsert({ household_id: householdId, normalized_name: normalized, barcode, updated_at: new Date().toISOString() }),
    )
  } else {
    unwrap(
      await supabase
        .from('product_links')
        .delete()
        .eq('household_id', householdId)
        .eq('normalized_name', normalized),
    )
  }
}

export async function fetchLastIngest(): Promise<IngestRun | null> {
  const rows = unwrap(
    await supabase
      .from('ingest_runs')
      .select('*')
      .in('status', ['ok', 'partial'])
      .order('started_at', { ascending: false })
      .limit(1),
  ) as IngestRun[]
  return rows[0] ?? null
}
