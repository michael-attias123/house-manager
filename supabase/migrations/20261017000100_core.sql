-- Core: households and their members. Every feature table carries a
-- household_id and is protected by RLS through public.is_member().

create extension if not exists pg_trgm with schema extensions;

create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null default 'הבית שלנו',
  invite_code text not null unique
    default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) > 0),
  color text not null default '#0ea5e9',
  -- Default share of shared expenses, in percent. Members of a household
  -- should add up to 100.
  default_share_pct numeric(5, 2) not null default 50
    check (default_share_pct >= 0 and default_share_pct <= 100),
  joined_at timestamptz not null default now(),
  primary key (household_id, user_id)
);

create index household_members_user_id_idx on public.household_members (user_id);

-- security definer so policies on household_members can call it without
-- recursing into their own RLS.
create or replace function public.is_member(hid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.household_members
    where household_id = hid and user_id = auth.uid()
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

alter table public.households enable row level security;
alter table public.household_members enable row level security;

create policy "members read their household" on public.households
  for select to authenticated using (public.is_member(id));
create policy "members update their household" on public.households
  for update to authenticated using (public.is_member(id)) with check (public.is_member(id));

create policy "members read members" on public.household_members
  for select to authenticated using (public.is_member(household_id));
create policy "members update members" on public.household_members
  for update to authenticated using (public.is_member(household_id))
  with check (public.is_member(household_id));
create policy "members leave" on public.household_members
  for delete to authenticated using (user_id = auth.uid());

-- Creating and joining go through these functions so a user can only ever
-- add themselves, and only with a valid invite code.
create or replace function public.create_household(p_name text, p_display_name text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  insert into public.households (name)
  values (coalesce(nullif(trim(p_name), ''), 'הבית שלנו'))
  returning * into h;
  insert into public.household_members (household_id, user_id, display_name, color, default_share_pct)
  values (h.id, auth.uid(), trim(p_display_name), '#0ea5e9', 100);
  return h;
end;
$$;

create or replace function public.join_household(p_invite_code text, p_display_name text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
  member_count int;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;
  select * into h from public.households
  where invite_code = upper(trim(p_invite_code));
  if h.id is null then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members where household_id = h.id and user_id = auth.uid()) then
    return h;
  end if;

  insert into public.household_members (household_id, user_id, display_name, color, default_share_pct)
  values (h.id, auth.uid(), trim(p_display_name), '#f43f5e', 0);

  -- Re-balance default shares equally between all members.
  select count(*) into member_count from public.household_members where household_id = h.id;
  update public.household_members
  set default_share_pct = round(100.0 / member_count, 2)
  where household_id = h.id;
  return h;
end;
$$;

create or replace function public.regenerate_invite_code(p_household_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  code text;
begin
  if not public.is_member(p_household_id) then
    raise exception 'not a member';
  end if;
  code := upper(substr(md5(gen_random_uuid()::text), 1, 6));
  update public.households set invite_code = code where id = p_household_id;
  return code;
end;
$$;

grant usage on schema public to anon, authenticated, service_role;
grant select, update on public.households to authenticated;
grant select, update, delete on public.household_members to authenticated;
grant all on public.households, public.household_members to service_role;
grant execute on function public.is_member(uuid) to authenticated;
grant execute on function public.create_household(text, text) to authenticated;
grant execute on function public.join_household(text, text) to authenticated;
grant execute on function public.regenerate_invite_code(uuid) to authenticated;
