-- Insights: server-side helpers for the rule engine in
-- web/src/features/insights. Most rules run on data the client already has.

-- Price changes in the last p_days for products the household buys.
create or replace function public.recent_price_changes(p_household_id uuid, p_days int default 30)
returns table (
  barcode text,
  product_name text,
  store_id bigint,
  changed_on date,
  old_price numeric,
  new_price numeric,
  times_bought int
)
language sql
stable
set search_path = public
as $$
  select distinct on (h.barcode, h.store_id)
    h.barcode, pr.name, h.store_id, h.changed_on, h.old_price, h.new_price, f.times_bought
  from public.frequent_items f
  join public.price_history h on h.barcode = f.barcode
  join public.products pr on pr.barcode = h.barcode
  where f.household_id = p_household_id
    and public.is_member(p_household_id)
    and h.changed_on >= current_date - p_days
  order by h.barcode, h.store_id, h.changed_on desc;
$$;

grant execute on function public.recent_price_changes(uuid, int) to authenticated;
