#!/usr/bin/env bash
# CI (infra.yml apply): a new Cloudflare Pages production build when an apply
# changes the build-time variables. Vite inlines VITE_* when it builds, so
# a new value reaches the app only through a new build.
#
#   pages-rebuild.sh changed PLAN.json   prints true or false: does the plan
#       (tofu show -json) change the Pages project's production env vars, or
#       a known value of its build config (command, root or output dir)?
#   pages-rebuild.sh rebuild             waits for a production build already
#       running (it would finish with the old values and could go live last),
#       then starts one of the production branch.
#       env: CLOUDFLARE_API_TOKEN, CF_ACCOUNT_ID, PAGES_PROJECT, PRODUCTION_BRANCH
#
# Prints no values: the plan JSON holds the variables in clear text, and the
# API is asked only for deployment ids, stages and URLs.
set -euo pipefail

ADDRESS='module.hosting.cloudflare_pages_project.this'

changed() {
  jq -r --arg addr "$ADDRESS" '
    [ .resource_changes[]?
      | select(.address == $addr)
      | select(.change.actions | (index("create") or index("update")))
      | (.change.before.deployment_configs.production.env_vars // null) as $before
      | (.change.after.deployment_configs.production.env_vars // null) as $after
      | ([.change.after_unknown.deployment_configs.production.env_vars // false | .. | select(. == true)] | length > 0) as $unknown
      | ((.change.before.build_config // {} | {build_command, destination_dir, root_dir})
         != (.change.after.build_config // {} | {build_command, destination_dir, root_dir})) as $build
      | ($before != $after) or $unknown or $build
    ] | any
  ' "$1"
}

api() {
  curl -sS --max-time 60 -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "$@"
}

rebuild() {
  : "${CLOUDFLARE_API_TOKEN:?}" "${CF_ACCOUNT_ID:?}" "${PAGES_PROJECT:?}" "${PRODUCTION_BRANCH:?}"
  local base="https://api.cloudflare.com/client/v4/accounts/$CF_ACCOUNT_ID/pages/projects/$PAGES_PROJECT/deployments"
  local response running

  # Up to 20 minutes for a production build already under way.
  for _ in $(seq 1 40); do
    response="$(api "$base?env=production&per_page=5")"
    if [[ "$(jq -r '.success' <<<"$response")" != true ]]; then
      echo "::error::Cloudflare: $(jq -c '[.errors[]?.message]' <<<"$response")"
      return 1
    fi
    running="$(jq -r '[.result[] | select(.latest_stage.status == "active" or .latest_stage.status == "idle")] | length' <<<"$response")"
    [[ "$running" == 0 ]] && break
    echo "A production build is running; waiting for it before starting the new one."
    sleep 30
  done

  response="$(api -X POST --form "branch=$PRODUCTION_BRANCH" "$base")"
  if [[ "$(jq -r '.success' <<<"$response")" != true ]]; then
    echo "::error::Cloudflare: $(jq -c '[.errors[]?.message]' <<<"$response")"
    return 1
  fi
  echo "Started production build $(jq -r '.result.id' <<<"$response"): $(jq -r '.result.url' <<<"$response")"
}

case "${1:-}" in
  changed) changed "${2:?plan JSON}" ;;
  rebuild) rebuild ;;
  *) echo "usage: $0 changed PLAN.json | rebuild" >&2; exit 2 ;;
esac
