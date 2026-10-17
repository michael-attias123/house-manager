-- Prices: supermarket catalogue loaded daily by ingest/ (Price Transparency
-- Law files). Clients can only read; ingest writes with the service role.

create table public.chains (
  id text primary key,
  name text not null,
  chain_code text
);

create table public.stores (
  id bigint generated always as identity primary key,
  chain_id text not null references public.chains (id) on delete cascade,
  store_code text not null,
  name text not null,
  city text,
  address text,
  active boolean not null default true,
  last_ingested_at timestamptz,
  unique (chain_id, store_code)
);

-- barcode is the GTIN for packaged goods. Chain-internal codes (produce,
-- bakery...) are stored as "<chain_id>:<code>" so they never match across chains.
create table public.products (
  barcode text primary key,
  name text not null,
  manufacturer text,
  quantity numeric,
  unit text,
  is_weighted boolean not null default false,
  updated_at timestamptz not null default now()
);

create index products_name_trgm_idx on public.products
  using gin (name extensions.gin_trgm_ops);

create table public.prices (
  store_id bigint not null references public.stores (id) on delete cascade,
  barcode text not null references public.products (barcode) on delete cascade,
  price numeric(10, 2) not null check (price >= 0),
  unit_price numeric(10, 2),
  price_updated_at timestamptz,
  primary key (store_id, barcode)
);

create index prices_barcode_idx on public.prices (barcode);

create table public.price_history (
  store_id bigint not null references public.stores (id) on delete cascade,
  barcode text not null,
  changed_on date not null default current_date,
  old_price numeric(10, 2) not null,
  new_price numeric(10, 2) not null,
  primary key (store_id, barcode, changed_on)
);

create index price_history_barcode_idx on public.price_history (barcode, changed_on desc);

create or replace function public.track_price_change()
returns trigger
language plpgsql
as $$
begin
  if new.price is distinct from old.price then
    insert into public.price_history (store_id, barcode, changed_on, old_price, new_price)
    values (new.store_id, new.barcode, current_date, old.price, new.price)
    on conflict (store_id, barcode, changed_on) do update set new_price = excluded.new_price;
  end if;
  return new;
end;
$$;

create trigger prices_track_change after update on public.prices
  for each row execute function public.track_price_change();

create table public.ingest_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  stats jsonb not null default '{}'::jsonb
);

-- A household's own mapping from a list item name to a product, so linking
-- "חלב" once makes every later "חלב" exact.
create table public.product_links (
  household_id uuid not null references public.households (id) on delete cascade,
  normalized_name text not null,
  barcode text not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, normalized_name)
);

alter table public.shopping_trips
  add constraint shopping_trips_store_fk
  foreign key (store_id) references public.stores (id) on delete set null;

insert into public.chains (id, name) values
  ('shufersal', 'שופרסל'),
  ('rami_levy', 'רמי לוי'),
  ('osher_ad', 'אושר עד'),
  ('carrefour', 'קרפור'),
  ('tiv_taam', 'טיב טעם')
on conflict (id) do nothing;

-- For each still-unchecked list item and each active store: the best match.
-- Exact barcode matches rank first; otherwise the most similar product name.
create or replace function public.basket_matches(p_list_id uuid, p_candidates int default 30)
returns table (
  store_id bigint,
  item_id uuid,
  barcode text,
  product_name text,
  price numeric,
  exact boolean
)
language sql
stable
set search_path = public, extensions
as $$
  with items as (
    select li.id, li.name, li.barcode
    from public.list_items li
    where li.list_id = p_list_id and not li.checked
  ),
  cand as (
    select i.id as item_id, i.barcode, 0 as rank, true as exact
    from items i
    where i.barcode is not null
    union all
    select i.id, c.barcode, c.rank, false
    from items i
    cross join lateral (
      select
        pr.barcode,
        row_number() over (
          order by word_similarity(i.name, pr.name) desc, similarity(i.name, pr.name) desc, pr.barcode
        )::int as rank
      from public.products pr
      where i.name <% pr.name
      order by word_similarity(i.name, pr.name) desc, similarity(i.name, pr.name) desc, pr.barcode
      limit p_candidates
    ) c
  )
  select distinct on (p.store_id, c.item_id)
    p.store_id, c.item_id, c.barcode, pr.name, p.price, c.exact
  from cand c
  join public.prices p on p.barcode = c.barcode
  join public.stores s on s.id = p.store_id and s.active
  join public.products pr on pr.barcode = c.barcode
  order by p.store_id, c.item_id, c.rank, p.price;
$$;

create or replace function public.search_products(p_query text, p_limit int default 20)
returns table (
  barcode text,
  name text,
  manufacturer text,
  min_price numeric,
  max_price numeric,
  store_count int
)
language sql
stable
set search_path = public, extensions
as $$
  with q as (select trim(p_query) as q),
  matched as (
    select pr.*, word_similarity((select q from q), pr.name) as score
    from public.products pr
    where (select q from q) <> ''
      and (
        pr.barcode = (select q from q)
        or (select q from q) <% pr.name
      )
    order by (pr.barcode = (select q from q)) desc, score desc, similarity((select q from q), pr.name) desc
    limit p_limit
  )
  select m.barcode, m.name, m.manufacturer,
    min(p.price), max(p.price), count(p.store_id)::int
  from matched m
  left join public.prices p on p.barcode = m.barcode
  group by m.barcode, m.name, m.manufacturer, m.score
  order by count(p.store_id) > 0 desc, m.score desc;
$$;

alter table public.chains enable row level security;
alter table public.stores enable row level security;
alter table public.products enable row level security;
alter table public.prices enable row level security;
alter table public.price_history enable row level security;
alter table public.ingest_runs enable row level security;
alter table public.product_links enable row level security;

create policy "catalogue is public to users" on public.chains for select to authenticated using (true);
create policy "catalogue is public to users" on public.stores for select to authenticated using (true);
create policy "catalogue is public to users" on public.products for select to authenticated using (true);
create policy "catalogue is public to users" on public.prices for select to authenticated using (true);
create policy "catalogue is public to users" on public.price_history for select to authenticated using (true);
create policy "catalogue is public to users" on public.ingest_runs for select to authenticated using (true);
create policy "members manage product links" on public.product_links
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

grant select on
  public.chains, public.stores, public.products, public.prices, public.price_history, public.ingest_runs
  to authenticated;
grant select, insert, update, delete on public.product_links to authenticated;
grant all on
  public.chains, public.stores, public.products, public.prices, public.price_history,
  public.ingest_runs, public.product_links
  to service_role;
grant execute on function public.basket_matches(uuid, int) to authenticated;
grant execute on function public.search_products(text, int) to authenticated;
