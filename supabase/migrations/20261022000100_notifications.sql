-- Notifications: Web Push reminders for bills and chores, what the partner
-- recorded, a weekly summary, and failed price updates for admins
-- (web/src/features/notifications).
--
-- enqueue_notification() is the single entry point. It checks the
-- recipient's preference (every kind is off until chosen), holds immediate
-- notifications during quiet hours (22:00-07:00 Israel time) and drops
-- duplicates by (user_id, dedup_key). Rows wait in notification_outbox until
-- the send-push Edge Function (supabase/functions/send-push) delivers them;
-- request_push_send() calls it through pg_net after every insert, and pg_cron
-- every 10 minutes as the fallback.
--
-- pg_cron, pg_net and Vault exist on Supabase but not in plain Postgres (CI,
-- scripts/db-test.sh), so every use is guarded and becomes a no-op there.
--
-- These tables belong to a user, not a household: a device and its choices
-- follow the account.

-- Tables ----------------------------------------------------------------------

-- One row per browser/phone that turned notifications on (PushSubscription).
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  endpoint text not null unique check (endpoint like 'https://%'),
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_success_at timestamptz
);

create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

-- Which kinds a user wants, on all their devices. No row = everything off.
create table public.notification_prefs (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  bills boolean not null default false,
  chores boolean not null default false,
  partner boolean not null default false,
  weekly boolean not null default false,
  -- Only counts for users in app_admins.
  admin boolean not null default false,
  updated_at timestamptz not null default now()
);

create trigger notification_prefs_updated_at before update on public.notification_prefs
  for each row execute function public.set_updated_at();

-- Written only by enqueue_notification(), read only by the Edge Function.
create table public.notification_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('bills', 'chores', 'partner', 'weekly', 'admin', 'test')),
  title text not null,
  body text not null default '',
  url text not null default '/',
  dedup_key text not null,
  send_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Set while an Edge Function run is sending the row (claim_push_batch).
  claimed_at timestamptz,
  sent_at timestamptz,
  attempts int not null default 0,
  last_error text,
  unique (user_id, dedup_key)
);

create index notification_outbox_due_idx on public.notification_outbox (send_after) where sent_at is null;

alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.notification_outbox enable row level security;

create policy "own devices" on public.push_subscriptions
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own preferences" on public.notification_prefs
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
-- notification_outbox: no policies and no grants, so clients cannot reach it.

-- Revoked first, for projects whose default privileges still grant new tables.
revoke all on public.push_subscriptions, public.notification_prefs, public.notification_outbox
  from anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant select, insert, update on public.notification_prefs to authenticated;
grant all on public.push_subscriptions, public.notification_prefs, public.notification_outbox
  to service_role;

-- Helpers ---------------------------------------------------------------------

-- "₪1,240" for whole amounts, "₪12.50" otherwise (like formatILS in money.ts).
create or replace function public.format_ils(p_amount numeric)
returns text
language sql
immutable
as $$
  select '₪' || case
    when p_amount = trunc(p_amount) then to_char(p_amount, 'FM999,999,999,990')
    else to_char(p_amount, 'FM999,999,999,990.00')
  end;
$$;

-- Quiet hours: between 22:00 and 07:00 Israel time a notification waits for
-- 07:30. Computed in local time, so daylight saving time does not matter.
create or replace function public.after_quiet_hours(p_at timestamptz)
returns timestamptz
language sql
stable
as $$
  select case
    when local_at::time >= time '22:00' then (local_at::date + 1 + time '07:30') at time zone 'Asia/Jerusalem'
    when local_at::time < time '07:00' then (local_at::date + time '07:30') at time zone 'Asia/Jerusalem'
    else p_at
  end
  from (select p_at at time zone 'Asia/Jerusalem' as local_at) t;
$$;

-- The single entry point. Returns the outbox id, or null when nothing was
-- queued: the kind is off for this user (prefs default to false), the user
-- has no device, an admin notification for a non-admin, or a duplicate
-- dedup_key. 'test' ignores preferences and quiet hours.
create or replace function public.enqueue_notification(
  p_user_id uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_url text,
  p_dedup_key text,
  p_now timestamptz default now()
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_on boolean;
  v_id bigint;
begin
  if p_kind not in ('bills', 'chores', 'partner', 'weekly', 'admin', 'test') then
    raise exception 'unknown notification kind: %', p_kind;
  end if;
  if p_user_id is null
     or not exists (select 1 from public.push_subscriptions where user_id = p_user_id) then
    return null;
  end if;
  if p_kind = 'test' then
    v_on := true;
  else
    select case p_kind
      when 'bills' then p.bills
      when 'chores' then p.chores
      when 'partner' then p.partner
      when 'weekly' then p.weekly
      when 'admin' then p.admin and exists (select 1 from public.app_admins a where a.user_id = p_user_id)
    end
    into v_on
    from public.notification_prefs p
    where p.user_id = p_user_id;
  end if;
  if not coalesce(v_on, false) then
    return null;
  end if;

  insert into public.notification_outbox (user_id, kind, title, body, url, dedup_key, send_after)
  values (
    p_user_id, p_kind, p_title, coalesce(p_body, ''), coalesce(p_url, '/'), p_dedup_key,
    case when p_kind = 'test' then p_now else public.after_quiet_hours(p_now) end
  )
  on conflict (user_id, dedup_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- Every account in the household except p_except (whoever did the action).
-- Placeholder members have no account, and so no device.
create or replace function public.notify_members(
  p_household_id uuid,
  p_except uuid,
  p_kind text,
  p_title text,
  p_body text,
  p_url text,
  p_dedup_key text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  n int := 0;
begin
  for r in
    select user_id from public.household_members
    where household_id = p_household_id and not is_placeholder and user_id is distinct from p_except
  loop
    if public.enqueue_notification(r.user_id, p_kind, p_title, p_body, p_url, p_dedup_key) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

-- Sending ---------------------------------------------------------------------

-- Asks the send-push Edge Function to deliver what is due. Needs pg_net and
-- two Vault secrets (docs/setup.md): push_function_url and push_secret.
-- Without them, or with nothing due, it does nothing. Never raises, so it
-- cannot break the write that queued a notification.
create or replace function public.request_push_send()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_url text;
  v_secret text;
  v_request bigint;
begin
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'net' and p.proname = 'http_post'
  ) or to_regclass('vault.decrypted_secrets') is null then
    return null;
  end if;
  if not exists (
    select 1 from public.notification_outbox
    where sent_at is null and send_after <= now() and attempts < 5
  ) then
    return null;
  end if;

  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'push_function_url';
  select decrypted_secret into v_secret from vault.decrypted_secrets where name = 'push_secret';
  if coalesce(v_url, '') = '' or coalesce(v_secret, '') = '' then
    return null;
  end if;

  select net.http_post(
    url := v_url,
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_secret),
    timeout_milliseconds := 10000
  ) into v_request;
  return v_request;
exception when others then
  raise warning 'request_push_send: %', sqlerrm;
  return null;
end;
$$;

-- After an insert into the outbox: one request per transaction (a morning
-- run queues many rows), and only for rows that are due now. Quiet-hours
-- rows are picked up by the 10-minute cron job.
create or replace function public.outbox_request_send()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('house.push_requested', true), '') <> '1'
     and exists (select 1 from inserted where send_after <= now()) then
    perform set_config('house.push_requested', '1', true);
    perform public.request_push_send();
  end if;
  return null;
end;
$$;

create trigger notification_outbox_request_send
  after insert on public.notification_outbox
  referencing new table as inserted
  for each statement execute function public.outbox_request_send();

-- For the Edge Function (service role only): takes up to p_limit due rows,
-- each with the user's devices. A claim lasts 5 minutes, so a run that
-- crashed is retried; attempts counts every claim and stops at 5. Rows a
-- day late are dropped rather than sent ("bill due in 3 days" a week later).
create or replace function public.claim_push_batch(p_limit int default 100)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch jsonb;
begin
  update public.notification_outbox
  set last_error = 'expired', attempts = greatest(attempts, 5), claimed_at = null
  where sent_at is null and attempts < 5 and send_after < now() - interval '1 day';

  with due as (
    select id from public.notification_outbox
    where sent_at is null and send_after <= now() and attempts < 5
      and (claimed_at is null or claimed_at < now() - interval '5 minutes')
    order by send_after, id
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
    for update skip locked
  ),
  claimed as (
    update public.notification_outbox o
    set claimed_at = now(), attempts = o.attempts + 1
    from due
    where o.id = due.id
    returning o.*
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', c.id,
      'title', c.title,
      'body', c.body,
      'url', c.url,
      'tag', c.dedup_key,
      'subscriptions', coalesce((
        select jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth))
        from public.push_subscriptions s
        where s.user_id = c.user_id
      ), '[]'::jsonb)
    )
    order by c.id
  ), '[]'::jsonb)
  into v_batch
  from claimed c;
  return v_batch;
end;
$$;

-- For the Edge Function: the outcome of a claimed batch.
-- p_results: [{"id": 1, "ok": true, "error": null}, ...]. ok = done (sent to
-- at least one device, or nowhere left to send); otherwise it is retried.
-- p_delivered / p_gone: endpoints that accepted a message / that the push
-- service no longer knows (404/410), which are deleted.
create or replace function public.finish_push_batch(
  p_results jsonb,
  p_delivered text[] default '{}',
  p_gone text[] default '{}'
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.notification_outbox o
  set sent_at = case when (r ->> 'ok')::boolean then now() end,
      claimed_at = null,
      last_error = left(r ->> 'error', 500)
  from jsonb_array_elements(coalesce(p_results, '[]'::jsonb)) r
  where o.id = (r ->> 'id')::bigint and o.sent_at is null;

  update public.push_subscriptions set last_success_at = now()
  where endpoint = any (coalesce(p_delivered, '{}'));
  delete from public.push_subscriptions where endpoint = any (coalesce(p_gone, '{}'));
end;
$$;

-- Client RPCs -------------------------------------------------------------------

-- Saves this device for the caller. The endpoint is unique per browser, so
-- when someone else signs in on the same phone it moves to them.
create or replace function public.save_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if coalesce(p_endpoint, '') not like 'https://%' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'invalid subscription' using errcode = '22023';
  end if;
  insert into public.push_subscriptions as s (user_id, endpoint, p256dh, auth, user_agent)
  values (auth.uid(), p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300))
  on conflict (endpoint) do update set
    user_id = excluded.user_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    created_at = now()
  returning s.id into v_id;
  return v_id;
end;
$$;

-- Queues a test notification for the caller's devices, at most one per 10
-- seconds (a second tap returns null).
create or replace function public.send_test_notification()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (select 1 from public.push_subscriptions where user_id = auth.uid()) then
    raise exception 'no push subscription' using errcode = 'P0002';
  end if;
  return public.enqueue_notification(
    auth.uid(), 'test', 'התראת בדיקה', 'ההתראות עובדות 🎉', '/settings',
    'test:' || floor(extract(epoch from now()) / 10)::bigint
  );
end;
$$;

-- Sources -----------------------------------------------------------------------
-- A notification never blocks the write it is about: each source catches its
-- own errors and only logs them.

-- A new expense, for every other member with a share in it. Deferred to the
-- end of the transaction, so the shares (written after the expense) exist.
-- Imports and bill payments are skipped. A shopping trip's expense shares
-- the trip's dedup key, so a trip makes one notification, not two.
create or replace function public.notify_expense()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  e public.expenses;
  v_actor uuid;
  v_name text;
  r record;
begin
  select * into e from public.expenses where id = new.id;
  if e.id is null or e.source in ('import', 'bill') or e.external_id is not null then
    return null;
  end if;
  v_actor := coalesce(e.created_by, e.paid_by);
  select display_name into v_name from public.household_members
  where household_id = e.household_id and user_id = v_actor;
  for r in
    select user_id, amount from public.expense_shares
    where expense_id = e.id and amount > 0 and user_id <> v_actor
  loop
    perform public.enqueue_notification(
      r.user_id, 'partner',
      concat_ws(' · ', 'הוצאה חדשה', v_name),
      format('%s %s · החלק שלך %s', e.description, public.format_ils(e.amount), public.format_ils(r.amount)),
      '/expenses',
      case when e.source = 'trip' and e.source_id is not null then 'trip:' || e.source_id else 'expense:' || e.id end
    );
  end loop;
  return null;
exception when others then
  raise warning 'notify_expense: %', sqlerrm;
  return null;
end;
$$;

create constraint trigger expenses_notify
  after insert on public.expenses
  deferrable initially deferred
  for each row execute function public.notify_expense();

-- A transfer to someone, recorded by someone else. Imported ones are skipped.
create or replace function public.notify_settlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  if new.external_id is not null or new.to_user = coalesce(new.created_by, new.from_user) then
    return null;
  end if;
  select display_name into v_name from public.household_members
  where household_id = new.household_id and user_id = new.from_user;
  perform public.enqueue_notification(
    new.to_user, 'partner',
    concat_ws(' · ', 'העברה חדשה', v_name),
    concat_ws(' · ', public.format_ils(new.amount) || ' הועברו אליך', nullif(trim(new.note), '')),
    '/expenses',
    'settlement:' || new.id
  );
  return null;
exception when others then
  raise warning 'notify_settlement: %', sqlerrm;
  return null;
end;
$$;

create trigger settlements_notify
  after insert on public.settlements
  for each row execute function public.notify_settlement();

-- A finished shopping trip, for the other members. Deferred, because
-- complete_trip() fills in item_count after inserting the trip.
create or replace function public.notify_trip()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  t public.shopping_trips;
  v_name text;
begin
  select * into t from public.shopping_trips where id = new.id;
  if t.id is null then
    return null;
  end if;
  select display_name into v_name from public.household_members
  where household_id = t.household_id and user_id = t.created_by;
  perform public.notify_members(
    t.household_id, t.created_by, 'partner',
    concat_ws(' · ', 'קנייה הסתיימה', v_name),
    concat_ws(' · ',
      nullif(concat_ws(' ', public.format_ils(t.total), 'ב' || nullif(trim(t.store_name), '')), ''),
      case when t.item_count = 1 then 'פריט אחד' when t.item_count > 1 then t.item_count || ' פריטים' end
    ),
    '/shopping',
    'trip:' || t.id
  );
  return null;
exception when others then
  raise warning 'notify_trip: %', sqlerrm;
  return null;
end;
$$;

create constraint trigger shopping_trips_notify
  after insert on public.shopping_trips
  deferrable initially deferred
  for each row execute function public.notify_trip();

-- A price update that failed or finished partly, for admins.
create or replace function public.notify_ingest_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_chains text;
  r record;
begin
  -- stats: {"<chain>": {"error"?: ..., "stores": {"<code>": {"error"?: ...}}}}
  select string_agg(coalesce(c.name, s.key), ', ' order by s.key) into v_chains
  from jsonb_each(case when jsonb_typeof(new.stats) = 'object' then new.stats else '{}'::jsonb end) s
  left join public.chains c on c.id = s.key
  where jsonb_typeof(s.value) = 'object'
    and (
      s.value ? 'error'
      or exists (
        select 1
        from jsonb_each(case when jsonb_typeof(s.value -> 'stores') = 'object' then s.value -> 'stores' else '{}'::jsonb end) st
        where jsonb_typeof(st.value) = 'object' and st.value ? 'error'
      )
    );
  for r in select user_id from public.app_admins loop
    perform public.enqueue_notification(
      r.user_id, 'admin',
      case new.status when 'failed' then 'טעינת המחירים נכשלה' else 'טעינת המחירים הסתיימה חלקית' end,
      coalesce('רשתות עם תקלה: ' || v_chains, 'הפרטים במסך הניהול'),
      '/admin',
      'ingest:' || new.id
    );
  end loop;
  return null;
exception when others then
  raise warning 'notify_ingest_run: %', sqlerrm;
  return null;
end;
$$;

create trigger ingest_runs_notify
  after update of status on public.ingest_runs
  for each row
  when (new.status in ('failed', 'partial') and old.status is distinct from new.status)
  execute function public.notify_ingest_run();

-- auto_pay_due_bills (20261017000400_bills.sql), unchanged, plus a
-- notification for each standing order it records.
create or replace function public.auto_pay_due_bills()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  b public.bills;
  v_payment uuid;
  n int := 0;
begin
  loop
    select * into b from public.bills
    where active and auto_create and next_due_date <= current_date
    order by next_due_date
    limit 1
    for update skip locked;
    exit when b.id is null;
    v_payment := public.record_bill_payment(b, b.amount, b.paid_by_default, b.next_due_date);
    begin
      perform public.notify_members(
        b.household_id, null, 'bills', 'הוראת קבע נרשמה',
        b.name || ' ' || public.format_ils(b.amount), '/bills', 'autopay:' || v_payment
      );
    exception when others then
      raise warning 'auto_pay_due_bills notification: %', sqlerrm;
    end;
    n := n + 1;
  end loop;
  return n;
end;
$$;

-- Run hourly by pg_cron; acts at 08:00 Israel time (bills due in 3 days or
-- today, except standing orders; chores due today or overdue) and on Friday
-- at 09:00 (the weekly summary). Hours are taken in local time, so daylight
-- saving time does not matter. p_now lets tests pick the moment. Returns the
-- number of notifications queued.
create or replace function public.queue_scheduled_notifications(p_now timestamptz default now())
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_local timestamp := p_now at time zone 'Asia/Jerusalem';
  v_today date := (p_now at time zone 'Asia/Jerusalem')::date;
  v_hour int := extract(hour from p_now at time zone 'Asia/Jerusalem');
  r record;
  n int := 0;
begin
  -- Sent rows are kept a month for troubleshooting.
  delete from public.notification_outbox where created_at < now() - interval '30 days';

  if v_hour = 8 then
    for r in
      select b.id, b.name, b.amount, b.next_due_date, m.user_id
      from public.bills b
      join public.household_members m on m.household_id = b.household_id and not m.is_placeholder
      where b.active and not b.auto_create and b.next_due_date in (v_today, v_today + 3)
      order by b.next_due_date, b.name
    loop
      if public.enqueue_notification(
        r.user_id, 'bills', 'תזכורת תשלום',
        concat_ws(' ', r.name, public.format_ils(r.amount),
          case when r.next_due_date = v_today then 'לתשלום היום' else 'בעוד 3 ימים' end),
        '/bills',
        format('bill:%s:%s:%sd', r.id, r.next_due_date, r.next_due_date - v_today),
        p_now
      ) is not null then
        n := n + 1;
      end if;
    end loop;

    for r in
      select m.user_id, string_agg(c.title, ', ' order by c.next_due, c.title) as titles
      from public.household_members m
      join public.chores c on c.household_id = m.household_id
      where not m.is_placeholder and c.active and c.next_due <= v_today
        and (c.assignment = 'anyone' or c.assignee_id = m.user_id)
      group by m.user_id
    loop
      if public.enqueue_notification(
        r.user_id, 'chores', 'מטלות', 'היום: ' || r.titles, '/chores', 'chores:' || v_today, p_now
      ) is not null then
        n := n + 1;
      end if;
    end loop;
  end if;

  if v_hour = 9 and extract(dow from v_local) = 5 then
    for r in
      select m.user_id,
        (
          select coalesce(sum(e.amount), 0) from public.expenses e
          where e.household_id = m.household_id and e.expense_date between v_today - 6 and v_today
        ) as spent,
        top.display_name as creditor,
        top.balance
      from public.household_members m
      left join lateral (
        select hm.display_name, mb.balance
        from public.member_balances mb
        join public.household_members hm on hm.household_id = mb.household_id and hm.user_id = mb.user_id
        where mb.household_id = m.household_id and mb.balance >= 0.01
        order by mb.balance desc
        limit 1
      ) top on true
      where not m.is_placeholder
    loop
      continue when r.spent = 0 and r.creditor is null;
      if public.enqueue_notification(
        r.user_id, 'weekly', 'סיכום שבועי',
        concat_ws(' · ',
          'השבוע הוצאתם ' || public.format_ils(r.spent),
          case when r.creditor is null then 'אין יתרה פתוחה'
            else format('יתרה לטובת %s %s', r.creditor, public.format_ils(r.balance)) end
        ),
        '/expenses',
        'weekly:' || v_today,
        p_now
      ) is not null then
        n := n + 1;
      end if;
    end loop;
  end if;

  return n;
end;
$$;

-- Grants ------------------------------------------------------------------------

revoke execute on function
  public.format_ils(numeric),
  public.after_quiet_hours(timestamptz),
  public.enqueue_notification(uuid, text, text, text, text, text, timestamptz),
  public.notify_members(uuid, uuid, text, text, text, text, text),
  public.request_push_send(),
  public.outbox_request_send(),
  public.claim_push_batch(int),
  public.finish_push_batch(jsonb, text[], text[]),
  public.notify_expense(),
  public.notify_settlement(),
  public.notify_trip(),
  public.notify_ingest_run(),
  public.queue_scheduled_notifications(timestamptz),
  public.save_push_subscription(text, text, text, text),
  public.send_test_notification()
  from public, anon, authenticated;
revoke execute on function public.auto_pay_due_bills() from public, anon, authenticated;

grant execute on function
  public.save_push_subscription(text, text, text, text),
  public.send_test_notification()
  to authenticated;
grant execute on function
  public.claim_push_batch(int),
  public.finish_push_batch(jsonb, text[], text[])
  to service_role;

-- Extensions and schedules (Supabase only) ----------------------------------------

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    begin
      create extension if not exists pg_net with schema extensions;
    exception when others then
      create extension if not exists pg_net;
    end;
  end if;
exception when others then
  raise notice 'pg_net not enabled: %', sqlerrm;
end;
$$;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('queue-notifications', '1 * * * *', 'select public.queue_scheduled_notifications()');
    perform cron.schedule('send-push', '*/10 * * * *', 'select public.request_push_send()');
  end if;
exception when others then
  raise notice 'pg_cron not scheduled: %', sqlerrm;
end;
$$;
