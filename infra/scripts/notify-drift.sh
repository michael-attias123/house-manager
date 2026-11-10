#!/usr/bin/env bash
# infra.yml's post-drift hook (shared-platform tofu-stack.yml): when the drift
# check found a difference, one push to the app's admins per ISO week (the
# dedup key), next to the infra-drift issue tofu-stack opened or updated.
# Env: DRIFT_EXITCODE (0, 2 or skip), SUPABASE_DB_URL (from the shared Vault).
set -euo pipefail

[[ "${DRIFT_EXITCODE:-}" == 2 ]] || exit 0
if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "::notice::No SUPABASE_DB_URL from Vault: the admins are not notified in the app."
  exit 0
fi
url="$(printf %s "$SUPABASE_DB_URL" | tr -d '\r\n')"
PGCLIENTENCODING=UTF8 psql "$url" -X -q -At -v ON_ERROR_STOP=1 -v dedup="drift:$(date -u +%G-W%V)" <<'SQL'
select 'admins notified: ' || public.notify_admins(
  'התשתית השתנתה מחוץ לקוד',
  'יש הבדל בין הקוד לבין מה שמוגדר בפועל. הפרטים ב-GitHub',
  '/admin',
  :'dedup'
);
SQL
