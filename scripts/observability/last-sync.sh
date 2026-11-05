#!/usr/bin/env bash
# Prints "<head_sha> <updated_at>" of the newest observability sync run on
# main that reached Grafana, or nothing: its reconcile job ran and its
# "Reached Grafana" step succeeded (runs older than that step always reached
# it). A run that skipped because Grafana was down also ends as success, so
# the run's conclusion alone does not say it synced.
# Needs GH_TOKEN (actions: read) and GH_REPO.
set -euo pipefail

runs="$(gh api "repos/$GH_REPO/actions/workflows/observability-sync.yml/runs?branch=main&status=success&per_page=30" \
          --jq '.workflow_runs[] | "\(.id) \(.head_sha) \(.updated_at)"')"
while read -r id sha updated; do
  [[ -n "$id" ]] || continue
  reached="$(gh api "repos/$GH_REPO/actions/runs/$id/jobs" \
               --jq '[.jobs[] | select(.name == "reconcile") | .steps[]?] as $s
                     | ($s | length > 0)
                       and ([$s[] | select(.name == "Reached Grafana" and .conclusion != "success")] | length == 0)')"
  if [[ "$reached" == true ]]; then
    echo "$sha $updated"
    exit 0
  fi
done <<< "$runs"
