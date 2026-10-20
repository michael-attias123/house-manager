-- Who may create an account. Sign-in is Google only, and Google's "Test
-- users" stop restricting anyone once the Google app is published, so the
-- database checks every new auth.users row against this list itself.
-- Addresses are added by hand in the SQL editor (docs/setup.md). An empty
-- list lets everyone in, so a fresh project is not locked out before the
-- owner adds the first address.

create table public.allowed_emails (
  email text primary key check (email = lower(trim(email))),
  note text,
  added_at timestamptz not null default now()
);

-- No policies: clients can neither read nor change the list. (Revoked as
-- well, for projects whose default privileges still grant new tables.)
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon, authenticated;
grant all on public.allowed_emails to service_role;

-- security definer: Supabase Auth inserts users as its own role, which has
-- no access to public.allowed_emails.
create or replace function public.check_allowed_email()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.allowed_emails)
     and not exists (select 1 from public.allowed_emails where email = lower(new.email)) then
    raise exception 'email not allowed: %', new.email
      using hint = 'Add the address to public.allowed_emails (docs/setup.md).';
  end if;
  return new;
end;
$$;

-- Supabase Auth reports the failed insert to the app as "Database error
-- saving new user"; LoginPage shows a message for it.
create trigger check_allowed_email
  before insert on auth.users
  for each row execute function public.check_allowed_email();
