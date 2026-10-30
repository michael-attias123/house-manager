-- Departments the household chose by hand, per item name. The shopping list
-- files a new item under the department it was moved to last time, and the
-- name also teaches the guesser (features/shopping/lib/classify.ts): after
-- "פסטו" is moved to the pantry, "פסטו גנובזה" goes there too.
--
-- normalized_name is the classifier's key (categoryKey() in classify.ts):
-- normalized words with final letters folded, so "פסטו", "פסטו." and
-- " פסטו " are one entry.
create table public.item_categories (
  household_id uuid not null references public.households (id) on delete cascade,
  normalized_name text not null check (normalized_name <> ''),
  category text not null,
  updated_at timestamptz not null default now(),
  primary key (household_id, normalized_name)
);

alter table public.item_categories enable row level security;

create policy "members manage item categories" on public.item_categories
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

grant select, insert, update, delete on public.item_categories to authenticated;
grant all on public.item_categories to service_role;

-- The partner's phone picks up a correction at once.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.item_categories;
  end if;
end;
$$;
