-- End-to-end checks for the migrations: RLS isolation and the RPCs.
-- Run with scripts/db-test.sh (plain Postgres + tests/local_stub.sql).
\set ON_ERROR_STOP 1

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'michael@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'partner@example.com'),
  ('00000000-0000-0000-0000-00000000000c', 'stranger@example.com');

create or replace function public.test_login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, false);
$$;
grant execute on function public.test_login(uuid) to authenticated;

-- Household creation and joining -------------------------------------------
set role authenticated;
select public.test_login('00000000-0000-0000-0000-00000000000a');
select id as hid, invite_code from public.create_household('הבית שלנו', 'מיכאל') \gset

select public.test_login('00000000-0000-0000-0000-00000000000b');
select public.join_household(lower(:'invite_code'), 'שירן');

do $$
declare
  n int;
  pct numeric;
begin
  select count(*), sum(default_share_pct) into n, pct from public.household_members;
  assert n = 2, format('expected 2 members, got %s', n);
  assert pct = 100, format('expected shares to total 100, got %s', pct);
  assert (select count(*) from public.shopping_lists where is_default) = 1, 'default list missing';
end;
$$;

-- A stranger sees nothing and cannot write -----------------------------------
select public.test_login('00000000-0000-0000-0000-00000000000c');
do $$
begin
  assert (select count(*) from public.households) = 0, 'stranger sees households';
  assert (select count(*) from public.household_members) = 0, 'stranger sees members';
  assert (select count(*) from public.shopping_lists) = 0, 'stranger sees lists';
end;
$$;

select set_config('test.hid', :'hid', false);
do $$
begin
  begin
    insert into public.list_items (list_id, household_id, name)
    values (gen_random_uuid(), current_setting('test.hid')::uuid, 'פריצה');
    raise exception 'stranger insert should have failed';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.join_household('WRONG1', 'זר');
    raise exception 'invalid invite code accepted';
  exception when no_data_found then null;
  end;
end;
$$;

-- Shopping list and completing a trip ----------------------------------------
select public.test_login('00000000-0000-0000-0000-00000000000a');
select id as list_id from public.shopping_lists where is_default \gset

insert into public.list_items (list_id, household_id, name, category, checked, checked_at) values
  (:'list_id', :'hid', 'חלב', 'dairy', true, now()),
  (:'list_id', :'hid', 'לחם', 'bakery', true, now()),
  (:'list_id', :'hid', 'עגבניות', 'produce', false, null);

select public.complete_trip(:'list_id', null, 'רמי לוי', 120.50) as trip_id \gset

do $$
begin
  assert (select count(*) from public.list_items) = 1, 'checked items were not removed';
  assert (select count(*) from public.purchases) = 2, 'purchases not recorded';
  assert (select item_count from public.shopping_trips) = 2, 'trip item_count wrong';
  assert (select times_bought from public.frequent_items where normalized_name = 'חלב') = 1,
    'frequent_items wrong';
end;
$$;

-- Expenses, validation and balances ------------------------------------------
select public.save_expense(
  :'hid', 'קניות ברמי לוי', 120.50, '00000000-0000-0000-0000-00000000000a',
  '{"00000000-0000-0000-0000-00000000000a": 60.25, "00000000-0000-0000-0000-00000000000b": 60.25}',
  'groceries', current_date, 'equal', null, 'trip', :'trip_id'
);

do $$
begin
  begin
    perform public.save_expense(
      (select id from public.households limit 1), 'שגוי', 100, '00000000-0000-0000-0000-00000000000a',
      '{"00000000-0000-0000-0000-00000000000a": 10}'
    );
    raise exception 'mismatched shares accepted';
  exception when others then
    if sqlerrm = 'mismatched shares accepted' then raise; end if;
  end;
  begin
    perform public.save_expense(
      (select id from public.households limit 1), 'שגוי', 100, '00000000-0000-0000-0000-00000000000a',
      '{"00000000-0000-0000-0000-00000000000c": 100}'
    );
    raise exception 'non-member share accepted';
  exception when others then
    if sqlerrm = 'non-member share accepted' then raise; end if;
  end;
end;
$$;

insert into public.settlements (household_id, from_user, to_user, amount)
values (:'hid', '00000000-0000-0000-0000-00000000000b', '00000000-0000-0000-0000-00000000000a', 20.25);

do $$
begin
  assert (select balance from public.member_balances where user_id = '00000000-0000-0000-0000-00000000000a') = 40,
    'payer balance wrong';
  assert (select balance from public.member_balances where user_id = '00000000-0000-0000-0000-00000000000b') = -40,
    'partner balance wrong';
end;
$$;

-- Bills ----------------------------------------------------------------------
insert into public.bills (household_id, name, category, amount_type, amount, frequency, next_due_date, paid_by_default)
values (:'hid', 'ארנונה', 'bills', 'variable', 500, 'bimonthly', '2026-01-15', '00000000-0000-0000-0000-00000000000a')
returning id as bill_id \gset

select public.pay_bill(:'bill_id', 333.33, null, '2026-01-14');

do $$
declare
  shares numeric[];
begin
  assert (select next_due_date from public.bills) = '2026-03-15', 'bimonthly due date not advanced';
  select array_agg(s.amount order by s.user_id) into shares
  from public.expense_shares s join public.expenses e on e.id = s.expense_id
  where e.source = 'bill';
  -- 333.33 split 50/50: the payer takes the extra agora.
  assert shares = array[166.67, 166.66]::numeric[], format('bill shares wrong: %s', shares);
end;
$$;

-- Chores ---------------------------------------------------------------------
insert into public.chores (household_id, title, recurrence, weekdays, assignment, assignee_id)
values (:'hid', 'להוציא זבל', 'weekly', '{0,3}', 'rotate', '00000000-0000-0000-0000-00000000000a');
insert into public.chore_completions (chore_id, household_id)
select id, household_id from public.chores;

-- auto_pay_due_bills is not callable by users ---------------------------------
do $$
begin
  begin
    perform public.auto_pay_due_bills();
    raise exception 'users can run auto_pay_due_bills';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- Prices (service role writes, users read) -----------------------------------
reset role;
insert into public.stores (chain_id, store_code, name, city) values
  ('rami_levy', '39', 'רמי לוי באר שבע', 'באר שבע'),
  ('shufersal', '413', 'שופרסל דיל באר שבע', 'באר שבע');
insert into public.products (barcode, name, manufacturer) values
  ('7290000000001', 'חלב תנובה 3% 1 ליטר', 'תנובה'),
  ('7290000000002', 'לחם אחיד פרוס', 'אנג''ל'),
  ('rami_levy:100', 'עגבניות', null),
  ('shufersal:200', 'עגבניה שרי', null);
insert into public.prices (store_id, barcode, price)
select s.id, v.barcode, v.price
from (values
  ('39', '7290000000001', 6.20),
  ('39', 'rami_levy:100', 4.90),
  ('413', '7290000000001', 6.90),
  ('413', '7290000000002', 7.40),
  ('413', 'shufersal:200', 9.90)
) v(store_code, barcode, price)
join public.stores s on s.store_code = v.store_code;

update public.prices set price = 6.50 where barcode = '7290000000001'
  and store_id = (select id from public.stores where store_code = '39');

do $$
begin
  assert (select count(*) from public.price_history) = 1, 'price change not tracked';
end;
$$;

-- Insights helper: price changes for bought products.
update public.purchases set barcode = '7290000000001' where name = 'חלב';

set role authenticated;
select public.test_login('00000000-0000-0000-0000-00000000000a');

insert into public.list_items (list_id, household_id, name, barcode) values
  (:'list_id', :'hid', 'חלב', '7290000000001');

do $$
declare
  n int;
begin
  -- 2 unchecked items (עגבניות, חלב) x 2 stores.
  select count(*) into n from public.basket_matches((select id from public.shopping_lists where is_default));
  assert n = 4, format('expected 4 basket matches, got %s', n);
  assert (
    select price from public.basket_matches((select id from public.shopping_lists where is_default)) m
    join public.list_items li on li.id = m.item_id
    join public.stores s on s.id = m.store_id
    where li.name = 'חלב' and s.store_code = '39'
  ) = 6.50, 'exact barcode match wrong';
  assert (select count(*) from public.search_products('חלב')) = 1, 'search_products failed';
  assert (select count(*) from public.recent_price_changes((select id from public.households limit 1))) = 1,
    'recent_price_changes failed';
  begin
    insert into public.products (barcode, name) values ('x', 'y');
    raise exception 'users can write products';
  exception when insufficient_privilege then null;
  end;
end;
$$;

-- The stranger cannot read household price helpers ---------------------------
select public.test_login('00000000-0000-0000-0000-00000000000c');
do $$
begin
  assert (select count(*) from public.recent_price_changes('00000000-0000-0000-0000-000000000000')) = 0,
    'stranger reads price changes';
  assert (select count(*) from public.expenses) = 0, 'stranger sees expenses';
  assert (select count(*) from public.bills) = 0, 'stranger sees bills';
  assert (select count(*) from public.chores) = 0, 'stranger sees chores';
end;
$$;

reset role;

-- Importing from Splitwise --------------------------------------------------------
set role authenticated;
select public.test_login('00000000-0000-0000-0000-00000000000a');
select balance as before_import from public.member_balances
where user_id = '00000000-0000-0000-0000-00000000000a' \gset

select public.import_expenses(
  :'hid',
  '[{"external_id": "splitwise|1", "date": "2026-08-25", "description": "שכר דירה", "amount": 1900,
     "paid_by": "00000000-0000-0000-0000-00000000000a", "split_type": "equal", "category": "rent",
     "shares": {"00000000-0000-0000-0000-00000000000a": 950, "00000000-0000-0000-0000-00000000000b": 950}}]',
  '[{"external_id": "splitwise|2", "date": "2026-09-29", "note": "החזר", "amount": 700,
     "from_user": "00000000-0000-0000-0000-00000000000b", "to_user": "00000000-0000-0000-0000-00000000000a"}]'
) as first_import \gset

select public.import_expenses(
  :'hid',
  '[{"external_id": "splitwise|1", "date": "2026-08-25", "description": "שכר דירה", "amount": 1900,
     "paid_by": "00000000-0000-0000-0000-00000000000a", "split_type": "equal", "category": "rent",
     "shares": {"00000000-0000-0000-0000-00000000000a": 950, "00000000-0000-0000-0000-00000000000b": 950}}]',
  '[{"external_id": "splitwise|2", "date": "2026-09-29", "note": "החזר", "amount": 700,
     "from_user": "00000000-0000-0000-0000-00000000000b", "to_user": "00000000-0000-0000-0000-00000000000a"}]'
) as second_import \gset

select set_config('test.first', :'first_import', false), set_config('test.second', :'second_import', false),
  set_config('test.before', :'before_import', false);
do $$
begin
  assert current_setting('test.first')::jsonb = '{"expenses": 1, "settlements": 1, "skipped": 0}',
    format('first import: %s', current_setting('test.first'));
  assert current_setting('test.second')::jsonb = '{"expenses": 0, "settlements": 0, "skipped": 2}',
    format('second import: %s', current_setting('test.second'));
  -- +950 owed by the partner for rent, -700 repaid.
  assert (select balance from public.member_balances where user_id = '00000000-0000-0000-0000-00000000000a')
    = current_setting('test.before')::numeric + 250, 'import changed the balance wrongly';
  assert (select source from public.expenses where external_id = 'splitwise|1') = 'import', 'source not import';
  begin
    -- Shares that do not add up: nothing at all is imported.
    perform public.import_expenses(
      (select id from public.households limit 1),
      '[{"external_id": "splitwise|9", "date": "2026-08-25", "description": "x", "amount": 10,
         "paid_by": "00000000-0000-0000-0000-00000000000a", "split_type": "exact",
         "shares": {"00000000-0000-0000-0000-00000000000a": 1}}]',
      '[{"external_id": "splitwise|8", "date": "2026-09-29", "amount": 5,
         "from_user": "00000000-0000-0000-0000-00000000000b", "to_user": "00000000-0000-0000-0000-00000000000a"}]'
    );
    raise exception 'bad import accepted';
  exception when others then
    if sqlerrm = 'bad import accepted' then raise; end if;
  end;
  assert not exists (select 1 from public.settlements where external_id = 'splitwise|8'), 'partial import kept';
  begin
    perform public.import_expenses(
      (select id from public.households limit 1), '[]',
      '[{"external_id": "splitwise|7", "date": "2026-09-29", "amount": 5,
         "from_user": "00000000-0000-0000-0000-00000000000c", "to_user": "00000000-0000-0000-0000-00000000000a"}]'
    );
    raise exception 'non-member transfer accepted';
  exception when others then
    if sqlerrm = 'non-member transfer accepted' then raise; end if;
  end;
end;
$$;
reset role;

-- Placeholder member, claimed on join ------------------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000d', 'early@example.com'),
  ('00000000-0000-0000-0000-00000000000e', 'later@example.com');
set role authenticated;
select public.test_login('00000000-0000-0000-0000-00000000000d');
select id as hid2, invite_code as code2 from public.create_household('בית שני', 'דנה') \gset
select user_id as ph from public.add_placeholder_member(:'hid2', 'אבי') \gset

select public.import_expenses(
  :'hid2',
  format('[{"external_id": "s|1", "date": "2026-08-25", "description": "דלק", "amount": 100,
     "paid_by": "%s", "split_type": "equal", "category": "transport",
     "shares": {"00000000-0000-0000-0000-00000000000d": 50, "%s": 50}}]', :'ph', :'ph')::jsonb,
  format('[{"external_id": "s|2", "date": "2026-09-01", "amount": 20,
     "from_user": "00000000-0000-0000-0000-00000000000d", "to_user": "%s"}]', :'ph')::jsonb
);

select set_config('test.ph', :'ph', false), set_config('test.hid2', :'hid2', false);
do $$
begin
  assert (select count(*) from public.household_members) = 2, 'placeholder not added';
  assert (select sum(default_share_pct) from public.household_members) = 100, 'shares not rebalanced';
  -- The placeholder paid 100, owes 50, received 20: +30.
  assert (select balance from public.member_balances where user_id = current_setting('test.ph')::uuid) = 30,
    'placeholder balance wrong';
  begin
    update public.household_members set is_placeholder = true
    where user_id = '00000000-0000-0000-0000-00000000000d';
    raise exception 'is_placeholder was writable';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select public.test_login('00000000-0000-0000-0000-00000000000e');
select public.join_household(:'code2', 'אבי כהן');
do $$
declare
  me uuid := '00000000-0000-0000-0000-00000000000e';
begin
  assert (select count(*) from public.household_members) = 2, 'join added a third member';
  assert exists (
    select 1 from public.household_members where user_id = me and not is_placeholder and display_name = 'אבי כהן'
  ), 'placeholder not claimed';
  assert (select balance from public.member_balances where user_id = me) = 30, 'balance did not move';
  assert (select paid_by from public.expenses where external_id = 's|1') = me, 'expense not moved';
  assert (select to_user from public.settlements where external_id = 's|2') = me, 'settlement not moved';
  assert not exists (
    select 1 from public.expense_shares where user_id = current_setting('test.ph')::uuid
  ), 'shares left on the placeholder';
end;
$$;
reset role;

\echo 'All database tests passed'
