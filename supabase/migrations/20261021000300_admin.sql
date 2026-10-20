-- Admin: app-wide management for the owner (web/src/features/admin): the
-- sign-up allowlist, households and accounts.
--
-- Admins are listed in public.app_admins by user id. Clients can neither read
-- nor write it; the only way in is the SQL editor (docs/setup.md). Every
-- admin_* function is security definer and starts by checking is_admin(), so
-- the check happens on the server whatever the client sends.

create table public.app_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- No policies: no client access at all. (Revoked as well, for projects whose
-- default privileges still grant new tables.)
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon, authenticated;
grant all on public.app_admins to service_role;

-- Only ever reads the caller's own row. Never derive admin rights from
-- user_metadata: users can edit their own metadata.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.app_admins where user_id = auth.uid());
$$;

revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;

-- Internal helpers ------------------------------------------------------------
-- Not security definer and not executable by clients: only the definer
-- functions below, join_household and the auth.users trigger call them.

-- The one list of columns that name a household member. A new column that
-- can hold a member id must be added here (and to detach_member's history
-- check if it records something that affects balances).
create or replace function public.move_member_refs(p_household_id uuid, p_from uuid, p_to uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.expenses set paid_by = p_to where household_id = p_household_id and paid_by = p_from;
  update public.expense_shares set user_id = p_to where household_id = p_household_id and user_id = p_from;
  update public.settlements set from_user = p_to where household_id = p_household_id and from_user = p_from;
  update public.settlements set to_user = p_to where household_id = p_household_id and to_user = p_from;
  update public.bills set paid_by_default = p_to where household_id = p_household_id and paid_by_default = p_from;
  update public.bill_payments set paid_by = p_to where household_id = p_household_id and paid_by = p_from;
  update public.chores set assignee_id = p_to where household_id = p_household_id and assignee_id = p_from;
  update public.chore_completions set done_by = p_to where household_id = p_household_id and done_by = p_from;
end;
$$;

-- Takes a member out of a household. The single rule for both an admin
-- removing someone and an account being deleted:
-- * With history (expenses, shares, transfers, bill payments, chores done),
--   the row becomes a placeholder under a new random id that takes over
--   everything recorded under the old one, so names and balances stay. The
--   old id loses access at once. A placeholder with history cannot be
--   removed; deleting the whole household is the way to drop it.
-- * Without history, the row is deleted, defaults that named it are
--   cleared, and the remaining members' default shares are rebalanced.
-- Either way the invite code changes, so the old code cannot be used to
-- come back and claim the placeholder.
create or replace function public.detach_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
set search_path = public
as $$
declare
  m public.household_members;
  has_history boolean;
  member_count int;
begin
  select * into m from public.household_members
  where household_id = p_household_id and user_id = p_user_id
  for update;
  if m.user_id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;

  has_history :=
    exists (select 1 from public.expenses where household_id = p_household_id and paid_by = p_user_id)
    or exists (select 1 from public.expense_shares where household_id = p_household_id and user_id = p_user_id)
    or exists (
      select 1 from public.settlements
      where household_id = p_household_id and (from_user = p_user_id or to_user = p_user_id)
    )
    or exists (select 1 from public.bill_payments where household_id = p_household_id and paid_by = p_user_id)
    or exists (select 1 from public.chore_completions where household_id = p_household_id and done_by = p_user_id);

  if has_history then
    if m.is_placeholder then
      raise exception 'placeholder has history';
    end if;
    declare
      placeholder uuid := gen_random_uuid();
    begin
      update public.household_members
      set user_id = placeholder, is_placeholder = true
      where household_id = p_household_id and user_id = p_user_id;
      perform public.move_member_refs(p_household_id, p_user_id, placeholder);
    end;
  else
    delete from public.household_members where household_id = p_household_id and user_id = p_user_id;
    -- A standing order needs a payer (bills check constraint), so it stops
    -- paying itself until someone picks a new default payer.
    update public.bills set paid_by_default = null, auto_create = false
    where household_id = p_household_id and paid_by_default = p_user_id;
    update public.chores set assignee_id = null
    where household_id = p_household_id and assignee_id = p_user_id;
    select count(*) into member_count from public.household_members where household_id = p_household_id;
    if member_count > 0 then
      update public.household_members
      set default_share_pct = round(100.0 / member_count, 2)
      where household_id = p_household_id;
    end if;
  end if;

  update public.households
  set invite_code = upper(substr(md5(gen_random_uuid()::text), 1, 6))
  where id = p_household_id;
end;
$$;

revoke execute on function public.move_member_refs(uuid, uuid, uuid) from public, anon, authenticated;
revoke execute on function public.detach_member(uuid, uuid) from public, anon, authenticated;

-- join_household, unchanged, with the placeholder takeover through
-- move_member_refs.
create or replace function public.join_household(p_invite_code text, p_display_name text)
returns public.households
language plpgsql
security definer
set search_path = public
as $$
declare
  h public.households;
  me uuid := auth.uid();
  placeholder uuid;
  member_count int;
begin
  if me is null then
    raise exception 'not authenticated';
  end if;
  select * into h from public.households
  where invite_code = upper(trim(p_invite_code));
  if h.id is null then
    raise exception 'invalid invite code' using errcode = 'P0002';
  end if;
  if exists (select 1 from public.household_members where household_id = h.id and user_id = me) then
    return h;
  end if;

  select user_id into placeholder from public.household_members
  where household_id = h.id and is_placeholder
  order by joined_at
  limit 1
  for update;

  if placeholder is not null then
    -- Take over the placeholder: same share and color, everything recorded
    -- under it now belongs to the new account.
    update public.household_members
    set user_id = me,
        is_placeholder = false,
        display_name = coalesce(nullif(trim(p_display_name), ''), display_name),
        joined_at = now()
    where household_id = h.id and user_id = placeholder;
    perform public.move_member_refs(h.id, placeholder, me);
    return h;
  end if;

  insert into public.household_members (household_id, user_id, display_name, color, default_share_pct)
  values (h.id, me, trim(p_display_name), '#f43f5e', 0);

  -- Re-balance default shares equally between all members.
  select count(*) into member_count from public.household_members where household_id = h.id;
  update public.household_members
  set default_share_pct = round(100.0 / member_count, 2)
  where household_id = h.id;
  return h;
end;
$$;

-- An account deleted anywhere (the admin screen, or Authentication → Users
-- in the Supabase dashboard) leaves its households the same way: the member
-- columns no longer reference auth.users (placeholder migration), so without
-- this the member row would stay and still count as a real member.
create or replace function public.handle_deleted_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  for r in select household_id from public.household_members where user_id = old.id loop
    perform public.detach_member(r.household_id, old.id);
  end loop;
  return old;
end;
$$;

revoke execute on function public.handle_deleted_user() from public, anon, authenticated;

create trigger handle_deleted_user
  before delete on auth.users
  for each row execute function public.handle_deleted_user();

-- Admin RPCs ------------------------------------------------------------------

create or replace function public.admin_list_allowed_emails()
returns setof public.allowed_emails
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query select * from public.allowed_emails order by email;
end;
$$;

-- Adding the first address closes sign-up to everyone else, so the caller's
-- own address is added with it: an admin never locks themselves out.
create or replace function public.admin_add_allowed_email(p_email text, p_note text default null)
returns public.allowed_emails
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_note text := nullif(trim(p_note), '');
  v_mine text;
  v_row public.allowed_emails;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  -- Same pattern as isValidEmail() in features/admin/lib/admin.ts.
  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'invalid email' using errcode = '22023';
  end if;

  if not exists (select 1 from public.allowed_emails) then
    select lower(trim(u.email)) into v_mine from auth.users u where u.id = auth.uid();
    if v_mine is not null and v_mine <> v_email then
      insert into public.allowed_emails (email) values (v_mine) on conflict (email) do nothing;
    end if;
  end if;

  -- Upsert: adding an address again without a note keeps the old note.
  insert into public.allowed_emails as ae (email, note) values (v_email, v_note)
  on conflict (email) do update set note = coalesce(excluded.note, ae.note)
  returning * into v_row;
  return v_row;
end;
$$;

-- Removing an address only blocks new sign-ups; an existing account keeps
-- working until it is deleted (admin_delete_user). The list may not become
-- empty from here, since an empty list lets everyone in.
create or replace function public.admin_remove_allowed_email(p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if v_email = (select lower(trim(u.email)) from auth.users u where u.id = auth.uid()) then
    raise exception 'cannot remove your own email';
  end if;
  delete from public.allowed_emails where email = v_email;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.allowed_emails) then
    raise exception 'allowlist cannot be empty';
  end if;
end;
$$;

create or replace function public.admin_list_households()
returns table (
  id uuid,
  name text,
  created_at timestamptz,
  members jsonb,
  expense_count int,
  bill_count int,
  chore_count int,
  list_item_count int
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select
    h.id,
    h.name,
    h.created_at,
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'user_id', m.user_id,
          'display_name', m.display_name,
          'is_placeholder', m.is_placeholder,
          'email', u.email
        )
        order by m.joined_at
      )
      from public.household_members m
      left join auth.users u on u.id = m.user_id
      where m.household_id = h.id
    ), '[]'::jsonb),
    (select count(*)::int from public.expenses e where e.household_id = h.id),
    (select count(*)::int from public.bills b where b.household_id = h.id),
    (select count(*)::int from public.chores c where c.household_id = h.id),
    (select count(*)::int from public.list_items li where li.household_id = h.id)
  from public.households h
  order by h.created_at, h.id;
end;
$$;

-- Everything under a household references it with on delete cascade
-- (db_test.sql checks that), so deleting the row removes all of it.
create or replace function public.admin_delete_household(p_household_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if public.is_member(p_household_id) then
    raise exception 'cannot delete your own household';
  end if;
  delete from public.households where id = p_household_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_remove_member(p_household_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot remove yourself';
  end if;
  perform public.detach_member(p_household_id, p_user_id);
end;
$$;

create or replace function public.admin_list_users()
returns table (
  id uuid,
  email text,
  full_name text,
  created_at timestamptz,
  last_sign_in_at timestamptz,
  is_admin boolean,
  on_allowlist boolean,
  household_names text[]
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select
    u.id,
    u.email::text,
    (u.raw_user_meta_data ->> 'full_name')::text,
    u.created_at::timestamptz,
    u.last_sign_in_at::timestamptz,
    exists (select 1 from public.app_admins a where a.user_id = u.id),
    exists (select 1 from public.allowed_emails ae where ae.email = lower(trim(u.email))),
    coalesce((
      select array_agg(h.name order by h.name)
      from public.household_members m
      join public.households h on h.id = m.household_id
      where m.user_id = u.id
    ), '{}'::text[])
  from auth.users u
  order by u.created_at, u.id;
end;
$$;

-- The before delete trigger on auth.users detaches the account from its
-- households first (handle_deleted_user). The address stays on the
-- allowlist, so the person could sign up again; remove it there too to stop
-- that.
create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'cannot delete your own account';
  end if;
  if exists (select 1 from public.app_admins where user_id = p_user_id) then
    raise exception 'cannot delete an admin';
  end if;
  delete from auth.users where id = p_user_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke execute on function
  public.admin_list_allowed_emails(),
  public.admin_add_allowed_email(text, text),
  public.admin_remove_allowed_email(text),
  public.admin_list_households(),
  public.admin_delete_household(uuid),
  public.admin_remove_member(uuid, uuid),
  public.admin_list_users(),
  public.admin_delete_user(uuid)
  from public, anon;
grant execute on function
  public.admin_list_allowed_emails(),
  public.admin_add_allowed_email(text, text),
  public.admin_remove_allowed_email(text),
  public.admin_list_households(),
  public.admin_delete_household(uuid),
  public.admin_remove_member(uuid, uuid),
  public.admin_list_users(),
  public.admin_delete_user(uuid)
  to authenticated;
