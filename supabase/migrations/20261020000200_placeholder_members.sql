-- Placeholder members: a partner who has not signed in yet can already be
-- part of the household, so expenses (or a Splitwise import) can name them.
-- Joining with the invite code turns the placeholder into the real account
-- and moves everything recorded under it.

alter table public.household_members
  add column is_placeholder boolean not null default false;

-- A placeholder's user_id is a random uuid with no auth.users row, so the
-- columns that can name one stop referencing auth.users. (created_by,
-- added_by and checked_by are always the signed-in user and keep theirs.)
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f'
      and c.confrelid = 'auth.users'::regclass
      and (c.conrelid::regclass::text, a.attname) in (
        ('household_members', 'user_id'),
        ('expenses', 'paid_by'),
        ('expense_shares', 'user_id'),
        ('settlements', 'from_user'),
        ('settlements', 'to_user'),
        ('bills', 'paid_by_default'),
        ('bill_payments', 'paid_by'),
        ('chores', 'assignee_id'),
        ('chore_completions', 'done_by')
      )
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
end;
$$;

-- Members may rename and recolor each other, but never flip is_placeholder
-- (that would let the next person with the code take over a real member).
revoke update on public.household_members from authenticated;
grant update (display_name, color, default_share_pct) on public.household_members to authenticated;

create or replace function public.add_placeholder_member(p_household_id uuid, p_display_name text)
returns public.household_members
language plpgsql
security definer
set search_path = public
as $$
declare
  m public.household_members;
  member_count int;
begin
  if not public.is_member(p_household_id) then
    raise exception 'not a member';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'name required';
  end if;
  insert into public.household_members (household_id, user_id, display_name, color, default_share_pct, is_placeholder)
  values (p_household_id, gen_random_uuid(), trim(p_display_name), '#f43f5e', 0, true)
  returning * into m;

  select count(*) into member_count from public.household_members where household_id = p_household_id;
  update public.household_members
  set default_share_pct = round(100.0 / member_count, 2)
  where household_id = p_household_id;

  select * into m from public.household_members where household_id = m.household_id and user_id = m.user_id;
  return m;
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
    update public.expenses set paid_by = me where household_id = h.id and paid_by = placeholder;
    update public.expense_shares set user_id = me where household_id = h.id and user_id = placeholder;
    update public.settlements set from_user = me where household_id = h.id and from_user = placeholder;
    update public.settlements set to_user = me where household_id = h.id and to_user = placeholder;
    update public.bills set paid_by_default = me where household_id = h.id and paid_by_default = placeholder;
    update public.bill_payments set paid_by = me where household_id = h.id and paid_by = placeholder;
    update public.chores set assignee_id = me where household_id = h.id and assignee_id = placeholder;
    update public.chore_completions set done_by = me where household_id = h.id and done_by = placeholder;
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

grant execute on function public.add_placeholder_member(uuid, text) to authenticated;
