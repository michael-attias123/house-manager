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
end;
$$;

-- 9. The schema rules the admin screen relies on.
do $$
begin
  assert not exists (
    select 1 from pg_constraint where contype = 'f' and confrelid = 'public.households'::regclass and confdeltype <> 'c'
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

\echo 'All database tests passed'
