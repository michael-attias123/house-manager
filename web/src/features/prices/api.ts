import { supabase, unwrap } from '@/lib/supabase'
import type { Chain, IngestRun, MatchCandidate, ProductSearchResult, Store } from '@/lib/db-types'
import type { MatchRequest } from './lib/match'

export async function fetchChains(): Promise<Chain[]> {
  return unwrap(await supabase.from('chains').select('id, name').order('name')) as Chain[]
}

export async function fetchStores(): Promise<Store[]> {
  return unwrap(
    await supabase.from('stores').select('*').eq('active', true).order('chain_id').order('name'),
  ) as Store[]
}

/** Per item, store and pack size: the cheapest product of the best-matching kind. */
export async function fetchMatchCandidates(requests: MatchRequest[]): Promise<MatchCandidate[]> {
  if (requests.length === 0) return []
  const rows = unwrap(await supabase.rpc('match_candidates', { p_items: requests })) as MatchCandidate[]
  return rows.map((r) => ({
    ...r,
    price: Number(r.price),
    pack_qty: r.pack_qty == null ? null : Number(r.pack_qty),
  }))
}

export async function searchProducts(query: string): Promise<ProductSearchResult[]> {
  const rows = unwrap(await supabase.rpc('search_products', { p_query: query, p_limit: 25 })) as ProductSearchResult[]
  return rows.map((r) => ({ ...r, pack_qty: r.pack_qty == null ? null : Number(r.pack_qty) }))
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
