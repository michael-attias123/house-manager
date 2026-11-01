-- Trace links across the outbox: the W3C traceparent of the API request that
-- queued a notification is kept with it, and send-push links its run to it
-- (supabase/functions/_shared/otel.ts). The chain becomes: a browser saves
-- an expense, then the push run, then the push service.
--
-- trace_parent holds only ids (version, trace id, span id, flags). Rows
-- queued outside an API request (pg_cron, CI, triggers from the ingest) have
-- none.

alter table public.notification_outbox
  add column if not exists trace_parent text
    constraint notification_outbox_trace_parent_check
    check (trace_parent ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$');

-- The current API request's traceparent header (PostgREST puts the request
-- headers, lower-cased, in request.headers), or null when there is none or it
-- is not a valid W3C traceparent. Never raises.
create or replace function public.request_traceparent()
returns text
language plpgsql
stable
set search_path = public
as $$
declare
  v text;
begin
  v := lower(trim(nullif(current_setting('request.headers', true), '')::json ->> 'traceparent'));
  if v ~ '^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$'
     and left(v, 2) <> 'ff'
     and substr(v, 4, 32) <> repeat('0', 32)
     and substr(v, 37, 16) <> repeat('0', 16) then
    return v;
  end if;
  return null;
exception when others then
  return null;
end;
$$;

revoke execute on function public.request_traceparent() from public, anon, authenticated;

-- enqueue_notification (20261101000100_going_out.sql), unchanged but for
-- trace_parent.
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
  if p_kind not in ('bills', 'chores', 'partner', 'weekly', 'admin', 'going_out', 'test') then
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
      when 'going_out' then p.going_out
    end
    into v_on
    from public.notification_prefs p
    where p.user_id = p_user_id;
  end if;
  if not coalesce(v_on, false) then
    return null;
  end if;

  insert into public.notification_outbox (user_id, kind, title, body, url, dedup_key, send_after, trace_parent)
  values (
    p_user_id, p_kind, p_title, coalesce(p_body, ''), coalesce(p_url, '/'), p_dedup_key,
    case when p_kind = 'test' then p_now else public.after_quiet_hours(p_now) end,
    public.request_traceparent()
  )
  on conflict (user_id, dedup_key) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- claim_push_batch (20261022000100_notifications.sql), unchanged but for
-- trace_parent in each claimed row.
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
      'trace_parent', c.trace_parent,
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
