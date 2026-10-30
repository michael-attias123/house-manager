-- "לאן יוצאים": the household's favorite places, shown on top of the list,
-- and a deal kind for keva club card ("כרטיס חבר") discounts.

-- A star either partner sets shows for both.
create table public.venue_favorites (
  household_id uuid not null references public.households (id) on delete cascade,
  venue_id bigint not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (household_id, venue_id)
);

alter table public.venue_favorites enable row level security;

create policy "members manage venue favorites" on public.venue_favorites
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

grant select, insert, delete on public.venue_favorites to authenticated;
grant all on public.venue_favorites to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.venue_favorites;
  end if;
end;
$$;

-- A discount for card holders: standing, so the app keeps it out of "עכשיו".
alter table public.venue_deals
  drop constraint venue_deals_kind_check,
  add constraint venue_deals_kind_check
    check (kind in ('happy_hour', 'special_day', 'event', 'member_card'));

-- As before, and the merged place's stars move to the place it went into.
create or replace function public.admin_merge_venue(p_from bigint, p_into bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.venues;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into f from public.venues where id = p_from for update;
  if f.id is null or f.status = 'approved' then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.venues where id = p_into and status = 'approved') then
    raise exception 'venue not approved' using errcode = '22023';
  end if;
  update public.venue_deals set venue_id = p_into where venue_id = p_from;
  insert into public.venue_favorites (household_id, venue_id, created_at)
    select household_id, p_into, created_at from public.venue_favorites where venue_id = p_from
    on conflict do nothing;
  delete from public.venues where id = p_from;
end;
$$;
