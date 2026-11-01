-- Monitoring: aggregate views for Grafana's PostgreSQL data source (uid
-- hm-postgres), which logs in as grafana_reader. Dashboards and alerts in
-- observability/ query only these views.
--
-- grafana_reader may read the views in schema monitoring and nothing else.
-- It is created without login or password; infra/scripts/sync-db-roles.sh
-- turns on login and sets the password (a SCRAM verifier) from the secrets
-- module, so no credential is in git.
--
-- The views are owned by postgres and run with its rights, so the role
-- needs no grant on the tables behind them. They return aggregates and
-- fixed enums only: no titles, bodies, error text, names, user or household
-- ids. last_error is read only as a category (expired or not).
--
-- The schema is not in the API's exposed schemas (supabase/config.toml), and
-- no API role may use it.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'grafana_reader') then
    create role grafana_reader nologin noinherit;
  end if;
end;
$$;

alter role grafana_reader noinherit connection limit 3;
alter role grafana_reader set statement_timeout = '5s';
alter role grafana_reader set default_transaction_read_only = on;

create schema if not exists monitoring;
revoke all on schema monitoring from public, anon, authenticated, service_role;

-- Price updates ---------------------------------------------------------------

create or replace view monitoring.ingest_runs as
select
  r.id,
  r.started_at,
  r.finished_at,
  r.status,
  extract(epoch from r.finished_at - r.started_at)::double precision as duration_s
from public.ingest_runs r;

-- One row per chain per run, from ingest_runs.stats:
-- {"<chain>": {"error"?: ..., "seconds"?: n, "stores": {"<code>": {"items"?: n, "error"?: ...}}}}.
-- Only keys shaped like a chain id are read, so no other text gets through.
create or replace view monitoring.ingest_chain_runs as
select
  r.id as run_id,
  r.finished_at,
  c.key as chain_id,
  (select count(*) from jsonb_each(s.stores))::int as stores,
  (
    select count(*) from jsonb_each(s.stores) st
    where jsonb_typeof(st.value) = 'object' and st.value ? 'error'
  )::int as stores_failed,
  (
    select coalesce(sum((st.value ->> 'items')::bigint), 0) from jsonb_each(s.stores) st
    where jsonb_typeof(st.value -> 'items') = 'number' and st.value ->> 'items' ~ '^\d{1,15}$'
  )::bigint as items,
  c.value ? 'error' as chain_error,
  -- Time spent on the chain; null for runs from before the ingest wrote it.
  case when jsonb_typeof(c.value -> 'seconds') = 'number' then (c.value ->> 'seconds')::numeric end as seconds
from public.ingest_runs r
cross join lateral jsonb_each(case when jsonb_typeof(r.stats) = 'object' then r.stats else '{}'::jsonb end) c
cross join lateral (
  select case when jsonb_typeof(c.value -> 'stores') = 'object' then c.value -> 'stores' else '{}'::jsonb end as stores
) s
where jsonb_typeof(c.value) = 'object' and c.key ~ '^[a-z0-9_-]{1,40}$';

-- Notifications -----------------------------------------------------------------
-- Rows stay 30 days (queue_scheduled_notifications). Latency counts from when
-- a row was due: quiet hours move send_after, and a held row is not late.

create or replace view monitoring.outbox_hourly as
select
  date_trunc('hour', o.created_at) as hour,
  o.kind,
  count(*) as queued,
  count(o.sent_at) as sent,
  count(*) filter (where o.sent_at is null and o.attempts >= 5 and o.last_error is distinct from 'expired') as gave_up,
  count(*) filter (where o.sent_at is null and o.last_error = 'expired') as expired,
  percentile_cont(0.5) within group (
    order by extract(epoch from o.sent_at - greatest(o.send_after, o.created_at))::double precision
  ) as p50_latency_s,
  percentile_cont(0.95) within group (
    order by extract(epoch from o.sent_at - greatest(o.send_after, o.created_at))::double precision
  ) as p95_latency_s
from public.notification_outbox o
group by 1, 2;

-- One row. "Due" is what claim_push_batch would take now; rows held for
-- quiet hours are not due. A device without a success counts from when it
-- was saved, so a new one is not reported.
create or replace view monitoring.outbox_now as
select
  (
    select count(*) from public.notification_outbox
    where sent_at is null and attempts < 5 and send_after <= now()
  ) as due_pending,
  (
    select coalesce(extract(epoch from now() - min(greatest(send_after, created_at))), 0)::double precision
    from public.notification_outbox
    where sent_at is null and attempts < 5 and send_after <= now()
  ) as oldest_due_age_s,
  (
    select count(*) from public.notification_outbox
    where sent_at is null and attempts >= 5 and last_error is distinct from 'expired'
      and send_after > now() - interval '24 hours'
  ) as gave_up_24h,
  (select count(*) from public.push_subscriptions) as devices,
  (
    select count(*) from public.push_subscriptions
    where coalesce(last_success_at, created_at) < now() - interval '30 days'
  ) as devices_without_success_30d;

-- Storage ---------------------------------------------------------------------------
-- The 15 largest tables in any schema (the Free plan caps the database at 500 MB).

create or replace view monitoring.table_sizes as
select
  format('%s.%s', n.nspname, c.relname) as table_name,
  pg_total_relation_size(c.oid) as total_bytes
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where c.relkind in ('r', 'm')
  and n.nspname not in ('pg_catalog', 'information_schema', 'pg_toast')
  and n.nspname not like 'pg_temp_%'
  and n.nspname not like 'pg_toast_temp_%'
order by total_bytes desc, table_name
limit 15;

-- Grants ------------------------------------------------------------------------------

alter view monitoring.ingest_runs owner to postgres;
alter view monitoring.ingest_chain_runs owner to postgres;
alter view monitoring.outbox_hourly owner to postgres;
alter view monitoring.outbox_now owner to postgres;
alter view monitoring.table_sizes owner to postgres;

-- Revoked first, for projects whose default privileges grant new relations.
revoke all on all tables in schema monitoring from public, anon, authenticated, service_role;
grant usage on schema monitoring to grafana_reader;
grant select on
  monitoring.ingest_runs,
  monitoring.ingest_chain_runs,
  monitoring.outbox_hourly,
  monitoring.outbox_now,
  monitoring.table_sizes
  to grafana_reader;
