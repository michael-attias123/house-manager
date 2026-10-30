-- Going out ("לאן יוצאים", web/src/features/going-out): places to go out in
-- Be'er Sheva and their deals (happy hours, special days, one-off events).
--
-- venues is a catalog, like stores: places from OpenStreetMap, loaded weekly
-- by ingest/house_ingest/venues.py over SUPABASE_DB_URL (household_id null,
-- approved), plus places a household added (source 'community'). Deals are
-- written by members. A household sees its own suggestions at once, pending
-- or rejected; everyone sees them once an admin approves them. Status and
-- review columns change only in the admin_* RPCs, except that editing a
-- rejected suggestion sends it back for review. Admins can also edit,
-- delete and hide (admin_update_*, admin_delete_deal, admin_hide_venue);
-- the ingest keeps what an admin changed.

-- Tables ----------------------------------------------------------------------

create table public.venues (
  id bigint generated always as identity primary key,
  -- 'node/123', 'way/45'; null for a place a household added.
  osm_ref text unique,
  -- OSM name:he, else name.
  name text not null check (trim(name) <> ''),
  kind text not null check (kind in ('bar', 'pub', 'restaurant', 'cafe', 'nightclub', 'other')),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  address text,
  -- The OSM string as is; the client parses it.
  opening_hours text,
  website text,
  phone text,
  instagram text,
  cuisine text,
  source text not null check (source in ('osm', 'community')),
  -- Null = global. Set = a household's suggestion, pending or rejected.
  household_id uuid references public.households (id) on delete cascade,
  created_by uuid default auth.uid(),
  status text not null default 'approved' check (status in ('approved', 'pending', 'rejected')),
  -- No longer in OSM, or hidden by an admin. Its deals stay linked.
  hidden boolean not null default false,
  -- Hidden by an admin (admin_hide_venue): the ingest never shows it again.
  hidden_by_admin boolean not null default false,
  review_note text,
  -- The household that suggested it (set on insert). Unlike household_id it
  -- stays after approval, so the household can list its approved places.
  suggested_household_id uuid references public.households (id) on delete set null,
  -- Set by admin_update_venue: the ingest keeps the admin's values.
  admin_edited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((household_id is null) = (status = 'approved')),
  check ((source = 'osm') = (osm_ref is not null)),
  check (source = 'community' or status = 'approved'),
  check ((lat is null) = (lng is null)),
  check (hidden or not hidden_by_admin)
);

create index venues_status_hidden_idx on public.venues (status, hidden);
create index venues_household_idx on public.venues (household_id) where household_id is not null;
create index venues_suggested_household_idx on public.venues (suggested_household_id)
  where suggested_household_id is not null;

create trigger venues_updated_at before update on public.venues
  for each row execute function public.set_updated_at();

-- Always the inserting household, so a client cannot credit another one.
create or replace function public.set_suggested_household()
returns trigger
language plpgsql
as $$
begin
  new.suggested_household_id := new.household_id;
  return new;
end;
$$;

create trigger venues_suggested_household before insert on public.venues
  for each row execute function public.set_suggested_household();

create table public.venue_deals (
  id uuid primary key default gen_random_uuid(),
  venue_id bigint not null references public.venues (id) on delete cascade,
  -- The household that suggested it. Null only for an approved deal whose
  -- household was deleted (keep_approved_deals below).
  household_id uuid references public.households (id) on delete cascade,
  created_by uuid default auth.uid(),
  title text not null check (char_length(title) between 2 and 60),
  kind text not null check (kind in ('happy_hour', 'special_day', 'event')),
  -- 0 = Sunday ... 6 = Saturday; empty = every day.
  weekdays smallint[] not null default '{}' check (weekdays <@ '{0,1,2,3,4,5,6}'),
  -- Both null = whenever the place is open; ends_at < starts_at crosses midnight.
  starts_at time,
  ends_at time,
  -- A one-off event: both on the same day.
  valid_from date,
  valid_until date,
  note text check (char_length(note) <= 200),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid,
  reviewed_at timestamptz,
  review_note text,
  -- "Still on?" (confirm_deal).
  last_confirmed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (starts_at <> ends_at),
  check (valid_until >= valid_from),
  check (household_id is not null or status = 'approved')
);

create index venue_deals_venue_idx on public.venue_deals (venue_id);
create index venue_deals_household_idx on public.venue_deals (household_id);
create index venue_deals_pending_idx on public.venue_deals (created_at) where status = 'pending';

-- Status and review columns change only inside the admin_* RPCs (and the
-- other functions here), never in a client's own update: clients run as
-- authenticated, functions as their owner. The catalog columns of a place
-- (source, osm_ref, hidden, suggested_household_id, admin_edited_at) belong
-- to the ingest and the admin RPCs. The trigger's arguments are the guarded
-- columns.
--
-- A client's edit of a rejected suggestion sends it back for review: status
-- pending, reviewed_* cleared, and review_note kept, so the household still
-- sees what the admin said last time (venues_notify_resubmit tells the
-- admins). An update that changes nothing but bookkeeping is not an edit.
create or replace function public.guard_review_columns()
returns trigger
language plpgsql
as $$
declare
  c text;
  bookkeeping constant text[] := '{updated_at,last_confirmed_at}';
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  foreach c in array tg_argv loop
    if to_jsonb(new) -> c is distinct from to_jsonb(old) -> c then
      raise exception 'only an admin review changes %.%', tg_table_name, c using errcode = '42501';
    end if;
  end loop;
  if old.status = 'rejected' and to_jsonb(new) - bookkeeping is distinct from to_jsonb(old) - bookkeeping then
    -- Keys a table lacks (reviewed_* on venues) are ignored.
    new := jsonb_populate_record(new, '{"status": "pending", "reviewed_by": null, "reviewed_at": null}');
  end if;
  return new;
end;
$$;

create trigger venues_guard before update on public.venues
  for each row execute function public.guard_review_columns(
    'status', 'review_note', 'source', 'osm_ref', 'hidden', 'hidden_by_admin', 'suggested_household_id', 'admin_edited_at'
  );
create trigger venue_deals_guard before update on public.venue_deals
  for each row execute function public.guard_review_columns('status', 'reviewed_by', 'reviewed_at', 'review_note');

-- An approved deal belongs to everyone, so it outlives the household that
-- suggested it: before the household goes (and its rows with it), its
-- approved deals let go of it. Pending and rejected ones cascade.
create or replace function public.keep_approved_deals()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.venue_deals set household_id = null
  where household_id = old.id and status = 'approved';
  return old;
end;
$$;

create trigger households_keep_approved_deals
  before delete on public.households
  for each row execute function public.keep_approved_deals();

-- Access ------------------------------------------------------------------------

alter table public.venues enable row level security;
alter table public.venue_deals enable row level security;

create policy "global places and own suggestions" on public.venues
  for select to authenticated
  using ((household_id is null and not hidden) or public.is_member(household_id));
create policy "members suggest places" on public.venues
  for insert to authenticated
  with check (
    source = 'community' and status = 'pending' and public.is_member(household_id) and created_by = auth.uid()
  );
-- A global place is not editable from the app.
create policy "members edit their suggested places" on public.venues
  for update to authenticated
  using (public.is_member(household_id) and status <> 'approved')
  with check (public.is_member(household_id) and status <> 'approved');
create policy "members delete their suggested places" on public.venues
  for delete to authenticated
  using (public.is_member(household_id) and status <> 'approved');

-- The venue subqueries run under the venues policies: a deal can only be on
-- a place the member can see.
create policy "approved deals and own suggestions" on public.venue_deals
  for select to authenticated
  using (status = 'approved' or public.is_member(household_id));
create policy "members suggest deals" on public.venue_deals
  for insert to authenticated
  with check (
    status = 'pending' and public.is_member(household_id) and created_by = auth.uid()
    and exists (select 1 from public.venues v where v.id = venue_deals.venue_id)
  );
create policy "members edit their suggested deals" on public.venue_deals
  for update to authenticated
  using (public.is_member(household_id) and status <> 'approved')
  with check (
    public.is_member(household_id) and status <> 'approved'
    and exists (select 1 from public.venues v where v.id = venue_deals.venue_id)
  );
create policy "members delete their suggested deals" on public.venue_deals
  for delete to authenticated
  using (public.is_member(household_id) and status <> 'approved');

-- Revoked first, for projects whose default privileges still grant new tables.
revoke all on public.venues, public.venue_deals from anon;
grant select, insert, update, delete on public.venues, public.venue_deals to authenticated;
grant all on public.venues, public.venue_deals to service_role;

-- The partner sees a new deal at once.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.venue_deals;
  end if;
end;
$$;

-- RPCs --------------------------------------------------------------------------

-- "Still on?": anyone who can see the deal. At most once per 12 hours, so a
-- second tap (or the partner's) changes nothing.
create or replace function public.confirm_deal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.venue_deals d
    where d.id = p_id and (d.status = 'approved' or public.is_member(d.household_id))
  ) then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  update public.venue_deals set last_confirmed_at = now()
  where id = p_id and last_confirmed_at < now() - interval '12 hours';
end;
$$;

-- Meters between two points (haversine), for spotting a duplicate place.
create or replace function public.geo_distance_m(lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2
    + cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lng2 - lng1) / 2) ^ 2
  )));
$$;

-- Pending deals and pending places, oldest first, with the suggesting
-- household. A place's row names an approved place that may be the same one
-- (same normalized name, or within 50 m) for the admin's "duplicate?" check.
create or replace function public.admin_list_suggestions()
returns table (
  item_type text,
  deal_id uuid,
  venue_id bigint,
  venue_name text,
  venue_kind text,
  venue_status text,
  venue_lat double precision,
  venue_lng double precision,
  venue_address text,
  title text,
  deal_kind text,
  weekdays smallint[],
  starts_at time,
  ends_at time,
  valid_from date,
  valid_until date,
  note text,
  household_id uuid,
  household_name text,
  created_at timestamptz,
  similar_venue_id bigint,
  similar_venue_name text,
  -- The rest of the place, so the admin's edit form starts from all of it
  -- (another household's pending place is not readable under RLS).
  venue_opening_hours text,
  venue_website text,
  venue_phone text,
  venue_instagram text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
  select s.* from (
    select
      'deal'::text as item_type, d.id as deal_id, v.id as venue_id, v.name as venue_name,
      v.kind as venue_kind, v.status as venue_status, v.lat as venue_lat, v.lng as venue_lng,
      v.address as venue_address, d.title, d.kind as deal_kind, d.weekdays, d.starts_at, d.ends_at,
      d.valid_from, d.valid_until, d.note, d.household_id, h.name as household_name, d.created_at,
      null::bigint as similar_venue_id, null::text as similar_venue_name,
      v.opening_hours as venue_opening_hours, v.website as venue_website, v.phone as venue_phone,
      v.instagram as venue_instagram
    from public.venue_deals d
    join public.venues v on v.id = d.venue_id
    left join public.households h on h.id = d.household_id
    where d.status = 'pending'
    union all
    select
      'venue', null, v.id, v.name, v.kind, v.status, v.lat, v.lng, v.address,
      null, null, null, null, null, null, null, null,
      v.household_id, h.name, v.created_at, sim.id, sim.name,
      v.opening_hours, v.website, v.phone, v.instagram
    from public.venues v
    left join public.households h on h.id = v.household_id
    left join lateral (
      select a.id, a.name
      from public.venues a
      where a.status = 'approved' and not a.hidden and a.id <> v.id
        and (
          public.norm_name(a.name) = public.norm_name(v.name)
          or public.geo_distance_m(v.lat, v.lng, a.lat, a.lng) <= 50
        )
      order by public.norm_name(a.name) = public.norm_name(v.name) desc,
        public.geo_distance_m(v.lat, v.lng, a.lat, a.lng) nulls last, a.id
      limit 1
    ) sim on true
    where v.status = 'pending'
  ) s
  order by s.created_at, s.item_type, s.venue_id;
end;
$$;

-- Approving needs the place approved first ('venue not approved'). Rejecting
-- an approved deal whose household is gone deletes it: nobody would see it.
create or replace function public.admin_review_deal(p_id uuid, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  d public.venue_deals;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'approve or reject' using errcode = '22023';
  end if;
  select * into d from public.venue_deals where id = p_id for update;
  if d.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if p_approve then
    if not exists (select 1 from public.venues where id = d.venue_id and status = 'approved') then
      raise exception 'venue not approved' using errcode = '22023';
    end if;
  elsif d.household_id is null then
    delete from public.venue_deals where id = p_id;
    return;
  end if;
  update public.venue_deals
  set status = case when p_approve then 'approved' else 'rejected' end,
      reviewed_by = auth.uid(),
      reviewed_at = now(),
      review_note = nullif(trim(p_note), '')
  where id = p_id;
end;
$$;

-- Approving makes the place global (household_id null). A rejected place
-- stays with its household, marked rejected.
create or replace function public.admin_review_venue(p_id bigint, p_approve boolean, p_note text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.venues;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'approve or reject' using errcode = '22023';
  end if;
  select * into v from public.venues where id = p_id for update;
  if v.id is null then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if v.status = 'approved' then
    if p_approve then
      return;
    end if;
    raise exception 'venue already approved' using errcode = '22023';
  end if;
  if p_approve then
    update public.venues set household_id = null, status = 'approved', review_note = nullif(trim(p_note), '')
    where id = p_id;
  else
    update public.venues set status = 'rejected', review_note = nullif(trim(p_note), '')
    where id = p_id;
  end if;
end;
$$;

-- A household's place that duplicates an approved one: its deals move to
-- p_into, and the suggestion is deleted. p_from is a pending or rejected
-- suggestion (an OSM place is always approved), else 'not found'.
create or replace function public.admin_merge_venue(p_from bigint, p_into bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  f public.venues;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  select * into f from public.venues where id = p_from for update;
  if f.id is null or f.status = 'approved' then
    raise exception 'not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.venues where id = p_into and status = 'approved') then
    raise exception 'venue not approved' using errcode = '22023';
  end if;
  update public.venue_deals set venue_id = p_into where venue_id = p_from;
  delete from public.venues where id = p_from;
end;
$$;

-- An admin's edit of any deal, whatever its status (which stays as it is).
create or replace function public.admin_update_deal(
  p_id uuid,
  p_title text,
  p_kind text,
  p_weekdays smallint[],
  p_starts_at time,
  p_ends_at time,
  p_valid_from date,
  p_valid_until date,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.venue_deals
  set title = trim(p_title),
      kind = p_kind,
      weekdays = coalesce(p_weekdays, '{}'),
      starts_at = p_starts_at,
      ends_at = p_ends_at,
      valid_from = p_valid_from,
      valid_until = p_valid_until,
      note = nullif(trim(p_note), '')
  where id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;

-- An admin's edit of any place, OSM ones included: admin_edited_at tells
-- the ingest to keep these values. Every column is written, so the caller
-- passes the ones it does not change as they are.
create or replace function public.admin_update_venue(
  p_id bigint,
  p_name text,
  p_kind text,
  p_address text,
  p_opening_hours text,
  p_website text,
  p_phone text,
  p_instagram text,
  p_lat double precision,
  p_lng double precision
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.venues
  set name = trim(p_name),
      kind = p_kind,
      address = nullif(trim(p_address), ''),
      opening_hours = nullif(trim(p_opening_hours), ''),
      website = nullif(trim(p_website), ''),
      phone = nullif(trim(p_phone), ''),
      instagram = nullif(trim(p_instagram), ''),
      lat = p_lat,
      lng = p_lng,
      admin_edited_at = now()
  where id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;

create or replace function public.admin_delete_deal(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.venue_deals where id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Hidden by an admin stays hidden: the ingest shows a place again when it
-- is back in OSM, but not this one. Showing it clears both.
create or replace function public.admin_hide_venue(p_id bigint, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_hidden is null then
    raise exception 'hide or show' using errcode = '22023';
  end if;
  update public.venues set hidden = p_hidden, hidden_by_admin = p_hidden where id = p_id;
  if not found then
    raise exception 'not found' using errcode = 'P0002';
  end if;
end;
$$;

-- Notifications -------------------------------------------------------------------
-- A new kind, going_out: a household hears when its suggestion was reviewed.
-- Admins hear about new suggestions under the existing admin kind.

alter table public.notification_prefs add column going_out boolean not null default false;

alter table public.notification_outbox
  drop constraint notification_outbox_kind_check,
  add constraint notification_outbox_kind_check
    check (kind in ('bills', 'chores', 'partner', 'weekly', 'admin', 'going_out', 'test'));

-- enqueue_notification (20261022000100_notifications.sql), unchanged but for
-- the new kind.
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

-- The dedup key of a review: p_key, or with the time added when a member of
-- the household still has p_key in the outbox (rows stay 30 days). That is
-- a second review after a resubmission, which would otherwise be dropped.
create or replace function public.going_out_review_key(p_household_id uuid, p_key text)
returns text
language sql
stable
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.notification_outbox o
      join public.household_members m on m.user_id = o.user_id
      where m.household_id = p_household_id and o.dedup_key = p_key
    ) then p_key || ':' || extract(epoch from now())::bigint
    else p_key
  end;
$$;

-- A new or resubmitted deal (for admins, except the one who wrote it), and a
-- review (for the suggesting household, except the reviewer). Like every
-- source, it never blocks the write it is about.
create or replace function public.notify_going_out_deal()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_place text;
  v_household text;
  v_resubmit boolean := tg_op = 'UPDATE' and new.status = 'pending';
  r record;
begin
  select name into v_place from public.venues where id = new.venue_id;
  if tg_op = 'INSERT' or v_resubmit then
    select name into v_household from public.households where id = new.household_id;
    for r in
      select user_id from public.app_admins
      where user_id is distinct from (case when v_resubmit then auth.uid() else new.created_by end)
    loop
      perform public.enqueue_notification(
        r.user_id, 'admin',
        case when v_resubmit then 'הצעה נשלחה שוב לאישור' else 'הצעה חדשה בלאן יוצאים' end,
        format('%s: %s, מבית %s', v_place, new.title, v_household),
        '/admin?tab=suggestions',
        case when v_resubmit
          then format('going-out:resubmit:deal:%s:%s', new.id, extract(epoch from now())::bigint)
          else 'going-out:new:deal:' || new.id
        end
      );
    end loop;
  elsif new.household_id is not null then
    perform public.notify_members(
      new.household_id, auth.uid(), 'going_out',
      case new.status when 'approved' then 'ההצעה אושרה' else 'ההצעה לא אושרה' end,
      case new.status
        when 'approved' then format('%s ב%s מופיע עכשיו לכולם', new.title, v_place)
        else concat_ws(': ', new.title, nullif(trim(new.review_note), ''))
      end,
      '/going-out/suggestions',
      public.going_out_review_key(new.household_id, format('going-out:%s:deal:%s', new.status, new.id))
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_going_out_deal: %', sqlerrm;
  return null;
end;
$$;

create trigger venue_deals_notify_new
  after insert on public.venue_deals
  for each row
  when (new.status = 'pending')
  execute function public.notify_going_out_deal();

create trigger venue_deals_notify_review
  after update of status on public.venue_deals
  for each row
  when (old.status is distinct from new.status and new.status <> 'pending')
  execute function public.notify_going_out_deal();

-- Not "update of status": the guard trigger sets it, and a column trigger
-- only sees the columns the UPDATE itself names.
create trigger venue_deals_notify_resubmit
  after update on public.venue_deals
  for each row
  when (old.status = 'rejected' and new.status = 'pending')
  execute function public.notify_going_out_deal();

-- The same for a place. Approving clears household_id, so the household is
-- taken from the row as it was.
create or replace function public.notify_going_out_venue()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_household text;
  v_resubmit boolean := tg_op = 'UPDATE' and new.status = 'pending';
  r record;
begin
  if tg_op = 'INSERT' or v_resubmit then
    select name into v_household from public.households where id = new.household_id;
    for r in
      select user_id from public.app_admins
      where user_id is distinct from (case when v_resubmit then auth.uid() else new.created_by end)
    loop
      perform public.enqueue_notification(
        r.user_id, 'admin',
        case when v_resubmit then 'הצעה נשלחה שוב לאישור' else 'הצעה חדשה בלאן יוצאים' end,
        format('%s: מקום חדש, מבית %s', new.name, v_household),
        '/admin?tab=suggestions',
        case when v_resubmit
          then format('going-out:resubmit:venue:%s:%s', new.id, extract(epoch from now())::bigint)
          else 'going-out:new:venue:' || new.id
        end
      );
    end loop;
  elsif old.household_id is not null then
    perform public.notify_members(
      old.household_id, auth.uid(), 'going_out',
      case new.status when 'approved' then 'ההצעה אושרה' else 'ההצעה לא אושרה' end,
      case new.status
        when 'approved' then format('%s מופיע עכשיו לכולם', new.name)
        else concat_ws(': ', new.name, nullif(trim(new.review_note), ''))
      end,
      '/going-out/suggestions',
      public.going_out_review_key(old.household_id, format('going-out:%s:venue:%s', new.status, new.id))
    );
  end if;
  return null;
exception when others then
  raise warning 'notify_going_out_venue: %', sqlerrm;
  return null;
end;
$$;

create trigger venues_notify_new
  after insert on public.venues
  for each row
  when (new.status = 'pending')
  execute function public.notify_going_out_venue();

create trigger venues_notify_review
  after update of status on public.venues
  for each row
  when (old.status is distinct from new.status and new.status <> 'pending')
  execute function public.notify_going_out_venue();

create trigger venues_notify_resubmit
  after update on public.venues
  for each row
  when (old.status = 'rejected' and new.status = 'pending')
  execute function public.notify_going_out_venue();

-- Member columns --------------------------------------------------------------------

-- move_member_refs (20261021000300_admin.sql), plus the going-out columns.
create or replace function public.move_member_refs(p_household_id uuid, p_from uuid, p_to uuid)
returns void
language plpgsql
set search_path = public
as $$
begin
  update public.expenses set paid_by = p_to where household_id = p_household_id and paid_by = p_from;
  update public.expense_shares set user_id = p_to where household_id = p_household_id and user_id = p_from;
  update public.settlements set from_user = p_to where household_id = p_household_id and from_user = p_from;
  update public.settlements set to_user = p_to where household_id = p_household_id and to_user = p_from;
  update public.bills set paid_by_default = p_to where household_id = p_household_id and paid_by_default = p_from;
  update public.bill_payments set paid_by = p_to where household_id = p_household_id and paid_by = p_from;
  update public.chores set assignee_id = p_to where household_id = p_household_id and assignee_id = p_from;
  update public.chore_completions set done_by = p_to where household_id = p_household_id and done_by = p_from;
  update public.venues set created_by = p_to where household_id = p_household_id and created_by = p_from;
  update public.venue_deals set created_by = p_to where household_id = p_household_id and created_by = p_from;
  update public.venue_deals set reviewed_by = p_to where household_id = p_household_id and reviewed_by = p_from;
end;
$$;

-- Grants ------------------------------------------------------------------------

revoke execute on function
  public.guard_review_columns(),
  public.set_suggested_household(),
  public.keep_approved_deals(),
  public.geo_distance_m(double precision, double precision, double precision, double precision),
  public.going_out_review_key(uuid, text),
  public.notify_going_out_deal(),
  public.notify_going_out_venue()
  from public, anon, authenticated;

revoke execute on function
  public.confirm_deal(uuid),
  public.admin_list_suggestions(),
  public.admin_review_deal(uuid, boolean, text),
  public.admin_review_venue(bigint, boolean, text),
  public.admin_merge_venue(bigint, bigint),
  public.admin_update_deal(uuid, text, text, smallint[], time, time, date, date, text),
  public.admin_update_venue(bigint, text, text, text, text, text, text, text, double precision, double precision),
  public.admin_delete_deal(uuid),
  public.admin_hide_venue(bigint, boolean)
  from public, anon;
grant execute on function
  public.confirm_deal(uuid),
  public.admin_list_suggestions(),
  public.admin_review_deal(uuid, boolean, text),
  public.admin_review_venue(bigint, boolean, text),
  public.admin_merge_venue(bigint, bigint),
  public.admin_update_deal(uuid, text, text, smallint[], time, time, date, date, text),
  public.admin_update_venue(bigint, text, text, text, text, text, text, text, double precision, double precision),
  public.admin_delete_deal(uuid),
  public.admin_hide_venue(bigint, boolean)
  to authenticated;
