#!/usr/bin/env bash
# Gives the database role grafana_reader its login and password, for the
# Grafana data source hm-postgres (modules/observability). The role itself,
# nologin and read-only, comes from supabase/migrations/*_monitoring.sql.
#   grafana_reader_password  GRAFANA_READER_PASSWORD (in CI from the shared Vault,
#                            kv/house-manager/monitoring), else infra/secrets.enc.yaml (SOPS)
# Run by .github/workflows/infra.yml after `tofu apply` and sync-vault.sh;
# safe to run again.
#
# A no-op (exit 0) while observability_enabled is false in prod.auto.tfvars,
# or while the secret is not set. A missing role (the migration has not run
# yet) is a warning, not a failure.
#
# The password is never sent: python3 scripts/scram-verifier.py turns it into
# a SCRAM-SHA-256 verifier, and only that goes into ALTER ROLE, so the
# plaintext cannot end up in Postgres logs. The verifier travels in psql's
# environment and is read with \getenv: never in the SQL text, the command
# line or the output.
#
# Needs: psql and python3; sops with SOPS_AGE_KEY only when a value has to come
# from the secrets file. The database is SUPABASE_DB_URL, or supabase_db_url
# from the secrets file when that is unset.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SECRETS_FILE="$INFRA_DIR/secrets.enc.yaml"
TFVARS="$INFRA_DIR/prod.auto.tfvars"

die() {
  echo "sync-db-roles: $*" >&2
  exit 1
}
note() {
  echo "sync-db-roles: $*"
}

enabled="$(sed -n 's/^observability_enabled *= *\(true\|false\).*/\1/p' "$TFVARS")"
if [[ "$enabled" != true ]]; then
  note "observability_enabled is not true in prod.auto.tfvars; nothing to do."
  exit 0
fi

command -v psql >/dev/null || die "psql is not installed"
command -v python3 >/dev/null || die "python3 is not installed"

secret_from_file() {
  command -v sops >/dev/null || die "sops is not installed (or set $2)"
  [[ -f "$SECRETS_FILE" ]] || die "$SECRETS_FILE does not exist (or set $2)"
  sops -d --extract "[\"$1\"]" "$SECRETS_FILE" 2>/dev/null
}

# A missing key is not an error here: checks.tf already fails the plan for it.
if [[ -n "${GRAFANA_READER_PASSWORD:-}" ]]; then
  password="$GRAFANA_READER_PASSWORD"
elif ! password="$(secret_from_file grafana_reader_password GRAFANA_READER_PASSWORD)" || [[ -z "$password" ]]; then
  note "grafana_reader_password is not set; nothing to do."
  exit 0
fi
[[ "$password" =~ ^[A-Za-z0-9]{24,}$ ]] || die "grafana_reader_password must be at least 24 letters and digits"

if [[ -n "${SUPABASE_DB_URL:-}" ]]; then
  db_url="$SUPABASE_DB_URL"
else
  db_url="$(secret_from_file supabase_db_url SUPABASE_DB_URL)"
fi
db_url="$(printf %s "$db_url" | tr -d '\r\n')"
[[ -n "$db_url" ]] || die "no database URL (SUPABASE_DB_URL or supabase_db_url)"

verifier="$(printf %s "$password" | python3 "$INFRA_DIR/scripts/scram-verifier.py")"
password=
[[ "$verifier" == SCRAM-SHA-256\$* ]] || die "could not compute the SCRAM verifier"

SYNC_VERIFIER="$verifier" psql "$db_url" -X -q -v ON_ERROR_STOP=1 -At <<'SQL'
\getenv verifier SYNC_VERIFIER
select exists (select 1 from pg_roles where rolname = 'grafana_reader') as has_role \gset
\if :has_role
\o /dev/null
alter role grafana_reader with login password :'verifier';
\o
select 'sync-db-roles: grafana_reader can log in (password set as a SCRAM verifier)';
\else
select '::warning::sync-db-roles: role grafana_reader does not exist yet; run the monitoring migration first (Database migrations workflow), then re-run this workflow.';
\endif
SQL
