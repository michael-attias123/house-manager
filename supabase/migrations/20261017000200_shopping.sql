-- Shopping: shared lists, their items, completed trips and purchase history.

create table public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null default 'קניות',
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create index shopping_lists_household_idx on public.shopping_lists (household_id);

create table public.list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid not null references public.shopping_lists (id) on delete cascade,
  -- Denormalised from the list so RLS and realtime filters stay cheap.
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit text,
  category text not null default 'other',
  note text,
  barcode text,
  checked boolean not null default false,
  checked_by uuid references auth.users (id) on delete set null,
  checked_at timestamptz,
  added_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index list_items_list_idx on public.list_items (list_id);
create index list_items_household_idx on public.list_items (household_id);

create trigger list_items_updated_at before update on public.list_items
  for each row execute function public.set_updated_at();

create table public.shopping_trips (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  store_id bigint,
  store_name text,
  total numeric(12, 2) check (total is null or total >= 0),
  trip_date date not null default current_date,
  item_count int not null default 0,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);

create index shopping_trips_household_idx on public.shopping_trips (household_id, trip_date desc);

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  trip_id uuid references public.shopping_trips (id) on delete cascade,
  name text not null,
  normalized_name text generated always as (lower(trim(name))) stored,
  category text not null default 'other',
  barcode text,
  quantity numeric(10, 2) not null default 1,
  unit text,
  purchased_at timestamptz not null default now()
);

create index purchases_household_idx on public.purchases (household_id, purchased_at desc);
create index purchases_name_idx on public.purchases (household_id, normalized_name);

-- What the household buys, most frequent first. Feeds autocomplete and the
-- "running low" insight.
create view public.frequent_items
with (security_invoker = true)
as
select
  household_id,
  normalized_name,
  (array_agg(name order by purchased_at desc))[1] as name,
  (array_agg(category order by purchased_at desc))[1] as category,
  (array_agg(barcode order by purchased_at desc) filter (where barcode is not null))[1] as barcode,
  count(*)::int as times_bought,
  max(purchased_at) as last_bought_at,
  min(purchased_at) as first_bought_at
from public.purchases
group by household_id, normalized_name;

-- Every household gets a default list.
create or replace function public.create_default_list()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.shopping_lists (household_id, name, is_default)
  values (new.id, 'קניות', true);
  return new;
end;
$$;

create trigger households_default_list after insert on public.households
  for each row execute function public.create_default_list();

-- Moves the checked items of a list into purchase history and records the
-- trip. Returns the trip id; the client then records the expense.
create or replace function public.complete_trip(
  p_list_id uuid,
  p_store_id bigint default null,
  p_store_name text default null,
  p_total numeric default null,
  p_trip_date date default current_date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  l public.shopping_lists;
  v_trip_id uuid;
  n int;
begin
  select * into l from public.shopping_lists where id = p_list_id;
  if l.id is null or not public.is_member(l.household_id) then
    raise exception 'list not found';
  end if;

  insert into public.shopping_trips (household_id, store_id, store_name, total, trip_date)
  values (l.household_id, p_store_id, p_store_name, p_total, coalesce(p_trip_date, current_date))
  returning id into v_trip_id;

  insert into public.purchases (household_id, trip_id, name, category, barcode, quantity, unit, purchased_at)
  select household_id, v_trip_id, name, category, barcode, quantity, unit, coalesce(checked_at, now())
  from public.list_items
  where list_id = p_list_id and checked;
  get diagnostics n = row_count;

  delete from public.list_items where list_id = p_list_id and checked;
  update public.shopping_trips set item_count = n where id = v_trip_id;
  return v_trip_id;
end;
$$;

alter table public.shopping_lists enable row level security;
alter table public.list_items enable row level security;
alter table public.shopping_trips enable row level security;
alter table public.purchases enable row level security;

create policy "members manage lists" on public.shopping_lists
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members manage items" on public.list_items
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members manage trips" on public.shopping_trips
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members manage purchases" on public.purchases
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

grant select, insert, update, delete on
  public.shopping_lists, public.list_items, public.shopping_trips, public.purchases
  to authenticated;
grant all on
  public.shopping_lists, public.list_items, public.shopping_trips, public.purchases
  to service_role;
grant select on public.frequent_items to authenticated;
grant execute on function public.complete_trip(uuid, bigint, text, numeric, date) to authenticated;

-- Live updates for the shared list. The publication only exists on Supabase.
alter table public.list_items replica identity full;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.list_items;
  end if;
end;
$$;
