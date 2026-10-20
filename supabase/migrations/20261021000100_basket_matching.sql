-- Basket matching by product type and pack size instead of name similarity.
--
-- Product names lead with what the product is ("ביצים אריזון 12 גדול",
-- "סלט ביצים"), so an item matches products whose name starts with it, and
-- only falls back to whole words, then to similarity, when nothing does.
-- Each product also gets a normalized pack size, so a basket compares the
-- same kind and size of product in every store (12 eggs, 1 liter of milk,
-- tomatoes per kg). Which pack and which variant to pick is decided in the
-- client (features/prices/lib/match.ts); match_candidates returns, for every
-- store and pack size, the cheapest product of the best-matching tier.

-- Lowercase, no quotes or punctuation, digits split from letters:
-- 'קמח לבן 1 ק"ג.' → 'קמח לבן 1 קג', '18ביצים L' → '18 ביצים l', '4*160גר' → '4 * 160 גר'.
-- web/src/features/prices/lib/normalize.ts applies the same rules.
create or replace function public.norm_name(p text)
returns text
language sql
immutable
parallel safe
as $$
  select trim(regexp_replace(
    regexp_replace(
      regexp_replace(
        regexp_replace(
          regexp_replace(
            regexp_replace(
              translate(lower(coalesce(p, '')), '"''`׳״', ''),
              '\s*[*×]\s*', ' * ', 'g'),
            '(?<![0-9])\.|\.(?![0-9])', ' ', 'g'),
          '[^0-9a-zא-ת%.*]+', ' ', 'g'),
        '([0-9%])([a-zא-ת])|([a-zא-ת])([0-9])', '\1\3 \2\4', 'g'),
      '%(?=\S)', '% ', 'g'),
    '\s+', ' ', 'g'));
$$;

-- Pack size as '<unit> <quantity>' with unit g (grams), ml, u (units) or m
-- (meters); weighted products are priced per kg, so always 'g 1000'.
-- The name is preferred ('שמן חמניות 1 ליטר' is filed as 100 ml), then the
-- Quantity/UnitOfMeasure fields.
create or replace function public.product_pack(p_name text, p_quantity numeric, p_unit text, p_weighted boolean)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  n text := ' ' || public.norm_name(p_name) || ' ';
  num constant text := '([0-9]+(?:\.[0-9]+)?)';
  units constant text := '(קילוגרם|קילו|קג|ק|גרם|גר|ג|מיליליטר|מל|ליטר|ליט|לי|ל|יחידות|יחידה|יחיד|יחי|יח|י|גלילים|גליל|גל|שקיקים|מטרים|מטר)';
  m text[];
  qty numeric;
  unit text;
  mult numeric := 1;
  field_unit text := lower(coalesce(p_unit, ''));
begin
  if p_weighted then
    return 'g 1000';
  end if;

  -- "4 * 160 גר", "80 גר * 3", then "750 גרם"; weight and volume win over a unit count.
  m := regexp_match(n, ' ' || num || ' \* ' || num || ' ' || units || ' ');
  if m is not null then
    mult := m[1]::numeric; qty := m[2]::numeric; unit := m[3];
  else
    m := regexp_match(n, ' ' || num || ' ' || units || ' \* ' || num || ' ');
    if m is not null then
      qty := m[1]::numeric; unit := m[2]; mult := m[3]::numeric;
    else
      m := regexp_match(n, ' ' || num || ' (קילוגרם|קילו|קג|גרם|גר|ג|מיליליטר|מל|ליטר|ליט|לי|ל|מטרים|מטר) ');
      if m is null then
        m := regexp_match(n, ' ' || num || ' ' || units || ' ');
      end if;
      if m is not null then
        qty := m[1]::numeric; unit := m[2];
      end if;
    end if;
  end if;

  if unit is not null and qty > 0 then
    qty := qty * mult;
    return case
      when unit in ('קילוגרם', 'קילו', 'קג', 'ק') then 'g ' || (qty * 1000)
      when unit in ('גרם', 'גר', 'ג') then 'g ' || qty
      when unit in ('מיליליטר', 'מל') then 'ml ' || qty
      when unit in ('ליטר', 'ליט', 'לי', 'ל') then 'ml ' || (qty * 1000)
      when unit in ('מטרים', 'מטר') then 'm ' || qty
      else 'u ' || qty
    end;
  end if;

  -- From the fields: Quantity is in grams/ml when UnitOfMeasure is per 100.
  if p_quantity is null or p_quantity <= 0 then
    qty := null;
  else
    qty := p_quantity;
  end if;
  if qty is not null then
    if field_unit like '%קילו%' or field_unit like '%ק"ג%' then
      return 'g ' || (qty * case when qty >= 50 then 1 else 1000 end);
    elsif field_unit like '%גרם%' then
      return 'g ' || qty;
    elsif field_unit like '%מיליליטר%' or field_unit like '%מ"ל%' then
      return 'ml ' || qty;
    elsif field_unit like '%ליטר%' then
      return 'ml ' || (qty * case when qty >= 50 then 1 else 1000 end);
    elsif field_unit like '%מטר%' then
      return 'm ' || qty;
    end if;
  end if;

  -- A carton filed as one unit: "ביצים אריזון 12 גדול" holds 12.
  m := regexp_match(n, ' ([0-9]{1,2}) ');
  if m is not null and m[1]::int between 2 and 60 then
    return 'u ' || m[1];
  end if;
  if field_unit like '%יחיד%' and qty is not null then
    return 'u ' || qty;
  end if;
  return null;
end;
$$;

alter table public.products
  add column name_norm text generated always as (public.norm_name(name)) stored,
  -- name_norm without leading numbers ("12 ביצים אריזון" leads with ביצים).
  add column name_head text generated always as
    (regexp_replace(public.norm_name(name), '^([0-9][0-9.]* )+', '')) stored,
  add column pack_unit text generated always as
    (split_part(public.product_pack(name, quantity, unit, is_weighted), ' ', 1)) stored,
  add column pack_qty numeric generated always as
    (nullif(split_part(public.product_pack(name, quantity, unit, is_weighted), ' ', 2), '')::numeric) stored;

create index products_name_norm_trgm_idx on public.products
  using gin (name_norm extensions.gin_trgm_ops);
create index products_name_head_idx on public.products (name_head text_pattern_ops);

-- Does `name` contain `phrase` as whole words? Both normalized.
create or replace function public.has_words(name text, phrase text)
returns boolean
language sql
immutable
parallel safe
as $$
  select phrase <> '' and position(' ' || phrase || ' ' in ' ' || name || ' ') > 0;
$$;

-- Does a name (its head, normalized) lead with this term? Either the whole
-- phrase, or its first word when the name has the other words too (checked
-- by the caller).
create or replace function public.leads_with(head text, term text)
returns boolean
language sql
immutable
parallel safe
as $$
  select head = term
    or left(head, length(term) + 1) = term || ' '
    or split_part(head, ' ', 1) = split_part(term, ' ', 1);
$$;

-- p_items: [{"id": "...", "terms": ["ביצים"], "exclude": ["סלט"], "require": ["l", "גדול"],
--            "weighted": true|false|null, "barcode": "..."|null}]
-- One row per item, store and pack size: the cheapest product of the item's
-- best tier there (1: name starts with a term, 2: has all its words, 3:
-- similar), plus tier 0 rows for a linked barcode.
create or replace function public.match_candidates(p_items jsonb)
returns table (
  item_id text,
  tier int,
  store_id bigint,
  barcode text,
  product_name text,
  price numeric,
  pack_unit text,
  pack_qty numeric,
  is_weighted boolean
)
language sql
stable
-- Row estimates for a jsonb argument are guesses, and JIT for a guessed big
-- query costs a second per call.
set jit = off
set search_path = public, extensions
as $$
  with items as materialized (
    select
      i ->> 'id' as item_id,
      coalesce(i -> 'terms', '[]') as terms,
      array(select public.norm_name(x) from jsonb_array_elements_text(coalesce(i -> 'exclude', '[]')) x) as exclude,
      array(select public.norm_name(x) from jsonb_array_elements_text(coalesce(i -> 'require', '[]')) x) as req,
      (i ->> 'weighted')::boolean as weighted,
      nullif(i ->> 'barcode', '') as barcode
    from jsonb_array_elements(p_items) i
  ),
  terms as materialized (
    select distinct it.item_id, public.norm_name(t) as t
    from items it, jsonb_array_elements_text(it.terms) t
    where public.norm_name(t) <> ''
  ),
  -- Tier 1: the name starts with the term, or with its first word and has
  -- the rest ("ביצים 12 יח בינוני M" for "ביצים M"). Tier 2: has all its words.
  t12 as materialized (
    select tm.item_id, c.barcode, c.tier
    from terms tm
    cross join lateral (
      select pr.barcode,
        case when public.leads_with(pr.name_head, tm.t) then 1 else 2 end as tier
      from public.products pr
      where pr.name_norm like '%' || split_part(tm.t, ' ', 1) || '%'
        and (' ' || pr.name_norm || ' ') like all (
          select '% ' || w || ' %' from regexp_split_to_table(tm.t, ' ') w
        )
    ) c
  ),
  -- Tier 3: similar names, only for items nothing above matched.
  t3 as materialized (
    select tm.item_id, pr.barcode, 3 as tier
    from terms tm
    join public.products pr on tm.t <% pr.name_norm
    where not exists (select 1 from t12 where t12.item_id = tm.item_id)
  ),
  filtered as materialized (
    select c.item_id, c.barcode, min(c.tier) as tier
    from (select * from t12 union all select * from t3) c
    join items it on it.item_id = c.item_id
    join public.products pr on pr.barcode = c.barcode
    where not exists (select 1 from unnest(it.exclude) x where public.has_words(pr.name_norm, x))
      and (cardinality(it.req) = 0 or exists (select 1 from unnest(it.req) r where public.has_words(pr.name_norm, r)))
      and (it.weighted is null or pr.is_weighted = it.weighted)
    group by c.item_id, c.barcode
  ),
  best as materialized (
    select f.item_id, f.barcode, f.tier
    from (select *, min(tier) over (partition by item_id) as best_tier from filtered) f
    where f.tier = f.best_tier
    union all
    select it.item_id, it.barcode, 0 from items it where it.barcode is not null
  )
  select distinct on (b.item_id, b.tier = 0, p.store_id, pr.pack_unit, pr.pack_qty, pr.is_weighted)
    b.item_id, b.tier, p.store_id, pr.barcode, pr.name, p.price, pr.pack_unit, pr.pack_qty, pr.is_weighted
  from best b
  join public.products pr on pr.barcode = b.barcode
  cross join lateral (
    select p.store_id, p.price
    from public.prices p
    join public.stores s on s.id = p.store_id and s.active
    where p.barcode = b.barcode
  ) p
  order by b.item_id, b.tier = 0, p.store_id, pr.pack_unit, pr.pack_qty, pr.is_weighted, p.price, pr.barcode;
$$;

-- The product picker: a barcode, or names by the same tiers, widely sold first.
drop function public.search_products(text, int);
create function public.search_products(p_query text, p_limit int default 25)
returns table (
  barcode text,
  name text,
  manufacturer text,
  pack_unit text,
  pack_qty numeric,
  is_weighted boolean,
  min_price numeric,
  max_price numeric,
  store_count int
)
language sql
stable
set jit = off
set search_path = public, extensions
as $$
  with q as (select trim(coalesce(p_query, '')) as raw, public.norm_name(p_query) as t),
  matched as (
    select pr.barcode, 0 as tier from public.products pr, q where pr.barcode = q.raw
    union all
    select pr.barcode, case when public.leads_with(pr.name_head, q.t) then 1 else 2 end
    from public.products pr, q
    where q.t <> '' and pr.name_norm like '%' || split_part(q.t, ' ', 1) || '%'
      and (' ' || pr.name_norm || ' ') like all (select '% ' || w || ' %' from regexp_split_to_table(q.t, ' ') w)
    union all
    select pr.barcode, 3 from public.products pr, q
    where q.t <> '' and q.t <% pr.name_norm
  ),
  ranked as (
    select m.barcode, min(m.tier) as tier from matched m group by m.barcode
  )
  select pr.barcode, pr.name, pr.manufacturer, pr.pack_unit, pr.pack_qty, pr.is_weighted,
    min(p.price), max(p.price), count(s.id)::int
  from ranked r
  join public.products pr on pr.barcode = r.barcode
  left join public.prices p on p.barcode = r.barcode
  left join public.stores s on s.id = p.store_id and s.active
  group by pr.barcode, r.tier
  order by r.tier, count(s.id) > 0 desc, count(s.id) desc, pr.name
  limit p_limit;
$$;

drop function public.basket_matches(uuid, int);

grant execute on function public.norm_name(text) to authenticated;
grant execute on function public.match_candidates(jsonb) to authenticated;
grant execute on function public.search_products(text, int) to authenticated;
