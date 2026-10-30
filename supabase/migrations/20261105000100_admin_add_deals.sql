-- "לאן יוצאים": an admin adds deals for everyone in one go, approved as they
-- go in (the app's "ייבוא דילים", read from screenshots by an AI chat). A
-- household's import stays a pending suggestion, through the usual insert.
--
-- p_deals: a JSON array of deals with the venue_deals columns venue_id,
-- title, kind, weekdays, starts_at, ends_at, valid_from, valid_until, note.
-- All or nothing; every place must be approved. Returns how many were added.
create or replace function public.admin_add_deals(p_deals jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if jsonb_typeof(p_deals) is distinct from 'array' then
    raise exception 'deals must be a list' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_deals) d
    where not exists (
      select 1 from public.venues v
      where v.id = (d ->> 'venue_id')::bigint and v.status = 'approved' and not v.hidden
    )
  ) then
    raise exception 'venue not approved' using errcode = '22023';
  end if;
  insert into public.venue_deals
    (venue_id, household_id, created_by, title, kind, weekdays, starts_at, ends_at, valid_from, valid_until, note,
     status, reviewed_by, reviewed_at)
  select
    (d ->> 'venue_id')::bigint, null, auth.uid(), trim(d ->> 'title'), d ->> 'kind',
    coalesce((select array_agg(x::smallint order by x::smallint) from jsonb_array_elements_text(d -> 'weekdays') x), '{}'),
    (d ->> 'starts_at')::time, (d ->> 'ends_at')::time, (d ->> 'valid_from')::date, (d ->> 'valid_until')::date,
    nullif(trim(d ->> 'note'), ''),
    'approved', auth.uid(), now()
  from jsonb_array_elements(p_deals) d;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function public.admin_add_deals(jsonb) from public, anon;
grant execute on function public.admin_add_deals(jsonb) to authenticated;
