#!/usr/bin/env bash
# Tests for pages-rebuild.sh changed: which plans start a Pages rebuild.
set -euo pipefail
cd "$(dirname "$0")"
dir="$(mktemp -d)"
trap 'rm -rf "$dir"' EXIT
fail=0

# plan NAME ACTIONS BEFORE_ENV AFTER_ENV AFTER_UNKNOWN_ENV [ADDRESS]
plan() {
  cat > "$dir/$1.json" <<JSON
{"resource_changes": [
  {"address": "module.backend.supabase_settings.this", "change": {"actions": ["update"],
   "before": {"api": "a"}, "after": {"api": "b"}, "after_unknown": {}}},
  {"address": "${6:-module.hosting.cloudflare_pages_project.this}", "change": {"actions": $2,
   "before": {"deployment_configs": {"production": {"env_vars": $3}}, "build_config": {"build_command": "pnpm build", "web_analytics_tag": "t1"}},
   "after": {"deployment_configs": {"production": {"env_vars": $4}}, "build_config": {"build_command": "pnpm build"}},
   "after_unknown": {"deployment_configs": {"production": {"env_vars": $5}}, "build_config": {"web_analytics_tag": true}}}}
]}
JSON
}

expect() {
  local got
  got="$(./pages-rebuild.sh changed "$dir/$1.json")"
  if [[ "$got" == "$2" ]]; then echo "ok   $1 -> $got"; else echo "FAIL $1 -> $got, expected $2"; fail=1; fi
}

A='{"VITE_SUPABASE_URL": {"type": "plain_text", "value": "https://x"}}'
B='{"VITE_SUPABASE_URL": {"type": "plain_text", "value": "https://x"}, "VITE_FARO_URL": {"type": "plain_text", "value": "https://f"}}'

plan adds-faro '["update"]' "$A" "$B" '{}';                       expect adds-faro true
plan value-unknown '["update"]' "$A" "$A" '{"VITE_FARO_URL": {"value": true}}'; expect value-unknown true
plan all-unknown '["update"]' "$A" null 'true';                   expect all-unknown true
plan created '["create"]' null "$A" '{}';                         expect created true
plan build-noise-only '["update"]' "$A" "$A" '{}';                expect build-noise-only false
plan no-op '["no-op"]' "$A" "$A" '{}';                            expect no-op false
plan other-resource '["update"]' "$A" "$B" '{}' 'module.hosting.cloudflare_pages_domain.this'; expect other-resource false
sed 's/"after": {"deployment_configs": {"production": {"env_vars": \(.*\)}}, "build_config": {"build_command": "pnpm build"}}/"after": {"deployment_configs": {"production": {"env_vars": \1}}, "build_config": {"build_command": "pnpm build:x"}}/' "$dir/build-noise-only.json" > "$dir/build-command.json"
expect build-command true
echo '{"format_version": "1.2"}' > "$dir/empty.json";             expect empty false

exit "$fail"
