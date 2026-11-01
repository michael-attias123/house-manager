-- No security definer function in public is executable by PUBLIC.
--
-- Postgres lets PUBLIC (every role) execute a new function unless it is
-- revoked. Until grafana_reader (20261106000100_monitoring.sql) every role
-- that could log in was an API role with its own grants, so seven early
-- functions kept that default. They run as their owner, so they are revoked
-- from PUBLIC and granted only to the roles that call them:
--
--   is_member              RLS policies (all "to authenticated") and RPCs call
--                          it as the querying role: authenticated.
--   create_household,      RPCs of the signed-in app (web/src); sign-in itself
--   join_household,        is Google OAuth and calls no RPC, so anon needs
--   regenerate_invite_code, none of them: authenticated.
--   add_placeholder_member
--   check_allowed_email    Trigger functions (auth.users, households). A trigger
--   create_default_list    fires without an EXECUTE check, and nothing calls
--                          them directly: no role.
--
-- service_role is left as it was (it bypasses RLS and holds every table).
--
-- Functions that are not security definer run with the caller's rights, so
-- a role without table grants gets nothing from them; they keep PUBLIC.
--
-- New functions the owner creates are no longer executable by PUBLIC either.
-- Migrations already grant every RPC explicitly (Supabase's own default
-- privileges also grant anon, authenticated and service_role on the hosted
-- project); a plain Postgres database (CI) now needs those grants too.

revoke execute on function
  public.is_member(uuid),
  public.create_household(text, text),
  public.join_household(text, text),
  public.regenerate_invite_code(uuid),
  public.add_placeholder_member(uuid, text)
  from public, anon;
grant execute on function
  public.is_member(uuid),
  public.create_household(text, text),
  public.join_household(text, text),
  public.regenerate_invite_code(uuid),
  public.add_placeholder_member(uuid, text)
  to authenticated;

revoke execute on function
  public.check_allowed_email(),
  public.create_default_list()
  from public, anon, authenticated;

-- Without "in schema": a per-schema default cannot take away the built-in
-- PUBLIC grant.
alter default privileges for role postgres revoke execute on functions from public;
