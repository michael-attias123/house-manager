-- Read-only CSV slice of the catalogue around some item names, for testing
-- the basket matching locally on real data (see price-probe.yml, dump=true).
\set ON_ERROR_STOP 1
set default_transaction_read_only = on;
set statement_timeout = '120s';

\echo ---STORES---
copy (
  select id, chain_id, store_code, name, city, active from public.stores where active
) to stdout with csv;

\echo ---PRODUCTS---
copy (
  with words as (
    select distinct w
    from unnest(string_to_array(:'terms', ',')) as t, regexp_split_to_table(trim(t), '\s+') as w
    where length(w) >= 2
  )
  select pr.barcode, pr.name, pr.manufacturer, pr.quantity, pr.unit, pr.is_weighted
  from public.products pr
  where exists (select 1 from words where pr.name ~ ('(^|[^א-ת])' || w || '([^א-ת]|$)'))
) to stdout with csv;

\echo ---PRICES---
copy (
  with words as (
    select distinct w
    from unnest(string_to_array(:'terms', ',')) as t, regexp_split_to_table(trim(t), '\s+') as w
    where length(w) >= 2
  )
  select p.store_id, p.barcode, p.price
  from public.prices p
  join public.products pr on pr.barcode = p.barcode
  join public.stores s on s.id = p.store_id and s.active
  where exists (select 1 from words where pr.name ~ ('(^|[^א-ת])' || w || '([^א-ת]|$)'))
) to stdout with csv;
