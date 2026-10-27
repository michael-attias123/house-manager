#!/usr/bin/env bash
# Upserts the two Supabase Vault secrets the database needs to call the
# send-push Edge Function (request_push_send in
# supabase/migrations/20261022000100_notifications.sql):
#   push_function_url  from `tofu output -raw supabase_function_url`
#   push_secret        from infra/secrets.enc.yaml (SOPS)
# Run by .github/workflows/infra.yml after `tofu apply`; safe to run again.
#
# Needs: psql (15 or later), plus tofu with an initialized infra/ and sops
# with SOPS_AGE_KEY for the values. The database is SUPABASE_DB_URL, or
# supabase_db_url from the secrets file when that is unset.
# Tests (scripts/db-test.sh) pass PUSH_FUNCTION_URL and PUSH_SECRET instead.
#
# Values travel in the environment of psql only and are read there with
# \getenv into psql variables (:'var' quotes them): never part of the SQL
# text, the command line or the output.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_FILE="$INFRA_DIR/secrets.enc.yaml"

die() {
  echo "sync-vault: $*" >&2
  exit 1
}

secret_from_file() {
  command -v sops >/dev/null || die "sops is not installed"
  [[ -f "$SECRETS_FILE" ]] || die "$SECRETS_FILE does not exist"
  sops -d --extract "[\"$1\"]" "$SECRETS_FILE"
}

command -v psql >/dev/null || die "psql is not installed"

if [[ -n "${PUSH_FUNCTION_URL:-}" ]]; then
  function_url="$PUSH_FUNCTION_URL"
else
  command -v tofu >/dev/null || die "tofu is not installed"
  function_url="$(tofu -chdir="$INFRA_DIR" output -raw supabase_function_url)"
fi
if [[ -n "${PUSH_SECRET:-}" ]]; then
  push_secret="$PUSH_SECRET"
else
  push_secret="$(secret_from_file push_secret)"
fi
if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  db_url="$SUPABASE_DB_URL"
else
  db_url="$(secret_from_file supabase_db_url)"
fi
# A pasted value can carry a line break (price-probe.yml does the same).
db_url="$(printf %s "$db_url" | tr -d '\r\n')"

[[ "$function_url" == https://* ]] || die "supabase_function_url is not an https:// URL"
[[ -n "$push_secret" ]] || die "push_secret is empty"
[[ "$push_secret" != *$'\n'* ]] || die "push_secret has a line break"
[[ -n "$db_url" ]] || die "no database URL (SUPABASE_DB_URL or supabase_db_url)"

SYNC_PUSH_FUNCTION_URL="$function_url" SYNC_PUSH_SECRET="$push_secret" \
  psql "$db_url" -X -q -v ON_ERROR_STOP=1 -At <<'SQL'
\getenv push_function_url SYNC_PUSH_FUNCTION_URL
\getenv push_secret SYNC_PUSH_SECRET
\o /dev/null
-- One transaction (stdin ignores --single-transaction): both or neither.
begin;
select vault.update_secret(id, :'push_function_url') from vault.secrets where name = 'push_function_url';
select vault.create_secret(:'push_function_url', 'push_function_url', 'send-push Edge Function URL (infra/scripts/sync-vault.sh)')
where not exists (select 1 from vault.secrets where name = 'push_function_url');
select vault.update_secret(id, :'push_secret') from vault.secrets where name = 'push_secret';
select vault.create_secret(:'push_secret', 'push_secret', 'x-push-secret header for send-push (infra/scripts/sync-vault.sh)')
where not exists (select 1 from vault.secrets where name = 'push_secret');
commit;
\o
select 'sync-vault: ' || string_agg(name, ', ' order by name) || ' up to date'
from vault.secrets where name in ('push_function_url', 'push_secret');
SQL
