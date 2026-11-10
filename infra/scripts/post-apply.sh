#!/usr/bin/env bash
# infra.yml's post-apply hook (shared-platform tofu-stack.yml): after every
# apply-mode run that reached the providers, in infra/.
#   1. the Supabase Vault values (sync-vault.sh) and the database role
#      passwords (sync-db-roles.sh), every time: both are idempotent, and a
#      failed earlier sync gets another go;
#   2. last, a Pages production build when this apply changed its build
#      variables (pages-rebuild.sh): Vite inlines VITE_* at build time.
# Env from tofu-stack: PLAN_CHANGED, PLAN_JSON (the applied plan), and the
# Vault values (SUPABASE_DB_URL, PUSH_SECRET, GRAFANA_READER_PASSWORD,
# CLOUDFLARE_API_TOKEN).
set -euo pipefail
cd "$(dirname "$0")/.."

changed=false
if [[ "${PLAN_CHANGED:-false}" == true && -s "${PLAN_JSON:-}" ]]; then
  changed="$(./scripts/pages-rebuild.sh changed "$PLAN_JSON")"
fi
echo "Pages build variables change: $changed"

./scripts/sync-vault.sh
./scripts/sync-db-roles.sh

if [[ "$changed" == true ]]; then
  project="$(tofu output -json pages_project)"
  CF_ACCOUNT_ID="$(jq -r .account_id <<<"$project")" \
    PAGES_PROJECT="$(jq -r .project_name <<<"$project")" \
    PRODUCTION_BRANCH="$(jq -r .production_branch <<<"$project")" \
    ./scripts/pages-rebuild.sh rebuild
fi
