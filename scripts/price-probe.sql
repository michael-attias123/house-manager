-- Read-only look at the price catalogue, for tuning the basket matching:
--   psql "$SUPABASE_DB_URL" -v terms='ביצים,חלב' -f scripts/price-probe.sql
-- Run by .github/workflows/price-probe.yml; nothing here writes.
\set ON_ERROR_STOP 1
\pset pager off
set default_transaction_read_only = on;
set statement_timeout = '60s';

\echo '== Stores per chain'
select s.chain_id, count(*) filter (where s.active) as active, count(*) as total,
  max(s.last_ingested_at) as last_ingested
from public.stores s group by s.chain_id order by 1;

\echo '== Prices per active store'
select s.chain_id, s.name, count(p.barcode) as prices
from public.stores s left join public.prices p on p.store_id = s.id
where s.active group by s.id order by s.chain_id, s.name;

\echo '== Products: total, chain-internal codes, weighted, missing quantity/unit'
select count(*) as products,
  count(*) filter (where barcode like '%:%') as internal,
  count(*) filter (where is_weighted) as weighted,
  count(*) filter (where quantity is null) as no_quantity,
  count(*) filter (where unit is null) as no_unit
from public.products;

\echo '== Most common unit values'
select unit, count(*) from public.products group by unit order by 2 desc limit 40;

\echo '== Barcodes sold by how many chains'
select chains, count(*) from (
  select p.barcode, count(distinct s.chain_id) as chains
  from public.prices p join public.stores s on s.id = p.store_id and s.active
  group by p.barcode
) x group by chains order by chains;

\echo '== Candidates per term (starts-with first, then by store coverage)'
with terms as (
  select row_number() over () as n, trim(t) as term
  from unnest(string_to_array(:'terms', ',')) as t
)
select t.term, c.starts, c.stores, c.chains, c.min_price, c.max_price,
  c.quantity, c.unit, c.is_weighted, c.barcode, c.name
from terms t
cross join lateral (
  select pr.barcode, pr.name, pr.quantity, pr.unit, pr.is_weighted,
    pr.name like t.term || '%' as starts,
    count(p.store_id) as stores,
    count(distinct s.chain_id) as chains,
    min(p.price) as min_price, max(p.price) as max_price
  from public.products pr
  join public.prices p on p.barcode = pr.barcode
  join public.stores s on s.id = p.store_id and s.active
  where pr.name like '%' || t.term || '%'
  group by pr.barcode
  order by pr.name like t.term || '%' desc, count(p.store_id) desc, pr.name
  limit 30
) c
order by t.n, c.starts desc, c.stores desc, c.name;
