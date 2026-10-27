#!/usr/bin/env bash
# Applies all migrations to a throwaway Postgres and runs supabase/tests/db_test.sql.
# Uses DATABASE_URL if set (CI); otherwise starts a temporary local cluster.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

if [[ -z "${DATABASE_URL:-}" ]]; then
  PG_BIN="${PG_BIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
  DATA_DIR="$(mktemp -d)"
  PORT="${PGPORT:-54329}"
  # pg_ctl refuses to run as root, so as root every pg_ctl call (the stop in the
  # trap included) goes through RUN. ${RUN[@]+...} keeps set -u happy on bash < 4.4.
  RUN=()
  trap '${RUN[@]+"${RUN[@]}"} "$PG_BIN/pg_ctl" -D "$DATA_DIR" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DATA_DIR"' EXIT
  if [[ "$(id -u)" == "0" ]]; then
    chown -R postgres "$DATA_DIR"
    RUN=(sudo -u postgres)
  fi
  ${RUN[@]+"${RUN[@]}"} "$PG_BIN/initdb" -D "$DATA_DIR" -U postgres --auth=trust >/dev/null
  ${RUN[@]+"${RUN[@]}"} "$PG_BIN/pg_ctl" -D "$DATA_DIR" -o "-p $PORT -k /tmp" -l "$DATA_DIR/log" start >/dev/null
  DATABASE_URL="postgresql://postgres@localhost:$PORT/postgres"
fi

"${PSQL[@]}" "$DATABASE_URL" -f "$ROOT/supabase/tests/local_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate: $(basename "$f")"
  "${PSQL[@]}" "$DATABASE_URL" -f "$f"
done
"${PSQL[@]}" "$DATABASE_URL" -f "$ROOT/supabase/tests/db_test.sql"

# infra/scripts/sync-vault.sh against a Vault stand-in: the first run creates
# both secrets, the second updates them. A quote in the value checks quoting.
echo "vault: sync-vault.sh"
"${PSQL[@]}" "$DATABASE_URL" -f "$ROOT/supabase/tests/vault_stub.sql"
SUPABASE_DB_URL="$DATABASE_URL" PUSH_FUNCTION_URL="https://first.example.com/functions/v1/send-push" \
  PUSH_SECRET="first-secret" "$ROOT/infra/scripts/sync-vault.sh" >/dev/null
SUPABASE_DB_URL="$DATABASE_URL" PUSH_FUNCTION_URL="https://ref.example.com/functions/v1/send-push" \
  PUSH_SECRET="it's-a-test; select 1" "$ROOT/infra/scripts/sync-vault.sh"
"${PSQL[@]}" "$DATABASE_URL" -v expected_url="https://ref.example.com/functions/v1/send-push" \
  -v expected_secret="it's-a-test; select 1" -f "$ROOT/supabase/tests/vault_sync_test.sql"

# Price ingestion against the same database, if its Python deps are available.
INGEST_PYTHON="${INGEST_PYTHON:-python3}"
if "$INGEST_PYTHON" -c "import psycopg, yaml, lxml, pytest" 2>/dev/null; then
  echo "ingest: pytest"
  TEST_DATABASE_URL="$DATABASE_URL" "$INGEST_PYTHON" -m pytest -q "$ROOT/ingest/tests"
else
  echo "ingest: skipped (pip install -r ingest/requirements-dev.txt to include it)"
fi
