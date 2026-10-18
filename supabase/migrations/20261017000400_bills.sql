-- Bills: recurring payments (arnona, electricity, rent, subscriptions...).
-- Paying a bill records a bill_payment and a shared expense, then advances
-- the due date. Fixed bills with auto_create are paid by a daily cron job.

create table public.bills (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  provider text,
  category text not null default 'bills',
  icon text,
  amount_type text not null default 'variable' check (amount_type in ('fixed', 'variable')),
  -- The fixed amount, or an estimate for variable bills.
  amount numeric(12, 2) check (amount is null or amount > 0),
  frequency text not null default 'monthly'
    check (frequency in ('monthly', 'bimonthly', 'quarterly', 'yearly')),
  next_due_date date not null,
  paid_by_default uuid references auth.users (id) on delete set null,
  auto_create boolean not null default false,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not auto_create or (amount_type = 'fixed' and amount is not null and paid_by_default is not null))
);

create index bills_household_idx on public.bills (household_id, next_due_date);

create trigger bills_updated_at before update on public.bills
  for each row execute function public.set_updated_at();

create table public.bill_payments (
  id uuid primary key default gen_random_uuid(),
  bill_id uuid not null references public.bills (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  due_date date not null,
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  paid_by uuid not null references auth.users (id),
  expense_id uuid references public.expenses (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (bill_id, due_date)
);

create index bill_payments_household_idx on public.bill_payments (household_id, paid_on desc);

create or replace function public.advance_due_date(d date, frequency text)
returns date
language sql
immutable
as $$
  select (d + case frequency
    when 'monthly' then interval '1 month'
    when 'bimonthly' then interval '2 months'
    when 'quarterly' then interval '3 months'
    when 'yearly' then interval '1 year'
  end)::date;
$$;

-- Internal: records one payment for the bill's current due date.
create or replace function public.record_bill_payment(
  b public.bills,
  p_amount numeric,
  p_paid_by uuid,
  p_paid_on date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_expense_id uuid;
  v_payment_id uuid;
  v_shares jsonb;
begin
  v_shares := public.default_shares(b.household_id, p_amount, p_paid_by);
  insert into public.expenses (
    household_id, description, amount, paid_by, category, expense_date, split_type, source, source_id
  ) values (
    b.household_id, b.name, p_amount, p_paid_by, b.category, p_paid_on, 'default', 'bill', b.id
  ) returning id into v_expense_id;

  insert into public.expense_shares (expense_id, household_id, user_id, amount)
  select v_expense_id, b.household_id, key::uuid, value::numeric
  from jsonb_each_text(v_shares) where value::numeric > 0;

  insert into public.bill_payments (bill_id, household_id, due_date, amount, paid_on, paid_by, expense_id)
  values (b.id, b.household_id, b.next_due_date, p_amount, p_paid_on, p_paid_by, v_expense_id)
  returning id into v_payment_id;

  update public.bills
  set next_due_date = public.advance_due_date(b.next_due_date, b.frequency)
  where id = b.id;
  return v_payment_id;
end;
$$;

create or replace function public.pay_bill(
  p_bill_id uuid,
  p_amount numeric default null,
  p_paid_by uuid default null,
  p_paid_on date default current_date
)
returns uuid
language plpgsql
set search_path = public
as $$
declare
  b public.bills;
  v_amount numeric;
  v_paid_by uuid;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if b.id is null or not public.is_member(b.household_id) then
    raise exception 'bill not found';
  end if;
  v_amount := coalesce(p_amount, b.amount);
  if v_amount is null or v_amount <= 0 then
    raise exception 'amount is required';
  end if;
  v_paid_by := coalesce(p_paid_by, b.paid_by_default, auth.uid());
  if not exists (select 1 from public.household_members where household_id = b.household_id and user_id = v_paid_by) then
    raise exception 'payer is not a member';
  end if;
  return public.record_bill_payment(b, v_amount, v_paid_by, coalesce(p_paid_on, current_date));
end;
$$;

-- Skips the current period without paying (e.g. a bill that was waived).
create or replace function public.skip_bill(p_bill_id uuid)
returns date
language plpgsql
set search_path = public
as $$
declare
  b public.bills;
begin
  select * into b from public.bills where id = p_bill_id for update;
  if b.id is null or not public.is_member(b.household_id) then
    raise exception 'bill not found';
  end if;
  update public.bills set next_due_date = public.advance_due_date(b.next_due_date, b.frequency)
  where id = b.id;
  return public.advance_due_date(b.next_due_date, b.frequency);
end;
$$;

-- Run daily by pg_cron: pays every due fixed bill marked auto_create,
-- catching up on missed periods.
create or replace function public.auto_pay_due_bills()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bills;
  n int := 0;
begin
  loop
    select * into b from public.bills
    where active and auto_create and next_due_date <= current_date
    order by next_due_date
    limit 1
    for update skip locked;
    exit when b.id is null;
    perform public.record_bill_payment(b, b.amount, b.paid_by_default, b.next_due_date);
    n := n + 1;
  end loop;
  return n;
end;
$$;

alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;

create policy "members manage bills" on public.bills
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members manage bill payments" on public.bill_payments
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

grant select, insert, update, delete on public.bills, public.bill_payments to authenticated;
grant all on public.bills, public.bill_payments to service_role;
grant execute on function public.pay_bill(uuid, numeric, uuid, date) to authenticated;
grant execute on function public.skip_bill(uuid) to authenticated;
revoke execute on function public.auto_pay_due_bills() from public, anon, authenticated;

-- pg_cron is available on Supabase; skipped where it is not installed.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('auto-pay-due-bills', '15 4 * * *', 'select public.auto_pay_due_bills()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$$;
