-- notify_admins(): an admin notification from outside the app, for every
-- account in app_admins (with the "admin" pref on and a device), like
-- notify_ingest_run() does for failed price updates. The caller picks the
-- dedup key, so a repeated run (a weekly check run twice) notifies once.
--
-- Called by CI over SUPABASE_DB_URL, which connects as the owner (postgres):
-- the infrastructure drift check in .github/workflows/infra.yml. Nobody else
-- may run it, service_role included.
create or replace function public.notify_admins(
  p_title text,
  p_body text,
  p_url text,
  p_dedup text
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
  if coalesce(p_title, '') = '' or coalesce(p_dedup, '') = '' then
    raise exception 'title and dedup key are required' using errcode = '22023';
  end if;
  for r in select user_id from public.app_admins loop
    if public.enqueue_notification(r.user_id, 'admin', p_title, p_body, coalesce(p_url, '/admin'), p_dedup) is not null then
      n := n + 1;
    end if;
  end loop;
  return n;
end;
$$;

revoke all on function public.notify_admins(text, text, text, text)
  from public, anon, authenticated, service_role;
