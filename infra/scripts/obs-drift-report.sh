#!/usr/bin/env bash
# observability-sync.yml's post-apply hook (shared-platform tofu-stack.yml).
# A scheduled or manual sync that applied changes, with nothing new in
# observability/ or infra/ since the last sync that reached Grafana, reverted
# an edit made outside git: it says so on the infra-drift issue. A push run
# applies a merged commit, so it reports nothing.
# Env from tofu-stack: PLAN_CHANGED, PLAN_JSON, GH_TOKEN, GH_REPO, RUN_URL,
# PLATFORM (shared-platform checkout, for tools/last_reached.sh).
set -euo pipefail
cd "$(dirname "$0")/../.."

[[ "${PLAN_CHANGED:-false}" == true && -s "${PLAN_JSON:-}" ]] || exit 0
[[ "${GITHUB_EVENT_NAME:-}" != push ]] || exit 0

last="$("$PLATFORM/tools/last_reached.sh" observability-sync.yml '*' 'Reached the providers' | cut -d' ' -f1 || true)"
# The checkout is one commit deep; git diff compares two trees and needs no history in between.
if [[ -n "$last" && "$last" != "$GITHUB_SHA" ]]; then
  git fetch -q --depth=1 origin "$last" 2>/dev/null || true
fi
if [[ -n "$last" && "$last" != "$GITHUB_SHA" ]] && git cat-file -e "$last^{commit}" 2>/dev/null &&
  ! git diff --quiet "$last" "$GITHUB_SHA" -- observability infra; then
  echo "Changes since the last sync that reached Grafana (${last:0:7}) came from commits: not drift."
  exit 0
fi

body="${RUNNER_TEMP:-/tmp}/obs-drift.md"
{
  echo "The observability sync reverted changes made outside git ($(date -u +'%F %H:%M') UTC, [run log]($RUN_URL))."
  echo "Edit \`observability/\` in a PR instead; for an emergency, a Grafana silence is fine."
  echo
  echo '```text'
  # Addresses and actions only, never values.
  jq -r '.resource_changes[]? | select((.change.actions | sort) != ["no-op"] and (.change.actions | sort) != ["read"])
         | "  \(.change.actions | join("-")) \(.address)"' "$PLAN_JSON"
  echo '```'
} >"$body"
gh label create infra-drift --color D93F0B --description 'The live infrastructure differs from infra/' --force >/dev/null
number="$(gh issue list --label infra-drift --state open --limit 1 --json number --jq '.[0].number // empty')"
if [[ -n "$number" ]]; then
  gh issue comment "$number" --body-file "$body" >/dev/null
  echo "::warning::Drift reverted: commented on issue #$number."
else
  url="$(gh issue create --title 'Infrastructure drift: the live setup differs from infra/' \
    --label infra-drift --body-file "$body")"
  echo "::warning::Drift reverted: opened $url."
fi
