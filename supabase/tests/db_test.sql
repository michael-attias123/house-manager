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

-- Departments learned by a household stay in that household.
select public.test_login('00000000-0000-0000-0000-00000000000a');
insert into public.item_categories (household_id, normalized_name, category) values (:'hid', 'פסטו', 'pantry');
insert into public.item_categories (household_id, normalized_name, category) values (:'hid', 'פסטו', 'other')
  on conflict (household_id, normalized_name) do update set category = excluded.category, updated_at = now();
select public.test_login('00000000-0000-0000-0000-00000000000c');
do $$
begin
  assert (select count(*) from public.item_categories) = 0, 'stranger sees learned categories';
  begin
    insert into public.item_categories (household_id, normalized_name, category)
    values (current_setting('test.hid')::uuid, 'חלב', 'dairy');
    raise exception 'stranger wrote a learned category';
  exception when insufficient_privilege then null;
  end;
end;
$$;
select public.test_login('00000000-0000-0000-0000-00000000000b');
do $$
begin
  assert (select category from public.item_categories where normalized_name = 'פסטו') = 'other',
    'partner does not see the learned category';
end;
$$;
delete from public.item_categories;
select public.test_login('00000000-0000-0000-0000-00000000000c');

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
insert into public.products (barcode, name, manufacturer, quantity, unit, is_weighted) values
  ('7290000000001', 'חלב תנובה 3% 1 ליטר', 'תנובה', 1000, '100 מיליליטר', false),
  ('7290000000002', 'לחם אחיד פרוס', 'אנג''ל', 750, '100 גרם', false),
  ('7290000000003', 'ביצים אריזון 12 גדול', null, 1, 'יחידות', false),
  ('7290000000004', 'סלט ביצים', null, 400, '100 גרם', false),
  ('7290000000005', '12ביצים XL', null, 1, 'יחידות', false),
  ('7290000000006', 'פסטה 4*125גר', null, null, null, false),
  ('rami_levy:100', 'עגבניות', null, 1, 'קילוגרם', true),
  ('shufersal:200', 'עגבניה שרי', null, 1, 'קילוגרם', true);
insert into public.prices (store_id, barcode, price)
select s.id, v.barcode, v.price
from (values
  ('39', '7290000000001', 6.20),
  ('39', 'rami_levy:100', 4.90),
  ('413', '7290000000001', 6.90),
  ('413', '7290000000002', 7.40),
  ('413', 'shufersal:200', 9.90),
  ('39', '7290000000003', 14.20),
  ('39', '7290000000004', 9.90),
  ('413', '7290000000005', 15.50),
  ('413', '7290000000006', 8.00)
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
begin
  -- Pack sizes from the name first, then the fields; weighted = per kg.
  assert (select (pack_unit, pack_qty) = ('u', 12) from public.products where barcode = '7290000000003'), 'egg carton pack';
  assert (select (pack_unit, pack_qty) = ('ml', 1000) from public.products where barcode = '7290000000001'), 'milk pack';
  assert (select (pack_unit, pack_qty) = ('g', 500) from public.products where barcode = '7290000000006'), 'multipack';
  assert (select (pack_unit, pack_qty) = ('g', 1000) from public.products where barcode = 'rami_levy:100'), 'weighted pack';
  assert (select name_head from public.products where barcode = '7290000000005') = 'ביצים xl', 'leading number kept';

  -- "ביצים" matches products named for eggs, never the salad.
  assert not exists (
    select 1 from public.match_candidates('[{"id": "e", "terms": ["ביצים"]}]')
    where product_name like 'סלט%' or tier <> 1
  ), 'eggs matched egg salad';
  assert (select count(*) from public.match_candidates('[{"id": "e", "terms": ["ביצים"]}]')) = 2, 'eggs in both stores';
  assert (select count(*) from public.match_candidates('[{"id": "e", "terms": ["ביצים"], "exclude": ["xl"]}]')) = 1,
    'exclude ignored';
  assert (select count(*) from public.match_candidates('[{"id": "e", "terms": ["ביצים"], "require": ["גדול"]}]')) = 1,
    'require ignored';
  -- An item named for the salad does get it.
  assert (select min(tier) from public.match_candidates('[{"id": "s", "terms": ["סלט"]}]')) = 1, 'salad tier';
  assert (select count(*) from public.match_candidates('[{"id": "t", "terms": ["עגבניות"], "weighted": true}]')) = 1,
    'weighted filter';
  -- A linked barcode comes back as tier 0 in every store that sells it.
  assert (
    select count(*) from public.match_candidates('[{"id": "m", "terms": ["חלב"], "barcode": "7290000000001"}]')
    where tier = 0
  ) = 2, 'linked barcode rows';
  assert (
    select price from public.match_candidates('[{"id": "m", "terms": ["חלב"], "barcode": "7290000000001"}]') m
    join public.stores s on s.id = m.store_id
    where m.tier = 0 and s.store_code = '39'
  ) = 6.50, 'exact barcode price wrong';
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

-- Sign-up allowlist (allowed_emails) --------------------------------------------
-- Supabase Auth inserts users as supabase_auth_admin, which has no access to
-- public.allowed_emails: the security definer trigger must work regardless.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    create role supabase_auth_admin nologin;
  end if;
end;
$$;
grant usage on schema auth to supabase_auth_admin;
grant insert on auth.users to supabase_auth_admin;

-- An empty list lets everyone in.
set role supabase_auth_admin;
insert into auth.users (email) values ('anyone@allowlist.example.com');
reset role;

insert into public.allowed_emails (email, note) values
  ('allowed@allowlist.example.com', 'test'),
  ('mixed@allowlist.example.com', null);

set role supabase_auth_admin;
do $$
begin
  begin
    insert into auth.users (email) values ('blocked@allowlist.example.com');
    raise exception 'unlisted email accepted';
  exception when others then
    if sqlerrm not like 'email not allowed%' then raise; end if;
  end;
  insert into auth.users (email) values ('allowed@allowlist.example.com');
  -- Google may return the address in any case.
  insert into auth.users (email) values ('Mixed@AllowList.Example.COM');
end;
$$;
reset role;

set role authenticated;
select public.test_login('00000000-0000-0000-0000-00000000000a');
do $$
begin
  begin
    perform 1 from public.allowed_emails;
    raise exception 'clients can read allowed_emails';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

do $$
begin
  assert not exists (select 1 from auth.users where email = 'blocked@allowlist.example.com'),
    'blocked user was created';
  assert (select count(*) from auth.users where email ilike '%@allowlist.example.com') = 3,
    'allowed users missing';
  begin
    insert into public.allowed_emails (email) values ('Upper@allowlist.example.com');
    raise exception 'unnormalized address accepted';
  exception when check_violation then null;
  end;
end;
$$;

delete from public.allowed_emails;
delete from auth.users where email ilike '%@allowlist.example.com';

-- Admin (app_admins, admin_* RPCs, detaching members) ---------------------------
-- The accounts come first: once the allowlist has an address, new ones are refused.
insert into auth.users (id, email, raw_user_meta_data, last_sign_in_at) values
  ('00000000-0000-0000-0000-0000000000f1', 'boss@admin.example.com', '{"full_name": "Boss"}', now()),
  ('00000000-0000-0000-0000-0000000000f2', 'deputy@admin.example.com', '{}', null),
  ('00000000-0000-0000-0000-0000000000f3', 'loner@admin.example.com', '{}', null),
  ('00000000-0000-0000-0000-0000000000f4', 'quiet@admin.example.com', '{}', null);

-- 1. Without a row in app_admins nothing is allowed.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000f1');
do $$
declare
  calls text[] := array[
    'select public.admin_list_allowed_emails()',
    'select public.admin_add_allowed_email(''x@example.com'')',
    'select public.admin_remove_allowed_email(''x@example.com'')',
    'select public.admin_list_households()',
    'select public.admin_delete_household(gen_random_uuid())',
    'select public.admin_remove_member(gen_random_uuid(), gen_random_uuid())',
    'select public.admin_list_users()',
    'select public.admin_delete_user(gen_random_uuid())'
  ];
  c text;
begin
  assert not public.is_admin(), 'is_admin() true without a row in app_admins';
  foreach c in array calls loop
    begin
      execute c;
      raise exception 'a non-admin ran: %', c;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform 1 from public.app_admins;
    raise exception 'clients can read app_admins';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.app_admins (user_id) values (auth.uid());
    raise exception 'clients can write app_admins';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.move_member_refs(gen_random_uuid(), gen_random_uuid(), gen_random_uuid());
    raise exception 'clients can run move_member_refs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.detach_member(gen_random_uuid(), gen_random_uuid());
    raise exception 'clients can run detach_member';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

set role anon;
select set_config('request.jwt.claims', '', false);
do $$
begin
  begin
    perform public.admin_list_users();
    raise exception 'anon ran admin_list_users';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.is_admin();
    raise exception 'anon ran is_admin';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

-- Bootstrap, as in docs/setup.md (two admins, to test that one cannot delete the other).
insert into public.app_admins (user_id)
select id from auth.users where email in ('boss@admin.example.com', 'deputy@admin.example.com');

-- 2. The allowlist.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000f1');
do $$
declare
  r public.allowed_emails;
begin
  assert public.is_admin(), 'admin not recognised';
  assert (select count(*) from public.admin_list_allowed_emails()) = 0, 'allowlist not empty before the admin tests';
  r := public.admin_add_allowed_email(' Friend@Example.com ');
  assert r.email = 'friend@example.com', format('address not normalised: %s', r.email);
  -- The first address would close sign-up, so the admin's own comes with it.
  assert (select array_agg(email order by email) from public.admin_list_allowed_emails())
    = array['boss@admin.example.com', 'friend@example.com'], 'own address not added with the first one';
  assert (select on_allowlist from public.admin_list_users() where email = 'boss@admin.example.com'),
    'on_allowlist wrong';
  begin
    perform public.admin_add_allowed_email('nope');
    raise exception 'invalid address accepted';
  exception when others then
    if sqlerrm <> 'invalid email' then raise; end if;
  end;
  perform public.admin_add_allowed_email('friend@example.com', 'חבר');
  r := public.admin_add_allowed_email('FRIEND@example.com');
  assert r.note = 'חבר', 'note lost when the address was added again';
  begin
    perform public.admin_remove_allowed_email(' BOSS@admin.example.com');
    raise exception 'own address removed';
  exception when others then
    if sqlerrm <> 'cannot remove your own email' then raise; end if;
  end;
  begin
    perform public.admin_remove_allowed_email('ghost@example.com');
    raise exception 'missing address removed';
  exception when others then
    if sqlerrm <> 'not found' then raise; end if;
  end;
  perform public.admin_add_allowed_email('other@example.com');
  perform public.admin_remove_allowed_email('other@example.com');
  assert (select count(*) from public.admin_list_allowed_emails()) = 2, 'removing an address failed';
end;
$$;
reset role;

-- The last address cannot go, even when it is not the admin's own.
delete from public.allowed_emails where email = 'boss@admin.example.com';
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000f1');
do $$
begin
  begin
    perform public.admin_remove_allowed_email('friend@example.com');
    raise exception 'allowlist emptied';
  exception when others then
    if sqlerrm <> 'allowlist cannot be empty' then raise; end if;
  end;
  assert (select array_agg(email) from public.admin_list_allowed_emails()) = array['friend@example.com'],
    'refused removal was not rolled back';
end;
$$;
reset role;
delete from public.allowed_emails;

-- 3. Households. The admin has one, and a member without history joins it.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000f1');
select id as admin_hid, invite_code as admin_code from public.create_household('בית המנהל', 'מנהל') \gset
select public.test_login('00000000-0000-0000-0000-0000000000f4');
select public.join_household(:'admin_code', 'שקט');
select public.test_login('00000000-0000-0000-0000-0000000000f1');
insert into public.bills (household_id, name, amount_type, amount, frequency, next_due_date, paid_by_default, auto_create)
values (:'admin_hid', 'מנוי', 'fixed', 50, 'monthly', current_date + 10, '00000000-0000-0000-0000-0000000000f4', true);
insert into public.chores (household_id, title, assignment, assignee_id)
values (:'admin_hid', 'כלים', 'fixed', '00000000-0000-0000-0000-0000000000f4');
reset role;

select format('%s/%s/%s/%s',
  (select count(*) from public.expenses where household_id = :'hid'),
  (select count(*) from public.bills where household_id = :'hid'),
  (select count(*) from public.chores where household_id = :'hid'),
  (select count(*) from public.list_items where household_id = :'hid')
) as hid_counts \gset
select set_config('test.admin_hid', :'admin_hid', false), set_config('test.admin_code', :'admin_code', false),
  set_config('test.hid_counts', :'hid_counts', false);

set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000f1');
do $$
declare
  admin_hid uuid := current_setting('test.admin_hid')::uuid;
  quiet uuid := '00000000-0000-0000-0000-0000000000f4';
  h record;
begin
  select * into h from public.admin_list_households() where id = current_setting('test.hid')::uuid;
  assert format('%s/%s/%s/%s', h.expense_count, h.bill_count, h.chore_count, h.list_item_count)
    = current_setting('test.hid_counts'), format('counts wrong: %s', to_jsonb(h));
  assert h.expense_count > 0 and h.bill_count > 0 and h.chore_count > 0 and h.list_item_count > 0, 'nothing to count';
  assert jsonb_array_length(h.members) = 2, 'members missing';
  assert h.members -> 0 ->> 'email' = 'michael@example.com', format('member email wrong: %s', h.members);
  assert not (h.members -> 0 ->> 'is_placeholder')::boolean, 'is_placeholder wrong';
  begin
    perform public.admin_delete_household(admin_hid);
    raise exception 'own household deleted';
  exception when others then
    if sqlerrm <> 'cannot delete your own household' then raise; end if;
  end;
  begin
    perform public.admin_delete_household(gen_random_uuid());
    raise exception 'missing household deleted';
  exception when others then
    if sqlerrm <> 'not found' then raise; end if;
  end;

  -- 4. Removing a member with no history deletes the row.
  begin
    perform public.admin_remove_member(admin_hid, auth.uid());
    raise exception 'admin removed themselves';
  exception when others then
    if sqlerrm <> 'cannot remove yourself' then raise; end if;
  end;
  assert (select default_share_pct from public.household_members where household_id = admin_hid and user_id = auth.uid()) = 50,
    'join did not split the shares';
  perform public.admin_remove_member(admin_hid, quiet);
  assert not exists (select 1 from public.household_members where household_id = admin_hid and user_id = quiet),
    'member row kept';
  assert (select default_share_pct from public.household_members where household_id = admin_hid and user_id = auth.uid()) = 100,
    'shares not rebalanced';
  assert (select invite_code from public.households where id = admin_hid) <> current_setting('test.admin_code'),
    'invite code not regenerated';
  assert (select paid_by_default is null and not auto_create from public.bills where household_id = admin_hid),
    'bill still names the removed member';
  assert (select assignee_id is null from public.chores where household_id = admin_hid), 'chore still assigned';
  begin
    perform public.admin_remove_member(admin_hid, quiet);
    raise exception 'member removed twice';
  exception when others then
    if sqlerrm <> 'not found' then raise; end if;
  end;
end;
$$;

select public.test_login('00000000-0000-0000-0000-0000000000f4');
do $$
begin
  assert (select count(*) from public.households) = 0, 'removed member still sees the household';
end;
$$;
reset role;

-- 5. Removing a member with history: a placeholder keeps the name and balance.
select balance as b_balance from public.member_balances where user_id = '00000000-0000-0000-0000-00000000000b' \gset
select invite_code as hid_code from public.households where id = :'hid' \gset
select set_config('test.b_balance', :'b_balance', false), set_config('test.hid_code', :'hid_code', false);

set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000f1');
do $$
declare
  hid uuid := current_setting('test.hid')::uuid;
  ph jsonb;
begin
  perform public.admin_remove_member(hid, '00000000-0000-0000-0000-00000000000b');
  select m.value into ph
  from public.admin_list_households() h, jsonb_array_elements(h.members) as m(value)
  where h.id = hid and m.value ->> 'display_name' = 'שירן';
  assert ph is not null, 'member row gone';
  assert (ph ->> 'is_placeholder')::boolean and ph ->> 'email' is null, format('not a placeholder: %s', ph);
  assert ph ->> 'user_id' <> '00000000-0000-0000-0000-00000000000b', 'placeholder kept the old id';
  perform set_config('test.b_placeholder', ph ->> 'user_id', false);
  begin
    perform public.admin_remove_member(hid, (ph ->> 'user_id')::uuid);
    raise exception 'placeholder with history removed';
  exception when others then
    if sqlerrm <> 'placeholder has history' then raise; end if;
  end;
end;
$$;
reset role;

do $$
declare
  hid uuid := current_setting('test.hid')::uuid;
begin
  assert (select balance from public.member_balances where user_id = current_setting('test.b_placeholder')::uuid)
    = current_setting('test.b_balance')::numeric, 'balance changed';
  assert not exists (select 1 from public.expense_shares where user_id = '00000000-0000-0000-0000-00000000000b'),
    'shares left on the old id';
  assert not exists (select 1 from public.settlements where '00000000-0000-0000-0000-00000000000b' in (from_user, to_user)),
    'transfers left on the old id';
  assert (select count(*) from public.household_members where household_id = hid) = 2, 'member count changed';
  assert (select invite_code from public.households where id = hid) <> current_setting('test.hid_code'),
    'invite code not regenerated';
end;
$$;

set role authenticated;
select public.test_login('00000000-0000-0000-0000-00000000000b');
do $$
begin
  assert (select count(*) from public.households) = 0, 'removed member still sees the household';
  assert (select count(*) from public.expenses) = 0, 'removed member still sees expenses';
end;
$$;

-- 6. Deleting an account.
select public.test_login('00000000-0000-0000-0000-0000000000f3');
select id as loner_hid from public.create_household('בית בודד', 'בודד') \gset
insert into public.list_items (list_id, household_id, name)
select id, household_id, 'חלב' from public.shopping_lists where household_id = :'loner_hid';
select set_config('test.loner_hid', :'loner_hid', false);

select public.test_login('00000000-0000-0000-0000-0000000000f1');
do $$
declare
  loner uuid := '00000000-0000-0000-0000-0000000000f3';
  loner_hid uuid := current_setting('test.loner_hid')::uuid;
begin
  begin
    perform public.admin_delete_user(auth.uid());
    raise exception 'own account deleted';
  exception when others then
    if sqlerrm <> 'cannot delete your own account' then raise; end if;
  end;
  begin
    perform public.admin_delete_user('00000000-0000-0000-0000-0000000000f2');
    raise exception 'admin account deleted';
  exception when others then
    if sqlerrm <> 'cannot delete an admin' then raise; end if;
  end;
  begin
    perform public.admin_delete_user(gen_random_uuid());
    raise exception 'missing account deleted';
  exception when others then
    if sqlerrm <> 'not found' then raise; end if;
  end;
  assert (
    select is_admin and full_name = 'Boss' and household_names = array['בית המנהל'] and last_sign_in_at is not null
    from public.admin_list_users() where id = auth.uid()
  ), 'admin_list_users: admin row wrong';
  assert (
    select not is_admin and not on_allowlist and household_names = array['בית בודד']
    from public.admin_list_users() where id = loner
  ), 'admin_list_users: user row wrong';

  perform public.admin_delete_user(loner);
  assert not exists (select 1 from public.admin_list_users() where id = loner), 'deleted account still listed';
  assert (select members = '[]'::jsonb and list_item_count = 1 from public.admin_list_households() where id = loner_hid),
    'household of the deleted account wrong';
end;
$$;
reset role;

do $$
begin
  assert not exists (select 1 from auth.users where id = '00000000-0000-0000-0000-0000000000f3'), 'auth.users row kept';
  assert (select added_by from public.list_items where household_id = current_setting('test.loner_hid')::uuid) is null,
    'added_by still names the deleted account';
end;
$$;

-- 7. Deleting in the Supabase dashboard (Supabase Auth's role, and the
-- superuser) goes through the same trigger: members with history become
-- placeholders.
grant select, delete on auth.users to supabase_auth_admin;
set role supabase_auth_admin;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000e';
reset role;
delete from auth.users where id = '00000000-0000-0000-0000-00000000000d';

do $$
declare
  hid2 uuid := current_setting('test.hid2')::uuid;
begin
  assert (select count(*) from public.household_members where household_id = hid2 and is_placeholder) = 2,
    'deleted accounts did not become placeholders';
  assert not exists (
    select 1 from public.household_members
    where user_id in ('00000000-0000-0000-0000-00000000000d', '00000000-0000-0000-0000-00000000000e')
  ), 'member rows kept the deleted ids';
  assert (
    select b.balance from public.member_balances b
    join public.household_members m using (household_id, user_id)
    where m.household_id = hid2 and m.display_name = 'אבי כהן'
  ) = 30, 'balance changed by the deletion';
  assert (select sum(balance) from public.member_balances where household_id = hid2) = 0, 'balances do not add up';
end;
$$;

-- 8. Deleting a household removes everything under it.
insert into public.product_links (household_id, normalized_name, barcode) values (:'hid', 'חלב', '7290000000001');
insert into public.item_categories (household_id, normalized_name, category) values (:'hid', 'פסטו', 'pantry');
-- Going out: the household's own place and deal go with it, but a deal
-- approved for everyone stays, without the household.
insert into public.venues (osm_ref, name, kind, source) values ('node/900001', 'בר המחיקה', 'bar', 'osm')
returning id as del_venue \gset
insert into public.venues (name, kind, source, status, household_id, created_by)
values ('המקום של הבית', 'cafe', 'community', 'pending', :'hid', '00000000-0000-0000-0000-00000000000a')
returning id as del_own_venue \gset
insert into public.venue_deals (venue_id, household_id, created_by, title, kind) values
  (:del_own_venue, :'hid', '00000000-0000-0000-0000-00000000000a', 'קפה ומאפה', 'happy_hour');
insert into public.venue_deals (venue_id, household_id, created_by, title, kind, status)
values (:del_venue, :'hid', '00000000-0000-0000-0000-00000000000a', 'בירה בחצי מחיר', 'happy_hour', 'approved')
returning id as del_deal \gset
insert into public.venue_favorites (household_id, venue_id) values (:'hid', :del_venue);
select set_config('test.del_deal', :'del_deal', false), set_config('test.del_own_venue', :'del_own_venue', false);

create or replace function pg_temp.household_rows(hid uuid)
returns table (table_name text, n bigint)
language plpgsql
as $$
declare
  r record;
begin
  for r in
    select c.table_name as t
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'household_id' and t.table_type = 'BASE TABLE'
    order by 1
  loop
    table_name := r.t;
    execute format('select count(*) from public.%I where household_id = $1', r.t) into n using hid;
    return next;
  end loop;
end;
$$;

do $$
begin
  assert (select count(*) from pg_temp.household_rows(current_setting('test.hid')::uuid)) >= 13, 'tables missing';
  assert not exists (select 1 from pg_temp.household_rows(current_setting('test.hid')::uuid) where n = 0), format(
    'add rows for the cascade check: %s',
    (select string_agg(table_name, ', ') from pg_temp.household_rows(current_setting('test.hid')::uuid) where n = 0)
  );
end;
$$;

set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000f1');
select public.admin_delete_household(:'hid');
reset role;

do $$
begin
  assert not exists (select 1 from public.households where id = current_setting('test.hid')::uuid), 'household kept';
  assert not exists (select 1 from pg_temp.household_rows(current_setting('test.hid')::uuid) where n > 0), format(
    'rows left after deleting the household: %s',
    (select string_agg(table_name, ', ') from pg_temp.household_rows(current_setting('test.hid')::uuid) where n > 0)
  );
  assert (select household_id is null and status = 'approved' from public.venue_deals
          where id = current_setting('test.del_deal')::uuid), 'approved deal not kept without its household';
  assert not exists (select 1 from public.venues where id = current_setting('test.del_own_venue')::bigint),
    'household''s suggested place kept';
end;
$$;

-- 9. The schema rules the admin screen relies on.
do $$
begin
  -- A column that only remembers a household (venues.suggested_household_id)
  -- may be set null instead; household_id itself always cascades.
  assert not exists (
    select 1 from pg_constraint c where contype = 'f' and confrelid = 'public.households'::regclass and confdeltype <> 'c'
      and not (confdeltype = 'n' and (select attname from pg_attribute where attrelid = c.conrelid and attnum = c.conkey[1]) <> 'household_id')
  ), format('FKs to households without on delete cascade: %s', (
    select string_agg(conrelid::regclass || '.' || conname, ', ') from pg_constraint
    where contype = 'f' and confrelid = 'public.households'::regclass and confdeltype <> 'c'
  ));
  assert not exists (
    select 1 from pg_constraint where contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype not in ('c', 'n')
  ), format('FKs to auth.users that would block deleting an account: %s', (
    select string_agg(conrelid::regclass || '.' || conname, ', ') from pg_constraint
    where contype = 'f' and confrelid = 'auth.users'::regclass and confdeltype not in ('c', 'n')
  ));
end;
$$;

-- Notifications (20261022000100_notifications.sql) --------------------------------
-- A fresh couple: נועה (admin) and עידו, plus an outsider without a device.
-- Expenses, transfers and trips notify at commit (deferred triggers), so
-- each write below is its own statement and the checks come after it.
-- Assertions never depend on the time of day: quiet hours are checked with
-- explicit times, and the pg_net checks use the 'test' kind.
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'noa@notify.example.com'),
  ('00000000-0000-0000-0000-0000000000a2', 'ido@notify.example.com'),
  ('00000000-0000-0000-0000-0000000000a3', 'outsider@notify.example.com');
insert into public.app_admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000a1');
select id as nhid, invite_code as ncode from public.create_household('בית ההתראות', 'נועה') \gset
select public.test_login('00000000-0000-0000-0000-0000000000a2');
select public.join_household(:'ncode', 'עידו');
select set_config('test.nhid', :'nhid', false);

-- 1. Devices and preferences: own rows only, everything off by default.
select public.save_push_subscription('https://push.example.com/ido', 'key-ido', 'auth-ido', 'test phone');
select public.test_login('00000000-0000-0000-0000-0000000000a1');
select public.save_push_subscription('https://push.example.com/shared', 'key-1', 'auth-1', 'shared tablet');
select public.save_push_subscription('https://push.example.com/noa', 'key-noa', 'auth-noa', 'test phone');
-- The shared tablet signs in as עידו: the endpoint moves to him.
select public.test_login('00000000-0000-0000-0000-0000000000a2');
select public.save_push_subscription('https://push.example.com/shared', 'key-2', 'auth-2', 'shared tablet');
insert into public.notification_prefs default values;

do $$
declare
  noa uuid := '00000000-0000-0000-0000-0000000000a1';
  p public.notification_prefs;
begin
  select * into p from public.notification_prefs;
  assert p.user_id = auth.uid() and not (p.bills or p.chores or p.partner or p.weekly or p.admin),
    format('prefs do not default to off: %s', to_jsonb(p));
  assert (select array_agg(endpoint order by endpoint) from public.push_subscriptions)
    = array['https://push.example.com/ido', 'https://push.example.com/shared'], 'endpoint not moved to the caller';
  assert (select p256dh from public.push_subscriptions where endpoint like '%shared') = 'key-2', 'keys not updated';
  begin
    insert into public.notification_prefs (user_id, partner) values (noa, true);
    raise exception 'prefs written for someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
    values (noa, 'https://push.example.com/fake', 'k', 'a');
    raise exception 'device added for someone else';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.save_push_subscription('http://insecure.example.com', 'k', 'a');
    raise exception 'non-https endpoint accepted';
  exception when others then
    if sqlerrm <> 'invalid subscription' then raise; end if;
  end;
end;
$$;

select public.test_login('00000000-0000-0000-0000-0000000000a3');
do $$
declare
  c text;
begin
  assert (select count(*) from public.push_subscriptions) = 0, 'outsider sees devices';
  assert (select count(*) from public.notification_prefs) = 0, 'outsider sees prefs';
  delete from public.push_subscriptions;
  update public.notification_prefs set partner = true;
  begin
    perform 1 from public.notification_outbox;
    raise exception 'clients can read the outbox';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notification_outbox (user_id, kind, title, dedup_key) values (auth.uid(), 'test', 'x', 'x');
    raise exception 'clients can write the outbox';
  exception when insufficient_privilege then null;
  end;
  foreach c in array array[
    'select public.enqueue_notification(auth.uid(), ''test'', ''x'', ''x'', ''/'', ''x'')',
    'select public.notify_members(gen_random_uuid(), null, ''test'', ''x'', ''x'', ''/'', ''x'')',
    'select public.request_push_send()',
    'select public.queue_scheduled_notifications()',
    'select public.claim_push_batch(1)',
    'select public.finish_push_batch(''[]'')',
    'select public.notify_admins(''x'', ''x'', ''/'', ''x'')'
  ] loop
    begin
      execute c;
      raise exception 'a client ran: %', c;
    exception when insufficient_privilege then null;
    end;
  end loop;
  begin
    perform public.send_test_notification();
    raise exception 'test notification without a device';
  exception when others then
    if sqlerrm <> 'no push subscription' then raise; end if;
  end;
end;
$$;
reset role;

do $$
begin
  assert (select count(*) from public.push_subscriptions) = 3, 'the outsider deleted devices';
  assert not exists (select 1 from public.notification_prefs where partner), 'the outsider changed prefs';
end;
$$;

-- 2. With the pref off, nothing is queued.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000a1');
select public.save_expense(
  :'nhid', 'פיצה', 120, '00000000-0000-0000-0000-0000000000a1',
  '{"00000000-0000-0000-0000-0000000000a1": 60, "00000000-0000-0000-0000-0000000000a2": 60}'
);
reset role;
do $$
begin
  assert (select count(*) from public.notification_outbox) = 0, 'queued with every pref off';
end;
$$;

-- 3. Partner actions, with "partner" on for both.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000a2');
update public.notification_prefs set partner = true;
select public.test_login('00000000-0000-0000-0000-0000000000a1');
-- Upsert as the client does it (only the changed column).
insert into public.notification_prefs (user_id, partner) values (auth.uid(), true)
on conflict (user_id) do update set partner = excluded.partner;
do $$
begin
  assert (select array_agg(user_id) from public.notification_prefs) = array[auth.uid()], 'sees the partner''s prefs';
  assert (select partner and not bills from public.notification_prefs), 'upsert changed other columns';
end;
$$;

select public.save_expense(
  :'nhid', 'סושי', 90.50, '00000000-0000-0000-0000-0000000000a1',
  '{"00000000-0000-0000-0000-0000000000a1": 45.25, "00000000-0000-0000-0000-0000000000a2": 45.25}'
) as sushi_id \gset
-- Only נועה has a share: עידו is not told.
select public.save_expense(
  :'nhid', 'בגדים', 300, '00000000-0000-0000-0000-0000000000a1',
  '{"00000000-0000-0000-0000-0000000000a1": 300}', 'other', current_date, 'full'
);
select public.import_expenses(
  :'nhid',
  '[{"external_id": "notify|1", "date": "2026-09-01", "description": "חשמל ישן", "amount": 200,
     "paid_by": "00000000-0000-0000-0000-0000000000a1", "split_type": "equal", "category": "bills",
     "shares": {"00000000-0000-0000-0000-0000000000a1": 100, "00000000-0000-0000-0000-0000000000a2": 100}}]',
  '[{"external_id": "notify|2", "date": "2026-09-02", "amount": 50,
     "from_user": "00000000-0000-0000-0000-0000000000a1", "to_user": "00000000-0000-0000-0000-0000000000a2"}]'
);
-- A transfer to עידו notifies him; one to נועה, recorded by her, does not.
insert into public.settlements (household_id, from_user, to_user, amount, note)
values (:'nhid', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2', 200, 'החזר');
insert into public.settlements (household_id, from_user, to_user, amount)
values (:'nhid', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a1', 10);

-- A shopping trip, then its expense: one notification for the trip.
select id as nlist from public.shopping_lists where household_id = :'nhid' \gset
insert into public.list_items (list_id, household_id, name, checked, checked_at) values
  (:'nlist', :'nhid', 'חלב', true, now()),
  (:'nlist', :'nhid', 'לחם', true, now());
select public.complete_trip(:'nlist', null, 'רמי לוי', 120.50) as ntrip \gset
select public.save_expense(
  :'nhid', 'קניות ברמי לוי', 120.50, '00000000-0000-0000-0000-0000000000a1',
  '{"00000000-0000-0000-0000-0000000000a1": 60.25, "00000000-0000-0000-0000-0000000000a2": 60.25}',
  'groceries', current_date, 'default', null, 'trip', :'ntrip'
);
reset role;

select set_config('test.sushi', :'sushi_id', false), set_config('test.ntrip', :'ntrip', false);
do $$
declare
  ido uuid := '00000000-0000-0000-0000-0000000000a2';
  o public.notification_outbox;
begin
  assert not exists (select 1 from public.notification_outbox where user_id <> ido),
    'the person who acted was notified';
  assert (select count(*) from public.notification_outbox) = 3,
    format('expected sushi, transfer and trip: %s', (select jsonb_agg(dedup_key) from public.notification_outbox));

  select * into o from public.notification_outbox where dedup_key = 'expense:' || current_setting('test.sushi');
  assert o.kind = 'partner' and o.title = 'הוצאה חדשה · נועה' and o.body = 'סושי ₪90.50 · החלק שלך ₪45.25'
    and o.url = '/expenses', format('expense notification wrong: %s', to_jsonb(o));

  select * into o from public.notification_outbox where dedup_key like 'settlement:%';
  assert o.title = 'העברה חדשה · נועה' and o.body = '₪200 הועברו אליך · החזר',
    format('transfer notification wrong: %s', to_jsonb(o));

  select * into o from public.notification_outbox where dedup_key = 'trip:' || current_setting('test.ntrip');
  assert o.title = 'קנייה הסתיימה · נועה' and o.body = '₪120.50 ברמי לוי · 2 פריטים' and o.url = '/shopping',
    format('trip notification wrong: %s', to_jsonb(o));
end;
$$;

-- 4. Scheduled: bills, chores and the weekly summary, driven by p_now.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000a1');
update public.notification_prefs set bills = true, chores = true, weekly = true, admin = true;
select public.test_login('00000000-0000-0000-0000-0000000000a2');
-- Not an admin: the admin pref alone does nothing.
update public.notification_prefs set bills = true, chores = true, weekly = true, admin = true;

insert into public.bills (household_id, name, amount_type, amount, frequency, next_due_date, paid_by_default, auto_create) values
  (:'nhid', 'ארנונה', 'fixed', 612, 'bimonthly', '2026-11-05', '00000000-0000-0000-0000-0000000000a1', false),
  (:'nhid', 'חשמל', 'variable', null, 'bimonthly', '2026-11-02', null, false),
  (:'nhid', 'מים', 'variable', 150, 'bimonthly', '2026-11-04', null, false),
  (:'nhid', 'ספוטיפיי', 'fixed', 30, 'monthly', '2026-11-05', '00000000-0000-0000-0000-0000000000a1', true),
  (:'nhid', 'נטפליקס', 'fixed', 55, 'monthly', current_date, '00000000-0000-0000-0000-0000000000a1', true);

insert into public.chores (household_id, title, assignment, assignee_id, next_due) values
  (:'nhid', 'הוצאת זבל', 'fixed', '00000000-0000-0000-0000-0000000000a1', '2026-11-02'),
  (:'nhid', 'שטיפת רצפה', 'anyone', null, '2026-11-01'),
  (:'nhid', 'כלים', 'rotate', '00000000-0000-0000-0000-0000000000a2', '2026-11-02'),
  (:'nhid', 'כביסה', 'fixed', '00000000-0000-0000-0000-0000000000a2', '2026-11-03');

-- In the week before Friday 2026-11-06, for the weekly summary.
select public.save_expense(
  :'nhid', 'ירקות', 100, '00000000-0000-0000-0000-0000000000a2',
  '{"00000000-0000-0000-0000-0000000000a1": 50, "00000000-0000-0000-0000-0000000000a2": 50}',
  'groceries', '2026-11-04'
);
reset role;

-- The standing order: recorded by the cron job, everyone hears about it,
-- and its expense (source 'bill') adds nothing.
select public.auto_pay_due_bills() as autopaid \gset
select set_config('test.autopaid', :'autopaid', false);
do $$
begin
  assert current_setting('test.autopaid')::int >= 1, 'standing order not paid';
  assert (select count(*) from public.notification_outbox where kind = 'bills' and dedup_key like 'autopay:%'
          and title = 'הוראת קבע נרשמה' and body = 'נטפליקס ₪55') = 2, 'standing order notification wrong';
  assert not exists (
    select 1 from public.notification_outbox where kind = 'partner' and body like 'נטפליקס%'
  ), 'bill expense notified as a partner action';
end;
$$;

-- One statement per run, so they happen in this order.
create temporary table sched_runs (label text primary key, n int);
insert into sched_runs select 'mon 07:59', public.queue_scheduled_notifications('2026-11-02 07:59'::timestamp at time zone 'Asia/Jerusalem');
insert into sched_runs select 'mon 08:01', public.queue_scheduled_notifications('2026-11-02 08:01'::timestamp at time zone 'Asia/Jerusalem');
insert into sched_runs select 'mon 08:40', public.queue_scheduled_notifications('2026-11-02 08:40'::timestamp at time zone 'Asia/Jerusalem');
insert into sched_runs select 'thu 09:05', public.queue_scheduled_notifications('2026-11-05 09:05'::timestamp at time zone 'Asia/Jerusalem');
insert into sched_runs select 'fri 08:01', public.queue_scheduled_notifications('2026-11-06 08:01'::timestamp at time zone 'Asia/Jerusalem');
insert into sched_runs select 'fri 09:05', public.queue_scheduled_notifications('2026-11-06 09:05'::timestamp at time zone 'Asia/Jerusalem');
insert into sched_runs select 'fri 09:30', public.queue_scheduled_notifications('2026-11-06 09:30'::timestamp at time zone 'Asia/Jerusalem');

do $$
declare
  noa uuid := '00000000-0000-0000-0000-0000000000a1';
  ido uuid := '00000000-0000-0000-0000-0000000000a2';
  hid uuid := current_setting('test.nhid')::uuid;
  runs jsonb := (select jsonb_object_agg(label, n) from sched_runs);
  spent numeric;
  creditor text;
  credit numeric;
begin
  -- Monday 08:01: two bills and one chores line each. Friday 08:01: chores
  -- only (no bill is due on the 6th or the 9th). Friday 09:05: the summary.
  assert runs = '{"mon 07:59": 0, "mon 08:01": 6, "mon 08:40": 0, "thu 09:05": 0,
                  "fri 08:01": 2, "fri 09:05": 2, "fri 09:30": 0}'::jsonb, format('scheduled runs: %s', runs);

  assert (
    select array_agg(body order by body) from public.notification_outbox
    where user_id = noa and dedup_key like 'bill:%'
  ) = array['ארנונה ₪612 בעוד 3 ימים', 'חשמל לתשלום היום'], 'bill reminders wrong';
  assert (
    select array_agg(dedup_key like '%:2026-11-05:3d' or dedup_key like '%:2026-11-02:0d') = array[true, true]
      and bool_and(title = 'תזכורת תשלום' and url = '/bills'
                   and send_after = '2026-11-02 08:01'::timestamp at time zone 'Asia/Jerusalem')
    from public.notification_outbox where user_id = ido and dedup_key like 'bill:%'
  ), 'bill reminder keys or times wrong';
  assert not exists (select 1 from public.notification_outbox where body like '%ספוטיפיי%'),
    'a standing order got a due reminder';

  assert (select body from public.notification_outbox where user_id = noa and dedup_key = 'chores:2026-11-02')
    = 'היום: שטיפת רצפה, הוצאת זבל', 'Monday chores for נועה wrong';
  assert (select body from public.notification_outbox where user_id = ido and dedup_key = 'chores:2026-11-02')
    = 'היום: שטיפת רצפה, כלים', 'Monday chores for עידו wrong';
  assert (select body from public.notification_outbox where user_id = ido and dedup_key = 'chores:2026-11-06')
    = 'היום: שטיפת רצפה, כלים, כביסה', 'Friday chores (overdue included) wrong';

  select coalesce(sum(amount), 0) into spent from public.expenses
  where household_id = hid and expense_date between '2026-10-31' and '2026-11-06';
  select m.display_name, b.balance into creditor, credit
  from public.member_balances b join public.household_members m using (household_id, user_id)
  where b.household_id = hid order by b.balance desc limit 1;
  assert spent > 0 and credit > 0, 'weekly fixture missing';
  assert (
    select array_agg(body) = array_fill(
      format('השבוע הוצאתם %s · יתרה לטובת %s %s', public.format_ils(spent), creditor, public.format_ils(credit)), array[2])
    from public.notification_outbox where dedup_key = 'weekly:2026-11-06'
  ), format('weekly summary wrong: %s', (select jsonb_agg(body) from public.notification_outbox where dedup_key like 'weekly:%'));
end;
$$;

-- 5. Quiet hours: 22:00-07:00 Israel time waits for 07:30 (summer and winter).
do $$
declare
  noa uuid := '00000000-0000-0000-0000-0000000000a1';
  il text := 'Asia/Jerusalem';
begin
  assert public.after_quiet_hours('2026-11-02 23:00'::timestamp at time zone il)
    = '2026-11-03 07:30'::timestamp at time zone il, '23:00 not held';
  assert public.after_quiet_hours('2026-07-02 03:10'::timestamp at time zone il)
    = '2026-07-02 07:30'::timestamp at time zone il, '03:10 (summer time) not held';
  assert public.after_quiet_hours('2026-11-02 07:00'::timestamp at time zone il)
    = '2026-11-02 07:00'::timestamp at time zone il, '07:00 held';
  assert public.after_quiet_hours('2026-11-02 21:59'::timestamp at time zone il)
    = '2026-11-02 21:59'::timestamp at time zone il, '21:59 held';

  perform public.enqueue_notification(noa, 'partner', 'לילה', 'x', '/', 'quiet:1', '2026-11-02 23:00'::timestamp at time zone il);
  assert (select send_after from public.notification_outbox where dedup_key = 'quiet:1')
    = '2026-11-03 07:30'::timestamp at time zone il, 'a notification at 23:00 is not held for 07:30';
  -- A test notification is what the person just asked for: never held.
  perform public.enqueue_notification(noa, 'test', 'לילה', 'x', '/', 'quiet:2', '2026-11-02 23:00'::timestamp at time zone il);
  assert (select send_after from public.notification_outbox where dedup_key = 'quiet:2')
    = '2026-11-02 23:00'::timestamp at time zone il, 'a test notification was held';
  -- Same key again: nothing new.
  assert public.enqueue_notification(noa, 'partner', 'שוב', 'x', '/', 'quiet:1') is null, 'duplicate queued';
  begin
    perform public.enqueue_notification(noa, 'spam', 'x', 'x', '/', 'quiet:3');
    raise exception 'unknown kind accepted';
  exception when others then
    if sqlerrm not like 'unknown notification kind%' then raise; end if;
  end;
end;
$$;

-- 6. Price updates, for admins only (עידו has the pref but is not an admin).
insert into public.ingest_runs default values returning id as run_ok \gset
insert into public.ingest_runs default values returning id as run_partial \gset
update public.ingest_runs set status = 'ok', finished_at = now() where id = :run_ok;
update public.ingest_runs set status = 'partial', finished_at = now(),
  stats = '{"rami_levy": {"stores": {"39": {"name": "באר שבע", "error": "no PriceFull file"}}},
            "shufersal": {"stores": {"413": {"name": "דיל", "items": 10}}}}'
where id = :run_partial;
update public.ingest_runs set status = 'failed' where id = :run_partial;
select set_config('test.run_partial', :'run_partial', false);
do $$
declare
  o public.notification_outbox;
begin
  assert (select count(*) from public.notification_outbox where kind = 'admin') = 1,
    format('admin notifications: %s', (select jsonb_agg(to_jsonb(x)) from public.notification_outbox x where kind = 'admin'));
  assert public.enqueue_notification('00000000-0000-0000-0000-0000000000a2', 'admin', 'x', 'x', '/', 'admin:x') is null,
    'admin notification queued for a non-admin';
  select * into o from public.notification_outbox where kind = 'admin';
  assert o.user_id = '00000000-0000-0000-0000-0000000000a1' and o.dedup_key = 'ingest:' || current_setting('test.run_partial')
    and o.title = 'טעינת המחירים הסתיימה חלקית' and o.body = 'רשתות עם תקלה: רמי לוי' and o.url = '/admin',
    format('admin notification wrong: %s', to_jsonb(o));
end;
$$;

-- 6b. notify_admins (20261027000100_notify_admins.sql): CI only, as the owner.
-- Not even an admin can run it from the app, nor the service role.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000a1');
do $$
begin
  perform public.notify_admins('x', 'x', '/admin', 'drift:test');
  raise exception 'an admin ran notify_admins from the app';
exception when insufficient_privilege then null;
end;
$$;
reset role;
set role anon;
do $$
begin
  perform public.notify_admins('x', 'x', '/admin', 'drift:test');
  raise exception 'anon ran notify_admins';
exception when insufficient_privilege then null;
end;
$$;
reset role;
set role service_role;
do $$
begin
  perform public.notify_admins('x', 'x', '/admin', 'drift:test');
  raise exception 'service_role ran notify_admins';
exception when insufficient_privilege then null;
end;
$$;
reset role;

-- As the owner: נועה (admin, pref on) gets it once; עידו (pref on, not an
-- admin) never does; the same dedup key again queues nothing.
select public.notify_admins('התשתית השתנתה מחוץ לקוד', 'יש הבדל בין הקוד לבין מה שמוגדר בפועל. הפרטים ב-GitHub',
  '/admin', 'drift:2026-W44') as drift_first \gset
select public.notify_admins('התשתית השתנתה מחוץ לקוד', 'שוב', '/admin', 'drift:2026-W44') as drift_again \gset
select set_config('test.drift', format('[%s, %s]', :'drift_first', :'drift_again'), false);
do $$
declare
  o public.notification_outbox;
begin
  assert current_setting('test.drift')::jsonb = '[1, 0]'::jsonb, format('notify_admins counts: %s', current_setting('test.drift'));
  assert (select count(*) from public.notification_outbox where dedup_key = 'drift:2026-W44') = 1, 'drift notification not deduplicated';
  select * into o from public.notification_outbox where dedup_key = 'drift:2026-W44';
  assert o.user_id = '00000000-0000-0000-0000-0000000000a1' and o.kind = 'admin' and o.url = '/admin'
    and o.title = 'התשתית השתנתה מחוץ לקוד' and o.body = 'יש הבדל בין הקוד לבין מה שמוגדר בפועל. הפרטים ב-GitHub',
    format('drift notification wrong: %s', to_jsonb(o));
  begin
    perform public.notify_admins('x', 'x', '/admin', '');
    raise exception 'notify_admins without a dedup key';
  exception when others then
    if sqlerrm <> 'title and dedup key are required' then raise; end if;
  end;
end;
$$;

-- 7. A test notification, for the caller only. Both taps in one transaction
-- (one now()), so they always fall in the same 10 seconds.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000a2');
do $$
declare
  first_id bigint := public.send_test_notification();
  second_id bigint := public.send_test_notification();
begin
  assert first_id is not null and second_id is null, format('test notifications: %s, %s', first_id, second_id);
  perform set_config('test.test_id', first_id::text, false);
end;
$$;
reset role;
do $$
begin
  assert (select user_id = '00000000-0000-0000-0000-0000000000a2' and kind = 'test' and title = 'התראת בדיקה'
          from public.notification_outbox where id = current_setting('test.test_id')::bigint), 'test notification wrong';
end;
$$;

-- 8. Sending. Without pg_net and Vault (plain Postgres): a no-op, no error.
do $$
begin
  assert to_regnamespace('net') is null and to_regnamespace('vault') is null, 'pg_net/vault exist: adjust this test';
  assert public.request_push_send() is null, 'request_push_send did something without pg_net';
end;
$$;

-- Then with stand-ins for both, created here and dropped below (not in
-- local_stub.sql, so the no-op above stays tested): net.http_post records
-- the request, vault.decrypted_secrets holds the two secrets.
create schema net;
create table net.test_requests (id bigint generated always as identity, url text, headers jsonb, body jsonb);
create function net.http_post(
  url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}',
  timeout_milliseconds int default 5000
) returns bigint language sql as $$
  insert into net.test_requests (url, headers, body) values (url, headers, body) returning id;
$$;
create schema vault;
create view vault.decrypted_secrets as
  select * from (values
    ('push_function_url', 'https://example.supabase.co/functions/v1/send-push'),
    ('push_secret', 'test-secret')
  ) s (name, decrypted_secret);

-- Everything queued so far counts as sent, so the checks below see only their own rows.
update public.notification_outbox set sent_at = now() where sent_at is null;
select public.request_push_send() is null as nothing_due \gset
-- Two inserts in one transaction make one request; a later one makes another.
do $$
begin
  perform public.enqueue_notification('00000000-0000-0000-0000-0000000000a1', 'test', 'א', 'x', '/', 'send:1');
  perform public.enqueue_notification('00000000-0000-0000-0000-0000000000a2', 'test', 'ב', 'x', '/', 'send:2');
end;
$$;
select public.enqueue_notification('00000000-0000-0000-0000-0000000000a2', 'test', 'ג', 'x', '/', 'send:3');
select set_config('test.nothing_due', :'nothing_due', false);
do $$
begin
  assert current_setting('test.nothing_due')::boolean, 'requested a send with nothing due';
  assert (select count(*) from net.test_requests) = 2,
    format('expected one request per transaction: %s', (select count(*) from net.test_requests));
  assert (
    select bool_and(url = 'https://example.supabase.co/functions/v1/send-push' and headers ->> 'x-push-secret' = 'test-secret')
    from net.test_requests
  ), 'request URL or secret wrong';
end;
$$;

-- The Edge Function's side: claim, then report. Service role only.
insert into public.notification_outbox (user_id, kind, title, dedup_key, send_after)
values ('00000000-0000-0000-0000-0000000000a1', 'test', 'ישן', 'send:old', now() - interval '2 days');
set role service_role;
do $$
begin
  perform set_config('test.batch', public.claim_push_batch(10)::text, false);
  perform set_config('test.batch_again', public.claim_push_batch(10)::text, false);
end;
$$;
reset role;
do $$
declare
  batch jsonb := current_setting('test.batch')::jsonb;
  ido_batch jsonb;
begin
  assert jsonb_array_length(batch) = 3, format('claimed: %s', batch);
  assert (select array_agg(x ->> 'tag' order by x ->> 'tag') from jsonb_array_elements(batch) x)
    = array['send:1', 'send:2', 'send:3'], 'claimed the wrong rows';
  select x into ido_batch from jsonb_array_elements(batch) x where x ->> 'tag' = 'send:2';
  assert (select array_agg(s ->> 'endpoint' order by s ->> 'endpoint') from jsonb_array_elements(ido_batch -> 'subscriptions') s)
    = array['https://push.example.com/ido', 'https://push.example.com/shared'], 'subscriptions missing from the batch';
  assert ido_batch ? 'title' and ido_batch ? 'body' and ido_batch ? 'url', 'payload fields missing';
  assert current_setting('test.batch_again')::jsonb = '[]'::jsonb, 'claimed rows claimed again';
  assert (select last_error = 'expired' and sent_at is null and attempts >= 5
          from public.notification_outbox where dedup_key = 'send:old'), 'old row not expired';
  assert (select bool_and(attempts = 1 and claimed_at is not null)
          from public.notification_outbox where dedup_key like 'send:_'), 'claim did not count an attempt';
end;
$$;

select format('[{"id": %s, "ok": true}, {"id": %s, "ok": true, "error": "1 of 2 devices failed"}, {"id": %s, "ok": false, "error": "503"}]',
  (select id from public.notification_outbox where dedup_key = 'send:1'),
  (select id from public.notification_outbox where dedup_key = 'send:2'),
  (select id from public.notification_outbox where dedup_key = 'send:3')) as results \gset
set role service_role;
select public.finish_push_batch(:'results', array['https://push.example.com/noa'], array['https://push.example.com/shared']);
reset role;
do $$
begin
  assert (select sent_at is not null and last_error is null and claimed_at is null
          from public.notification_outbox where dedup_key = 'send:1'), 'sent row not marked';
  assert (select sent_at is not null and last_error = '1 of 2 devices failed'
          from public.notification_outbox where dedup_key = 'send:2'), 'partly sent row wrong';
  assert (select sent_at is null and last_error = '503' and claimed_at is null and attempts = 1
          from public.notification_outbox where dedup_key = 'send:3'), 'failed row not released for a retry';
  assert not exists (select 1 from public.push_subscriptions where endpoint = 'https://push.example.com/shared'),
    'gone subscription kept';
  assert (select last_success_at is not null from public.push_subscriptions where endpoint = 'https://push.example.com/noa'),
    'last_success_at not set';
end;
$$;

-- The failed row is due again, so the fallback cron job asks once more.
select public.request_push_send() is not null as retry_requested \gset
select set_config('test.retry', :'retry_requested', false);
do $$
begin
  assert current_setting('test.retry')::boolean, 'no request for a row waiting to be retried';
end;
$$;

drop schema net cascade;
drop schema vault cascade;

-- ---------------------------------------------------------------------------
-- Going out (20261101000100_going_out.sql): places, deals and their review.
-- עדי and רון share a household, טל has another, and מאיה is an admin in
-- neither. OSM places are written as the ingest writes them (the owner).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000c1', 'adi@going-out.example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'ron@going-out.example.com'),
  ('00000000-0000-0000-0000-0000000000c3', 'tal@going-out.example.com'),
  ('00000000-0000-0000-0000-0000000000c4', 'maya@going-out.example.com');
insert into public.app_admins (user_id) values ('00000000-0000-0000-0000-0000000000c4');
insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values
  ('00000000-0000-0000-0000-0000000000c1', 'https://push.example.com/adi', 'k', 'a'),
  ('00000000-0000-0000-0000-0000000000c2', 'https://push.example.com/ron', 'k', 'a'),
  ('00000000-0000-0000-0000-0000000000c3', 'https://push.example.com/tal', 'k', 'a'),
  ('00000000-0000-0000-0000-0000000000c4', 'https://push.example.com/maya', 'k', 'a');
-- עדי keeps the defaults; רון and טל turn going_out on, מאיה the admin pref.
insert into public.notification_prefs (user_id) values ('00000000-0000-0000-0000-0000000000c1');
insert into public.notification_prefs (user_id, going_out) values
  ('00000000-0000-0000-0000-0000000000c2', true), ('00000000-0000-0000-0000-0000000000c3', true);
insert into public.notification_prefs (user_id, admin) values ('00000000-0000-0000-0000-0000000000c4', true);

insert into public.venues (osm_ref, name, kind, lat, lng, opening_hours, source, hidden) values
  ('node/1001', 'בר הבדיקה', 'bar', 31.2430, 34.7930, 'Su-Th 17:00-01:00', 'osm', false),
  ('way/1002', 'קפה לדוגמה', 'cafe', 31.2620, 34.8010, null, 'osm', false),
  ('node/1003', 'פאב שנסגר', 'pub', 31.2500, 34.7900, null, 'osm', true);
select id as gv_bar from public.venues where osm_ref = 'node/1001' \gset

set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c1');
select id as ghid, invite_code as gcode from public.create_household('הכהנים', 'עדי') \gset
select public.test_login('00000000-0000-0000-0000-0000000000c2');
select public.join_household(:'gcode', 'רון');
select public.test_login('00000000-0000-0000-0000-0000000000c3');
select id as ghid2 from public.create_household('בית טל', 'טל') \gset
insert into public.venues (name, kind, source, status, household_id)
values ('הפינה של טל', 'other', 'community', 'pending', :'ghid2') returning id as gv_tal \gset

-- 1. עדי suggests two places (one is בר הבדיקה again) and three deals.
-- Each insert is its own transaction, so they are listed in this order.
select public.test_login('00000000-0000-0000-0000-0000000000c1');
insert into public.venues (name, kind, lat, lng, source, status, household_id)
values ('בר הבדיקה!', 'bar', 31.2431, 34.7931, 'community', 'pending', :'ghid') returning id as gv_dup \gset
insert into public.venues (name, kind, lat, lng, address, opening_hours, website, phone, instagram, source, status, household_id)
values ('גינת הבירה', 'pub', 31.2700, 34.7800, 'רחוב הדוגמה 5', 'Th-Sa 20:00-02:00', 'https://example.com/ginat',
  '08-0000005', 'ginat.example', 'community', 'pending', :'ghid')
returning id as gv_new \gset
insert into public.venue_deals (venue_id, household_id, title, kind, weekdays, starts_at, ends_at)
values (:gv_bar, :'ghid', 'בירה בחצי מחיר', 'happy_hour', '{0,1,2,3,4}', '18:00', '20:00') returning id as gd_bar \gset
insert into public.venue_deals (venue_id, household_id, title, kind, valid_from, valid_until, starts_at, ends_at)
values (:gv_new, :'ghid', 'ערב ג׳אז', 'event', '2026-11-12', '2026-11-12', '21:00', '01:00') returning id as gd_new \gset
insert into public.venue_deals (venue_id, household_id, title, kind, weekdays, note)
values (:gv_dup, :'ghid', 'שלישי: יין ללא תחתית', 'special_day', '{2}', 'בקנייה של מנה עיקרית')
returning id as gd_dup \gset
select set_config('test.ghid', :'ghid', false), set_config('test.ghid2', :'ghid2', false),
  set_config('test.gv_bar', :'gv_bar', false), set_config('test.gv_tal', :'gv_tal', false),
  set_config('test.gv_dup', :'gv_dup', false), set_config('test.gv_new', :'gv_new', false),
  set_config('test.gd_bar', :'gd_bar', false), set_config('test.gd_new', :'gd_new', false),
  set_config('test.gd_dup', :'gd_dup', false);

do $$
declare
  ghid uuid := current_setting('test.ghid')::uuid;
  gv_bar bigint := current_setting('test.gv_bar')::bigint;
  gv_dup bigint := current_setting('test.gv_dup')::bigint;
  gd_bar uuid := current_setting('test.gd_bar')::uuid;
  n int;
begin
  assert (select bool_and(created_by = auth.uid()) and count(*) = 3 from public.venue_deals where household_id = ghid),
    'created_by does not default to the caller';
  assert not exists (select 1 from public.venues where name = 'פאב שנסגר'), 'a hidden place is listed';
  assert not exists (select 1 from public.venues where id = current_setting('test.gv_tal')::bigint),
    'sees another household''s suggested place';

  -- Inserts that would skip the review, or write for someone else.
  begin
    insert into public.venue_deals (venue_id, household_id, title, kind, status)
    values (gv_bar, ghid, 'מאושר מראש', 'happy_hour', 'approved');
    raise exception 'deal inserted as approved';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.venues (name, kind, source) values ('מקום גלובלי', 'bar', 'community');
    raise exception 'global place inserted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.venues (osm_ref, name, kind, source, status, household_id)
    values ('node/1', 'כאילו מ-OSM', 'bar', 'osm', 'pending', ghid);
    raise exception 'OSM place inserted by a member';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.venues (name, kind, source, status, household_id, created_by)
    values ('בשם אחר', 'bar', 'community', 'pending', ghid, '00000000-0000-0000-0000-0000000000c2');
    raise exception 'place inserted for another member';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.venue_deals (venue_id, household_id, title, kind)
    values (current_setting('test.gv_tal')::bigint, ghid, 'על מקום של אחרים', 'happy_hour');
    raise exception 'deal on a place the member cannot see';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.venue_deals (venue_id, household_id, title, kind)
    values (gv_bar, current_setting('test.ghid2')::uuid, 'בבית אחר', 'happy_hour');
    raise exception 'deal inserted for another household';
  exception when insufficient_privilege then null;
  end;

  -- Status and review columns change only through the admin RPCs.
  begin
    update public.venue_deals set status = 'rejected' where id = gd_bar;
    raise exception 'deal status changed directly';
  exception when insufficient_privilege then
    if sqlerrm not like 'only an admin review%' then raise; end if;
  end;
  begin
    update public.venue_deals set reviewed_at = now(), review_note = 'אושר' where id = gd_bar;
    raise exception 'review columns changed directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.venues set status = 'approved', household_id = null where id = gv_dup;
    raise exception 'place approved directly';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.venues set hidden = true where id = gv_dup;
    raise exception 'place hidden by a member';
  exception when insufficient_privilege then null;
  end;
  -- A global place is read-only; an own pending deal is not.
  update public.venues set name = 'שם אחר' where id = gv_bar;
  get diagnostics n = row_count;
  assert n = 0, 'a global place was edited';
  update public.venue_deals set note = 'עד 20:00 בלבד' where id = gd_bar;
  get diagnostics n = row_count;
  assert n = 1, 'own pending deal not editable';

  -- Checks.
  begin
    insert into public.venue_deals (venue_id, household_id, title, kind, starts_at, ends_at)
    values (gv_bar, ghid, 'שעה ריקה', 'happy_hour', '20:00', '20:00');
    raise exception 'a deal that starts when it ends accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_deals (venue_id, household_id, title, kind, weekdays)
    values (gv_bar, ghid, 'יום שמיני', 'special_day', '{7}');
    raise exception 'weekday 7 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.venue_deals (venue_id, household_id, title, kind) values (gv_bar, ghid, 'א', 'event');
    raise exception 'one-letter title accepted';
  exception when check_violation then null;
  end;
end;
$$;

-- The partner sees all of it, another household none of it.
select public.test_login('00000000-0000-0000-0000-0000000000c2');
do $$
begin
  assert (select count(*) from public.venue_deals where household_id = current_setting('test.ghid')::uuid) = 3,
    'partner does not see the household''s deals';
  assert (select count(*) from public.venues where household_id = current_setting('test.ghid')::uuid) = 2,
    'partner does not see the household''s places';
end;
$$;

select public.test_login('00000000-0000-0000-0000-0000000000c3');
do $$
declare
  n int;
begin
  assert not exists (select 1 from public.venue_deals where household_id = current_setting('test.ghid')::uuid),
    'stranger sees pending deals';
  assert not exists (select 1 from public.venues where household_id = current_setting('test.ghid')::uuid),
    'stranger sees suggested places';
  assert exists (select 1 from public.venues where id = current_setting('test.gv_tal')::bigint), 'own place missing';
  assert (select count(*) from public.venues where osm_ref in ('node/1001', 'way/1002', 'node/1003')) = 2,
    'global places wrong';
  delete from public.venue_deals where id = current_setting('test.gd_bar')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'stranger deleted a deal';
  begin
    perform public.confirm_deal(current_setting('test.gd_bar')::uuid);
    raise exception 'confirmed a deal the caller cannot see';
  exception when no_data_found then
    if sqlerrm <> 'not found' then raise; end if;
  end;
  begin
    perform public.confirm_deal(gen_random_uuid());
    raise exception 'confirmed a missing deal';
  exception when no_data_found then
    if sqlerrm <> 'not found' then raise; end if;
  end;
end;
$$;

-- 2. Only admins review, and anon reaches nothing.
select public.test_login('00000000-0000-0000-0000-0000000000c1');
do $$
declare
  calls text[] := array[
    'select public.admin_list_suggestions()',
    format('select public.admin_review_deal(%L, true)', current_setting('test.gd_bar')),
    format('select public.admin_review_venue(%s, true)', current_setting('test.gv_new')),
    format('select public.admin_merge_venue(%s, %s)', current_setting('test.gv_dup'), current_setting('test.gv_bar')),
    format('select public.admin_update_deal(%L, ''נפרץ'', ''event'', ''{}'', null, null, null, null, null)', current_setting('test.gd_bar')),
    format('select public.admin_update_venue(%s, ''נפרץ'', ''bar'', null, null, null, null, null, null, null)', current_setting('test.gv_bar')),
    format('select public.admin_delete_deal(%L)', current_setting('test.gd_bar')),
    format('select public.admin_hide_venue(%s, true)', current_setting('test.gv_bar'))
  ];
  c text;
begin
  foreach c in array calls loop
    begin
      execute c;
      raise exception 'a non-admin ran: %', c;
    exception when insufficient_privilege then null;
    end;
  end loop;
end;
$$;
reset role;
set role anon;
do $$
begin
  begin
    perform public.confirm_deal(gen_random_uuid());
    raise exception 'anon ran confirm_deal';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.venues;
    raise exception 'anon reads venues';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
do $$
declare
  f text;
begin
  foreach f in array array[
    'public.admin_update_deal(uuid, text, text, smallint[], time, time, date, date, text)',
    'public.admin_update_venue(bigint, text, text, text, text, text, text, text, double precision, double precision)',
    'public.admin_delete_deal(uuid)', 'public.admin_hide_venue(bigint, boolean)'
  ] loop
    assert not has_function_privilege('anon', f, 'execute') and has_function_privilege('authenticated', f, 'execute'),
      'wrong grants on ' || f;
  end loop;
  foreach f in array array['public.going_out_review_key(uuid, text)', 'public.set_suggested_household()'] loop
    assert not has_function_privilege('authenticated', f, 'execute'), 'clients can run ' || f;
  end loop;
end;
$$;

-- An admin's own suggestion (נועה, from the notifications tests) is not
-- announced to her, only to the other admins.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000a1');
insert into public.venues (name, kind, source, status, household_id)
values ('המקום של נועה', 'cafe', 'community', 'pending', :'nhid') returning id as gv_noa \gset
reset role;
select set_config('test.gv_noa', :'gv_noa', false);

-- 3. New suggestions, for admins with the admin pref on.
do $$
declare
  maya uuid := '00000000-0000-0000-0000-0000000000c4';
  noa uuid := '00000000-0000-0000-0000-0000000000a1';
  o public.notification_outbox;
begin
  select * into o from public.notification_outbox
  where user_id = maya and dedup_key = 'going-out:new:deal:' || current_setting('test.gd_bar');
  assert o.kind = 'admin' and o.title = 'הצעה חדשה בלאן יוצאים' and o.body = 'בר הבדיקה: בירה בחצי מחיר, מבית הכהנים'
    and o.url = '/admin?tab=suggestions', format('new deal notification wrong: %s', to_jsonb(o));
  select * into o from public.notification_outbox
  where user_id = maya and dedup_key = 'going-out:new:venue:' || current_setting('test.gv_new');
  assert o.kind = 'admin' and o.body = 'גינת הבירה: מקום חדש, מבית הכהנים', format('new place notification wrong: %s', to_jsonb(o));
  -- Three deals and two places from עדי, one place each from טל and נועה.
  assert (select count(*) from public.notification_outbox where user_id = maya and dedup_key like 'going-out:new:%') = 7,
    format('admin notifications: %s', (select jsonb_agg(dedup_key) from public.notification_outbox
                                       where user_id = maya and dedup_key like 'going-out:%'));
  assert not exists (
    select 1 from public.notification_outbox
    where user_id = noa and dedup_key = 'going-out:new:venue:' || current_setting('test.gv_noa')
  ), 'an admin was told about her own suggestion';
  assert not exists (
    select 1 from public.notification_outbox
    where dedup_key like 'going-out:%' and user_id in (
      '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3')
  ), 'members were told about suggestions';
  assert not (select going_out from public.notification_prefs where user_id = '00000000-0000-0000-0000-0000000000c1'),
    'going_out is not off by default';
end;
$$;

-- 4. The admin's list and reviews.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c4');
do $$
declare
  ghid uuid := current_setting('test.ghid')::uuid;
  gv_bar bigint := current_setting('test.gv_bar')::bigint;
  gv_dup bigint := current_setting('test.gv_dup')::bigint;
  gv_new bigint := current_setting('test.gv_new')::bigint;
  gv_tal bigint := current_setting('test.gv_tal')::bigint;
  gd_bar uuid := current_setting('test.gd_bar')::uuid;
  gd_new uuid := current_setting('test.gd_new')::uuid;
  gd_dup uuid := current_setting('test.gd_dup')::uuid;
  s record;
begin
  assert (
    select array_agg(item_type || ':' || coalesce(deal_id::text, venue_id::text) order by ordinality)
    from public.admin_list_suggestions() with ordinality
    where household_id = ghid
  ) = array['venue:' || gv_dup, 'venue:' || gv_new, 'deal:' || gd_bar, 'deal:' || gd_new, 'deal:' || gd_dup],
    format('suggestions wrong: %s', (select jsonb_agg(to_jsonb(x)) from public.admin_list_suggestions() x));
  assert not exists (
    select 1 from (
      select created_at, lag(created_at) over (order by ordinality) as prev
      from public.admin_list_suggestions() with ordinality
    ) t where t.created_at < t.prev
  ), 'suggestions not oldest first';

  select * into s from public.admin_list_suggestions() where item_type = 'venue' and venue_id = gv_dup;
  assert s.similar_venue_id = gv_bar and s.similar_venue_name = 'בר הבדיקה' and s.household_name = 'הכהנים'
    and s.venue_status = 'pending' and s.deal_id is null and s.title is null, format('duplicate place row wrong: %s', to_jsonb(s));
  select * into s from public.admin_list_suggestions() where item_type = 'venue' and venue_id = gv_new;
  assert s.similar_venue_id is null and s.venue_address = 'רחוב הדוגמה 5' and s.venue_kind = 'pub'
    and s.venue_opening_hours = 'Th-Sa 20:00-02:00' and s.venue_website = 'https://example.com/ginat'
    and s.venue_phone = '08-0000005' and s.venue_instagram = 'ginat.example',
    format('new place row wrong: %s', to_jsonb(s));
  select * into s from public.admin_list_suggestions() where deal_id = gd_dup;
  assert s.venue_name = 'בר הבדיקה!' and s.venue_status = 'pending' and s.deal_kind = 'special_day'
    and s.weekdays = '{2}' and s.note = 'בקנייה של מנה עיקרית' and s.similar_venue_id is null,
    format('deal row wrong: %s', to_jsonb(s));
  select * into s from public.admin_list_suggestions() where deal_id = gd_bar;
  assert s.venue_status = 'approved' and s.starts_at = '18:00' and s.ends_at = '20:00' and s.venue_lat = 31.2430
    and s.household_id = ghid and s.venue_opening_hours = 'Su-Th 17:00-01:00', format('deal row wrong: %s', to_jsonb(s));

  -- A deal waits for its place.
  begin
    perform public.admin_review_deal(gd_new, true);
    raise exception 'deal approved on a pending place';
  exception when invalid_parameter_value then
    if sqlerrm <> 'venue not approved' then raise; end if;
  end;
  perform public.admin_review_venue(gv_new, true);
  perform public.admin_review_deal(gd_new, true);
  perform public.admin_review_deal(gd_bar, true, ' ');
  -- The duplicate place: its deal moves to the approved one, then is rejected.
  perform public.admin_merge_venue(gv_dup, gv_bar);
  perform public.admin_review_deal(gd_dup, false, 'כבר לא בתוקף');
  perform public.admin_review_venue(gv_tal, false);

  begin
    perform public.admin_merge_venue(gv_new, gv_bar);
    raise exception 'an approved place was merged';
  exception when no_data_found then
    if sqlerrm <> 'not found' then raise; end if;
  end;
  begin
    perform public.admin_merge_venue(-1, gv_bar);
    raise exception 'a missing place was merged';
  exception when no_data_found then
    if sqlerrm <> 'not found' then raise; end if;
  end;
  begin
    perform public.admin_merge_venue(current_setting('test.gv_noa')::bigint, -1);
    raise exception 'merged into a missing place';
  exception when invalid_parameter_value then
    if sqlerrm <> 'venue not approved' then raise; end if;
  end;
  begin
    perform public.admin_merge_venue(current_setting('test.gv_noa')::bigint, gv_tal);
    raise exception 'merged into a place that is not approved';
  exception when invalid_parameter_value then
    if sqlerrm <> 'venue not approved' then raise; end if;
  end;
  begin
    perform public.admin_review_venue(gv_bar, false);
    raise exception 'a global place was rejected';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.admin_review_deal(gen_random_uuid(), true);
    raise exception 'a missing deal was reviewed';
  exception when no_data_found then null;
  end;
  assert not exists (select 1 from public.admin_list_suggestions() where household_id in (ghid, current_setting('test.ghid2')::uuid)),
    'reviewed suggestions still listed';
end;
$$;
reset role;

do $$
declare
  ghid uuid := current_setting('test.ghid')::uuid;
  gv_bar bigint := current_setting('test.gv_bar')::bigint;
begin
  assert (select household_id is null and status = 'approved' and source = 'community'
          from public.venues where id = current_setting('test.gv_new')::bigint), 'approved place is not global';
  assert not exists (select 1 from public.venues where id = current_setting('test.gv_dup')::bigint), 'merged place kept';
  assert (select venue_id = gv_bar and status = 'rejected' and review_note = 'כבר לא בתוקף' and household_id = ghid
          from public.venue_deals where id = current_setting('test.gd_dup')::uuid), 'merge or rejection not recorded';
  assert (select status = 'approved' and reviewed_by = '00000000-0000-0000-0000-0000000000c4' and reviewed_at is not null
            and review_note is null and household_id = ghid
          from public.venue_deals where id = current_setting('test.gd_bar')::uuid), 'approval not recorded';
  assert (select status = 'rejected' and household_id = current_setting('test.ghid2')::uuid
          from public.venues where id = current_setting('test.gv_tal')::bigint), 'rejected place not kept for its household';
end;
$$;

-- 5. After the review: everyone sees the approved deals; the household
-- still sees its rejected one and can no longer edit the approved ones.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c3');
do $$
begin
  assert (
    select array_agg(id order by created_at) from public.venue_deals
    where id in (current_setting('test.gd_bar')::uuid, current_setting('test.gd_new')::uuid, current_setting('test.gd_dup')::uuid)
  ) = array[current_setting('test.gd_bar')::uuid, current_setting('test.gd_new')::uuid], 'approved deals not visible to all';
  assert exists (select 1 from public.venues where id = current_setting('test.gv_new')::bigint), 'approved place not visible';
  assert (select status from public.venues where id = current_setting('test.gv_tal')::bigint) = 'rejected',
    'rejected place not visible to its household';
end;
$$;

select public.test_login('00000000-0000-0000-0000-0000000000c1');
do $$
declare
  n int;
begin
  assert (select status = 'rejected' and review_note = 'כבר לא בתוקף'
          from public.venue_deals where id = current_setting('test.gd_dup')::uuid), 'rejected deal not visible to its household';
  update public.venue_deals set title = 'שונה' where id = current_setting('test.gd_bar')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'an approved deal was edited';
  delete from public.venue_deals where id = current_setting('test.gd_bar')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'an approved deal was deleted';
end;
$$;
reset role;

-- 6. Reviews, for the suggesting household (with going_out on).
do $$
declare
  ron uuid := '00000000-0000-0000-0000-0000000000c2';
  o public.notification_outbox;
begin
  select * into o from public.notification_outbox
  where user_id = ron and dedup_key = 'going-out:approved:deal:' || current_setting('test.gd_bar');
  assert o.kind = 'going_out' and o.title = 'ההצעה אושרה' and o.body = 'בירה בחצי מחיר בבר הבדיקה מופיע עכשיו לכולם'
    and o.url = '/going-out/suggestions', format('approval notification wrong: %s', to_jsonb(o));
  assert (select body from public.notification_outbox
          where user_id = ron and dedup_key = 'going-out:approved:venue:' || current_setting('test.gv_new'))
    = 'גינת הבירה מופיע עכשיו לכולם', 'place approval notification wrong';
  assert (select body from public.notification_outbox
          where user_id = ron and dedup_key = 'going-out:approved:deal:' || current_setting('test.gd_new'))
    = 'ערב ג׳אז בגינת הבירה מופיע עכשיו לכולם', 'approval of the event wrong';
  select * into o from public.notification_outbox
  where user_id = ron and dedup_key = 'going-out:rejected:deal:' || current_setting('test.gd_dup');
  assert o.kind = 'going_out' and o.title = 'ההצעה לא אושרה' and o.body = 'שלישי: יין ללא תחתית: כבר לא בתוקף'
    and o.url = '/going-out/suggestions', format('rejection notification wrong: %s', to_jsonb(o));
  -- Without a note, just the name.
  assert (select body from public.notification_outbox
          where user_id = '00000000-0000-0000-0000-0000000000c3'
            and dedup_key = 'going-out:rejected:venue:' || current_setting('test.gv_tal')) = 'הפינה של טל',
    'rejection without a note wrong';
  assert (select count(*) from public.notification_outbox where kind = 'going_out' and user_id = ron) = 4,
    'expected four reviews for רון';
  assert not exists (
    select 1 from public.notification_outbox
    where kind = 'going_out' and user_id in ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c4')
  ), 'notified with going_out off, or not in the household';
end;
$$;

-- 7. confirm_deal: at most once per 12 hours.
update public.venue_deals set last_confirmed_at = now() - interval '13 hours' where id = :'gd_bar';
update public.venue_deals set last_confirmed_at = now() - interval '11 hours' where id = :'gd_new';
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c3');
select public.confirm_deal(:'gd_bar');
select public.confirm_deal(:'gd_new');
reset role;
do $$
begin
  assert (select last_confirmed_at > now() - interval '1 hour' from public.venue_deals
          where id = current_setting('test.gd_bar')::uuid), 'confirm_deal did not update';
  assert (select last_confirmed_at < now() - interval '10 hours' from public.venue_deals
          where id = current_setting('test.gd_new')::uuid), 'confirmed twice within 12 hours';
end;
$$;

-- 8. Member columns move with the member, and the partner sees changes live.
do $$
declare
  ghid uuid := current_setting('test.ghid')::uuid;
  adi uuid := '00000000-0000-0000-0000-0000000000c1';
  tal uuid := '00000000-0000-0000-0000-0000000000c3';
  maya uuid := '00000000-0000-0000-0000-0000000000c4';
  ph uuid := gen_random_uuid();
begin
  perform public.move_member_refs(ghid, adi, ph);
  perform public.move_member_refs(ghid, maya, ph);
  perform public.move_member_refs(current_setting('test.ghid2')::uuid, tal, ph);
  assert (select bool_and(created_by = ph and (reviewed_by is null or reviewed_by = ph)) and count(*) = 3
          from public.venue_deals where household_id = ghid), 'deal member columns not moved';
  assert (select created_by from public.venues where id = current_setting('test.gv_tal')::bigint) = ph,
    'place created_by not moved';
  assert exists (
    select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'venue_deals'
  ), 'venue_deals not in the realtime publication';
end;
$$;

-- 9. Editing after a review. A rejected suggestion that its household edits
-- goes back to the admins, the admin's note kept; admins edit, delete and
-- hide anything, whatever its status.
do $$
begin
  assert (select household_id is null and suggested_household_id = current_setting('test.ghid')::uuid
          from public.venues where id = current_setting('test.gv_new')::bigint), 'suggesting household not kept after approval';
  assert (select suggested_household_id from public.venues where id = current_setting('test.gv_tal')::bigint)
    = current_setting('test.ghid2')::uuid, 'suggesting household not set';
  assert (select suggested_household_id is null and admin_edited_at is null and not hidden_by_admin
          from public.venues where id = current_setting('test.gv_bar')::bigint), 'OSM place columns wrong';
end;
$$;

set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c1');
do $$
declare
  ghid uuid := current_setting('test.ghid')::uuid;
  gd_dup uuid := current_setting('test.gd_dup')::uuid;
  vid bigint;
  sid uuid;
  d public.venue_deals;
  n int;
begin
  -- The suggesting household is the inserting one; the admin columns are the RPCs'.
  insert into public.venues (name, kind, source, status, household_id, suggested_household_id)
  values ('מקום בשם אחר', 'bar', 'community', 'pending', ghid, current_setting('test.ghid2')::uuid)
  returning id, suggested_household_id into vid, sid;
  assert sid = ghid, 'a client chose the suggesting household';
  begin
    update public.venues set suggested_household_id = null where id = vid;
    raise exception 'suggesting household changed by a member';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.venues set admin_edited_at = now() where id = vid;
    raise exception 'admin_edited_at set by a member';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.venues set hidden_by_admin = true where id = vid;
    raise exception 'hidden_by_admin set by a member';
  exception when insufficient_privilege then null;
  end;
  delete from public.venues where id = vid;

  -- Unchanged content is no edit, and the status is still not the client's.
  update public.venue_deals set title = title where id = gd_dup;
  assert (select status from public.venue_deals where id = gd_dup) = 'rejected', 'an update without changes resubmitted';
  begin
    update public.venue_deals set status = 'pending' where id = gd_dup;
    raise exception 'rejected deal resubmitted directly';
  exception when insufficient_privilege then null;
  end;
  update public.venue_deals set title = 'שלישי: יין ב-20 ש״ח', note = 'עם מנה עיקרית' where id = gd_dup;
  get diagnostics n = row_count;
  assert n = 1, 'own rejected deal not editable';
  select * into d from public.venue_deals where id = gd_dup;
  assert d.status = 'pending' and d.reviewed_by is null and d.reviewed_at is null and d.review_note = 'כבר לא בתוקף'
    and d.title = 'שלישי: יין ב-20 ש״ח', format('resubmission wrong: %s', to_jsonb(d));
  -- An approved deal is still the admin's.
  update public.venue_deals set title = 'שונה' where id = current_setting('test.gd_bar')::uuid;
  get diagnostics n = row_count;
  assert n = 0, 'an approved deal was edited';
end;
$$;

select public.test_login('00000000-0000-0000-0000-0000000000c3');
update public.venues set name = 'הפינה של טל, עם כתובת', address = 'רחוב הניסוי 3' where id = :gv_tal;
reset role;

do $$
declare
  maya uuid := '00000000-0000-0000-0000-0000000000c4';
  o public.notification_outbox;
begin
  assert (select status = 'pending' and household_id = current_setting('test.ghid2')::uuid
          from public.venues where id = current_setting('test.gv_tal')::bigint), 'rejected place not resubmitted';
  select * into o from public.notification_outbox
  where user_id = maya and dedup_key like 'going-out:resubmit:deal:' || current_setting('test.gd_dup') || ':%';
  assert o.kind = 'admin' and o.title = 'הצעה נשלחה שוב לאישור' and o.body = 'בר הבדיקה: שלישי: יין ב-20 ש״ח, מבית הכהנים'
    and o.url = '/admin?tab=suggestions', format('resubmitted deal notification wrong: %s', to_jsonb(o));
  select * into o from public.notification_outbox
  where user_id = maya and dedup_key like 'going-out:resubmit:venue:' || current_setting('test.gv_tal') || ':%';
  assert o.kind = 'admin' and o.title = 'הצעה נשלחה שוב לאישור' and o.body = 'הפינה של טל, עם כתובת: מקום חדש, מבית בית טל'
    and o.url = '/admin?tab=suggestions', format('resubmitted place notification wrong: %s', to_jsonb(o));
  assert not exists (
    select 1 from public.notification_outbox
    where dedup_key like 'going-out:resubmit:%' and user_id in (
      '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000c2', '00000000-0000-0000-0000-0000000000c3')
  ), 'members were told about a resubmission';
end;
$$;

set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c4');
do $$
declare
  gv_bar bigint := current_setting('test.gv_bar')::bigint;
  gv_new bigint := current_setting('test.gv_new')::bigint;
  gv_tal bigint := current_setting('test.gv_tal')::bigint;
  gd_bar uuid := current_setting('test.gd_bar')::uuid;
  gd_dup uuid := current_setting('test.gd_dup')::uuid;
  d public.venue_deals;
  v public.venues;
  c text;
begin
  assert (select count(*) from public.admin_list_suggestions()
          where deal_id = gd_dup or (item_type = 'venue' and venue_id = gv_tal)) = 2, 'resubmitted suggestions not listed';

  -- An approved deal: edited, still approved.
  perform public.admin_update_deal(gd_bar, ' בירה 1+1 ', 'happy_hour', '{4,5}', '19:00', '21:00', null, null, ' ');
  select * into d from public.venue_deals where id = gd_bar;
  assert d.title = 'בירה 1+1' and d.weekdays = '{4,5}' and d.starts_at = '19:00' and d.ends_at = '21:00' and d.note is null
    and d.status = 'approved' and d.reviewed_at is not null, format('admin deal edit wrong: %s', to_jsonb(d));
  -- A pending one stays pending; rejected again, the household hears again.
  perform public.admin_update_deal(gd_dup, 'שלישי: יין ב-25 ש״ח', 'special_day', '{2}', null, null, null, null, 'עם מנה עיקרית');
  -- (Another household's pending rows are not readable: through the list.)
  assert exists (select 1 from public.admin_list_suggestions() where deal_id = gd_dup and title = 'שלישי: יין ב-25 ש״ח'),
    'admin edit of a pending deal wrong';
  perform public.admin_review_deal(gd_dup, false, 'עדיין לא');

  -- An OSM place, marked for the ingest.
  perform public.admin_update_venue(gv_bar, 'בר הבדיקה המחודש', 'pub', ' רחוב הבדיקה 1 ', 'Mo-Su 18:00-02:00',
    'https://example.com/bar', ' ', 'bar.example', 31.2440, 34.7940);
  select * into v from public.venues where id = gv_bar;
  assert v.name = 'בר הבדיקה המחודש' and v.kind = 'pub' and v.address = 'רחוב הבדיקה 1'
    and v.opening_hours = 'Mo-Su 18:00-02:00' and v.website = 'https://example.com/bar' and v.phone is null
    and v.instagram = 'bar.example' and v.lat = 31.2440 and v.lng = 34.7940 and v.admin_edited_at is not null
    and v.source = 'osm' and v.osm_ref = 'node/1001' and v.status = 'approved', format('admin place edit wrong: %s', to_jsonb(v));
  -- A pending place stays pending until it is approved.
  perform public.admin_update_venue(gv_tal, 'הפינה של טל', 'cafe', 'רחוב הניסוי 3', null, null, null, null, null, null);
  assert exists (select 1 from public.admin_list_suggestions()
                 where item_type = 'venue' and venue_id = gv_tal and venue_name = 'הפינה של טל' and venue_kind = 'cafe'),
    'admin edit of a pending place wrong';
  perform public.admin_review_venue(gv_tal, true);
  begin
    perform public.admin_update_venue(gv_tal, 'הפינה של טל', 'cafe', null, null, null, null, null, 31.25, null);
    raise exception 'a place with lat and no lng accepted';
  exception when check_violation then null;
  end;

  foreach c in array array[
    format('select public.admin_update_deal(%L, ''אין כזה'', ''event'', ''{}'', null, null, null, null, null)', gen_random_uuid()),
    'select public.admin_update_venue(-1, ''אין כזה'', ''bar'', null, null, null, null, null, null, null)',
    format('select public.admin_delete_deal(%L)', gen_random_uuid()),
    'select public.admin_hide_venue(-1, true)'
  ] loop
    begin
      execute c;
      raise exception 'no error for a missing row: %', c;
    exception when no_data_found then
      if sqlerrm <> 'not found' then raise; end if;
    end;
  end loop;
  begin
    perform public.admin_hide_venue(gv_new, null);
    raise exception 'hidden without saying whether';
  exception when invalid_parameter_value then null;
  end;

  perform public.admin_hide_venue(gv_new, true);
  perform public.admin_delete_deal(current_setting('test.gd_new')::uuid);
end;
$$;
reset role;

do $$
declare
  ron uuid := '00000000-0000-0000-0000-0000000000c2';
  o public.notification_outbox;
begin
  assert (select hidden and hidden_by_admin from public.venues where id = current_setting('test.gv_new')::bigint),
    'place not hidden by the admin';
  assert not exists (select 1 from public.venue_deals where id = current_setting('test.gd_new')::uuid), 'deal not deleted';
  assert (select status = 'rejected' and title = 'שלישי: יין ב-25 ש״ח' and note = 'עם מנה עיקרית' and review_note = 'עדיין לא'
          from public.venue_deals where id = current_setting('test.gd_dup')::uuid), 'admin edit of a pending deal not kept';
  assert (select admin_edited_at is not null and address = 'רחוב הניסוי 3'
          from public.venues where id = current_setting('test.gv_tal')::bigint), 'admin edit of a pending place not kept';
  -- The second rejection is not dropped as a duplicate of the first.
  assert (select count(*) from public.notification_outbox
          where user_id = ron and dedup_key like 'going-out:rejected:deal:' || current_setting('test.gd_dup') || '%') = 2,
    'second rejection not sent';
  select * into o from public.notification_outbox
  where user_id = ron and dedup_key like 'going-out:rejected:deal:' || current_setting('test.gd_dup') || ':%';
  assert o.body = 'שלישי: יין ב-25 ש״ח: עדיין לא' and o.url = '/going-out/suggestions',
    format('second rejection wrong: %s', to_jsonb(o));
  select * into o from public.notification_outbox
  where user_id = '00000000-0000-0000-0000-0000000000c3' and dedup_key = 'going-out:approved:venue:' || current_setting('test.gv_tal');
  assert o.body = 'הפינה של טל מופיע עכשיו לכולם' and o.url = '/going-out/suggestions',
    format('approval after resubmission wrong: %s', to_jsonb(o));
end;
$$;

-- Hidden for everyone, shown again by the admin.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c3');
do $$
begin
  assert not exists (select 1 from public.venues where id = current_setting('test.gv_new')::bigint), 'a hidden place is visible';
  assert (select status = 'approved' and household_id is null from public.venues where id = current_setting('test.gv_tal')::bigint),
    'resubmitted place not approved';
end;
$$;
select public.test_login('00000000-0000-0000-0000-0000000000c4');
select public.admin_hide_venue(:gv_new, false);
select public.test_login('00000000-0000-0000-0000-0000000000c3');
do $$
begin
  assert exists (select 1 from public.venues where id = current_setting('test.gv_new')::bigint), 'place not shown again';
end;
$$;
reset role;

-- The suggesting household goes; its approved place stays, without it.
delete from public.households where id = :'ghid2';
do $$
begin
  assert (select not hidden and not hidden_by_admin from public.venues where id = current_setting('test.gv_new')::bigint),
    'shown place still marked hidden';
  assert (select status = 'approved' and suggested_household_id is null
          from public.venues where id = current_setting('test.gv_tal')::bigint), 'approved place not kept without its household';
end;
$$;

-- ---------------------------------------------------------------------------
-- Favorites and keva card discounts (20261102000100_venue_favorites.sql).
-- עדי stars places for her household; מאיה, in no household, sees none and
-- can't star for it.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c1');
insert into public.venues (name, kind, source, status, household_id)
values ('בר הכפילות', 'bar', 'community', 'pending', :'ghid') returning id as gv_twin \gset
insert into public.venue_favorites (household_id, venue_id) values (:'ghid', :gv_bar), (:'ghid', :gv_twin);
insert into public.venue_deals (venue_id, household_id, title, kind)
values (:gv_bar, :'ghid', '10% הנחה בכרטיס חבר', 'member_card');
select set_config('test.gv_twin', :'gv_twin', false);
do $$
begin
  assert (select count(*) from public.venue_favorites) = 2, 'own favorites not visible';
  begin
    insert into public.venue_deals (venue_id, household_id, title, kind)
    values (current_setting('test.gv_twin')::bigint, current_setting('test.ghid')::uuid, 'סוג לא קיים', 'coupon');
    raise exception 'an unknown deal kind was saved';
  exception when check_violation then null;
  end;
end;
$$;
select public.test_login('00000000-0000-0000-0000-0000000000c4');
do $$
begin
  assert not exists (select 1 from public.venue_favorites), 'another household''s favorites visible';
  begin
    insert into public.venue_favorites (household_id, venue_id)
    values (current_setting('test.ghid')::uuid, current_setting('test.gv_twin')::bigint);
    raise exception 'starred for another household';
  exception when insufficient_privilege then null;
  end;
  -- Merging the twin into the bar keeps one star, not two.
  perform public.admin_merge_venue(current_setting('test.gv_twin')::bigint, current_setting('test.gv_bar')::bigint);
end;
$$;
reset role;
do $$
begin
  assert (select count(*) from public.venue_favorites
          where household_id = current_setting('test.ghid')::uuid
            and venue_id = current_setting('test.gv_bar')::bigint) = 1, 'merged star lost or duplicated';
  assert not exists (select 1 from public.venues where id = current_setting('test.gv_twin')::bigint), 'twin not merged';
  assert (select kind from public.venue_deals where title = '10% הנחה בכרטיס חבר') = 'member_card',
    'member_card deal not saved';
end;
$$;
-- Unstarring, by the household.
set role authenticated;
select public.test_login('00000000-0000-0000-0000-0000000000c1');
delete from public.venue_favorites where venue_id = :gv_bar;
reset role;
do $$
begin
  assert not exists (select 1 from public.venue_favorites where household_id = current_setting('test.ghid')::uuid),
    'star not removed';
end;
$$;
set role anon;
do $$
begin
  perform 1 from public.venue_favorites;
  raise exception 'anon reads favorites';
exception when insufficient_privilege then null;
end;
$$;
reset role;
-- A star goes with its place.
insert into public.venues (osm_ref, name, kind, source) values ('node/900002', 'בר שנסגר', 'bar', 'osm')
returning id as gv_gone \gset
insert into public.venue_favorites (household_id, venue_id) values (:'ghid', :gv_gone);
delete from public.venues where id = :gv_gone;
do $$
begin
  assert not exists (select 1 from public.venue_favorites where household_id = current_setting('test.ghid')::uuid),
    'star kept after its place was deleted';
end;
$$;

-- ---------------------------------------------------------------------------
-- OpenTofu state (20261028000100_tofu_state.sql): one role, one table, no API.
do $$
declare
  r text;
begin
  assert (select not rolcanlogin from pg_roles where rolname = 'tofu_state'),
    'tofu_state can log in before the owner sets a password';
  foreach r in array array['anon', 'authenticated', 'service_role'] loop
    assert not has_schema_privilege(r, 'tofu_state', 'usage'), r || ' can use schema tofu_state';
    assert not has_table_privilege(r, 'tofu_state.states', 'select'), r || ' can read the state';
  end loop;
  assert not has_schema_privilege('tofu_state', 'tofu_state', 'create'), 'tofu_state can create objects';
  assert not has_schema_privilege('tofu_state', 'public', 'create'), 'tofu_state can create in public';
  assert not has_table_privilege('tofu_state', 'public.households', 'select'), 'tofu_state can read app data';
end;
$$;

-- What the backend runs: write, read, lock (internal/backend/remote-state/pg).
set role tofu_state;
insert into tofu_state.states (name, data) values ('default', 'v1')
  on conflict (name) do update set data = excluded.data;
insert into tofu_state.states (name, data) values ('default', 'v2')
  on conflict (name) do update set data = excluded.data;
select id as state_id, pg_try_advisory_lock(id) as locked from tofu_state.states where name = 'default' \gset
reset role;
select set_config('test.state_locked', :'locked', false);
do $$
begin
  assert (select data from tofu_state.states where name = 'default') = 'v2', 'state not updated in place';
  assert current_setting('test.state_locked')::boolean, 'advisory lock not taken';
end;
$$;
select pg_advisory_unlock(:state_id);
delete from tofu_state.states;

\echo 'All database tests passed'
