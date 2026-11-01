-- notify_admins_from_alert(): a Grafana alert as an admin notification.
-- Called by the alert-hook Edge Function (supabase/functions/alert-hook) with
-- the service role, after it has checked the webhook's HMAC signature.
--
-- It wraps notify_admins() (20261027000100_notify_admins.sql), which stays
-- closed to the service role: this function only accepts dedup keys in its
-- own namespace (alert:<fingerprint>:<startsAt>:<status>), so it cannot
-- swallow another source's notification by taking its key first. The usual
-- rules apply: kind admin, the admin pref, quiet hours, one per dedup key.
create or replace function public.notify_admins_from_alert(
  p_title text,
  p_body text,
  p_dedup text
)
returns int
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(p_dedup, '') !~ '^alert:[A-Za-z0-9:._+-]{1,200}$' then
    raise exception 'dedup key must start with alert:' using errcode = '22023';
  end if;
  if coalesce(trim(p_title), '') = '' then
    raise exception 'title and dedup key are required' using errcode = '22023';
  end if;
  return public.notify_admins(left(trim(p_title), 120), left(coalesce(p_body, ''), 300), '/admin', p_dedup);
end;
$$;

revoke all on function public.notify_admins_from_alert(text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.notify_admins_from_alert(text, text, text) to service_role;
