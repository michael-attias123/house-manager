-- OpenTofu state for infra/ (the pg backend in infra/backend.tf), kept in
-- this database so no other storage account is needed. The state is
-- encrypted by OpenTofu before it is written (infra/encryption.tf): this
-- table only ever holds ciphertext.
--
-- tofu_state is a role of its own with access to this one table and nothing
-- else. It is created without a password; the owner sets one once in the SQL
-- editor (infra/BOOTSTRAP.md), so no credential is in git.
--
-- The schema is not in the API's exposed schemas, and no API role may use it.
-- The table is created here, not by the backend: the backend would also
-- create a sequence in public, which this role may not do.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'tofu_state') then
    create role tofu_state nologin noinherit;
  end if;
end;
$$;

create schema if not exists tofu_state;
revoke all on schema tofu_state from public, anon, authenticated, service_role;
grant usage on schema tofu_state to tofu_state;

-- The layout the backend expects (internal/backend/remote-state/pg).
create table if not exists tofu_state.states (
  id bigint generated always as identity primary key,
  name text unique,
  data text
);
create unique index if not exists states_by_name on tofu_state.states (name);

revoke all on tofu_state.states from public, anon, authenticated, service_role;
grant select, insert, update, delete on tofu_state.states to tofu_state;
