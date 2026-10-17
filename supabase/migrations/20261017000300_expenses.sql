-- Expenses: Splitwise-style shared expenses, shares and settlements.
-- Shares are computed by the client (web/src/features/expenses/lib/split.ts)
-- and validated here; server-side flows (bills) use default_shares().

create table public.expenses (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  description text not null check (length(trim(description)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  paid_by uuid not null references auth.users (id),
  category text not null default 'other',
  expense_date date not null default current_date,
  split_type text not null default 'equal'
    check (split_type in ('equal', 'percent', 'exact', 'full', 'default')),
  note text,
  source text not null default 'manual' check (source in ('manual', 'trip', 'bill')),
  source_id uuid,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index expenses_household_date_idx on public.expenses (household_id, expense_date desc);
create index expenses_source_idx on public.expenses (source, source_id);

create trigger expenses_updated_at before update on public.expenses
  for each row execute function public.set_updated_at();

create table public.expense_shares (
  expense_id uuid not null references public.expenses (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  amount numeric(12, 2) not null check (amount >= 0),
  primary key (expense_id, user_id)
);

create index expense_shares_household_idx on public.expense_shares (household_id);

create table public.settlements (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  from_user uuid not null references auth.users (id),
  to_user uuid not null references auth.users (id),
  amount numeric(12, 2) not null check (amount > 0),
  settled_on date not null default current_date,
  note text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  check (from_user <> to_user)
);

create index settlements_household_idx on public.settlements (household_id, settled_on desc);

-- Net balance per member: positive means the others owe them money.
create view public.member_balances
with (security_invoker = true)
as
select
  m.household_id,
  m.user_id,
  coalesce(paid.total, 0)
    - coalesce(owed.total, 0)
    + coalesce(sent.total, 0)
    - coalesce(received.total, 0) as balance
from public.household_members m
left join (
  select household_id, paid_by as user_id, sum(amount) as total
  from public.expenses group by household_id, paid_by
) paid on paid.household_id = m.household_id and paid.user_id = m.user_id
left join (
  select household_id, user_id, sum(amount) as total
  from public.expense_shares group by household_id, user_id
) owed on owed.household_id = m.household_id and owed.user_id = m.user_id
left join (
  select household_id, from_user as user_id, sum(amount) as total
  from public.settlements group by household_id, from_user
) sent on sent.household_id = m.household_id and sent.user_id = m.user_id
left join (
  select household_id, to_user as user_id, sum(amount) as total
  from public.settlements group by household_id, to_user
) received on received.household_id = m.household_id and received.user_id = m.user_id;

-- Splits an amount by the members' default_share_pct. The rounding remainder
-- goes to the payer when they take part, else to the largest share; this
-- mirrors computeShares() in split.ts.
create or replace function public.default_shares(p_household_id uuid, p_amount numeric, p_paid_by uuid)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  shares jsonb := '{}'::jsonb;
  total_pct numeric;
  allocated numeric := 0;
  remainder_to text;
  r record;
  share numeric;
begin
  select sum(default_share_pct) into total_pct
  from public.household_members where household_id = p_household_id;
  if total_pct is null or total_pct = 0 then
    return jsonb_build_object(p_paid_by::text, p_amount);
  end if;
  for r in
    select user_id, default_share_pct from public.household_members
    where household_id = p_household_id and default_share_pct > 0
    order by default_share_pct desc, joined_at
  loop
    share := floor(p_amount * r.default_share_pct / total_pct * 100) / 100;
    shares := shares || jsonb_build_object(r.user_id::text, share);
    allocated := allocated + share;
    remainder_to := coalesce(remainder_to, r.user_id::text);
  end loop;
  if shares ? p_paid_by::text then
    remainder_to := p_paid_by::text;
  end if;
  shares := jsonb_set(
    shares,
    array[remainder_to],
    to_jsonb((shares ->> remainder_to)::numeric + (p_amount - allocated))
  );
  return shares;
end;
$$;

-- Creates or updates an expense with its shares atomically.
-- p_shares: {"<user_id>": amount, ...}; must sum to p_amount.
create or replace function public.save_expense(
  p_household_id uuid,
  p_description text,
  p_amount numeric,
  p_paid_by uuid,
  p_shares jsonb,
  p_category text default 'other',
  p_expense_date date default current_date,
  p_split_type text default 'equal',
  p_note text default null,
  p_source text default 'manual',
  p_source_id uuid default null,
  p_id uuid default null
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  shares_total numeric;
begin
  if not public.is_member(p_household_id) then
    raise exception 'not a member';
  end if;
  if not exists (select 1 from public.household_members where household_id = p_household_id and user_id = p_paid_by) then
    raise exception 'payer is not a member';
  end if;
  if exists (
    select 1 from jsonb_object_keys(p_shares) k
    where not exists (
      select 1 from public.household_members
      where household_id = p_household_id and user_id = k::uuid
    )
  ) then
    raise exception 'share for a non-member';
  end if;
  select coalesce(sum(value::numeric), 0) into shares_total from jsonb_each_text(p_shares);
  if round(shares_total, 2) <> round(p_amount, 2) then
    raise exception 'shares (%) do not add up to amount (%)', shares_total, p_amount;
  end if;

  if p_id is null then
    insert into public.expenses (
      household_id, description, amount, paid_by, category, expense_date,
      split_type, note, source, source_id
    ) values (
      p_household_id, trim(p_description), p_amount, p_paid_by, coalesce(p_category, 'other'),
      coalesce(p_expense_date, current_date), coalesce(p_split_type, 'equal'), p_note,
      coalesce(p_source, 'manual'), p_source_id
    ) returning id into v_id;
  else
    update public.expenses set
      description = trim(p_description),
      amount = p_amount,
      paid_by = p_paid_by,
      category = coalesce(p_category, 'other'),
      expense_date = coalesce(p_expense_date, current_date),
      split_type = coalesce(p_split_type, 'equal'),
      note = p_note
    where id = p_id and household_id = p_household_id
    returning id into v_id;
    if v_id is null then
      raise exception 'expense not found';
    end if;
    delete from public.expense_shares where expense_id = v_id;
  end if;

  insert into public.expense_shares (expense_id, household_id, user_id, amount)
  select v_id, p_household_id, key::uuid, value::numeric
  from jsonb_each_text(p_shares)
  where value::numeric > 0;

  return v_id;
end;
$$;

alter table public.expenses enable row level security;
alter table public.expense_shares enable row level security;
alter table public.settlements enable row level security;

create policy "members manage expenses" on public.expenses
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members manage shares" on public.expense_shares
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members manage settlements" on public.settlements
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

grant select, insert, update, delete on
  public.expenses, public.expense_shares, public.settlements to authenticated;
grant all on public.expenses, public.expense_shares, public.settlements to service_role;
grant select on public.member_balances to authenticated;
grant execute on function public.default_shares(uuid, numeric, uuid) to authenticated;
grant execute on function
  public.save_expense(uuid, text, numeric, uuid, jsonb, text, date, text, text, text, uuid, uuid)
  to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.expenses;
  end if;
end;
$$;
