-- Chores: recurring household tasks with fixed, rotating or open assignment.
-- Next due date and rotation are computed by the client
-- (web/src/lib/recurrence.ts) when a chore is completed.

create table public.chores (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  emoji text,
  recurrence text not null default 'weekly'
    check (recurrence in ('once', 'daily', 'weekly', 'every_n_days', 'monthly')),
  -- every_n_days only.
  interval_days int check (interval_days is null or interval_days > 0),
  -- weekly only; 0 = Sunday ... 6 = Saturday.
  weekdays smallint[],
  assignment text not null default 'anyone' check (assignment in ('fixed', 'rotate', 'anyone')),
  assignee_id uuid references auth.users (id) on delete set null,
  next_due date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index chores_household_idx on public.chores (household_id, next_due);

create trigger chores_updated_at before update on public.chores
  for each row execute function public.set_updated_at();

create table public.chore_completions (
  id uuid primary key default gen_random_uuid(),
  chore_id uuid not null references public.chores (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  done_by uuid not null references auth.users (id) default auth.uid(),
  done_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index chore_completions_household_idx on public.chore_completions (household_id, done_on desc);

alter table public.chores enable row level security;
alter table public.chore_completions enable row level security;

create policy "members manage chores" on public.chores
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));
create policy "members manage chore completions" on public.chore_completions
  for all to authenticated
  using (public.is_member(household_id)) with check (public.is_member(household_id));

grant select, insert, update, delete on public.chores, public.chore_completions to authenticated;
grant all on public.chores, public.chore_completions to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.chores;
  end if;
end;
$$;
