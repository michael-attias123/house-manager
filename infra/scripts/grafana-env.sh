#!/usr/bin/env bash
# CI only: hands the Grafana tokens to the OpenTofu steps that follow, and
# only while observability_enabled is true in prod.auto.tfvars. With the flag
# off, the providers get no token at all, so a plan or apply is exactly what
# it was before monitoring existed (the secrets may already exist).
#
# Reads GRAFANA_CLOUD_TOKEN (bootstrap item 7) and GRAFANA_SA_TOKEN (item 8)
# from its environment and appends to $GITHUB_ENV the variables the grafana
# provider reads (infra/versions.tf):
#   GRAFANA_CLOUD_ACCESS_POLICY_TOKEN, GRAFANA_CONNECTIONS_API_ACCESS_TOKEN,
#   GRAFANA_FRONTEND_O11Y_API_ACCESS_TOKEN  <- GRAFANA_CLOUD_TOKEN
#   GRAFANA_AUTH                            <- GRAFANA_SA_TOKEN
# Values come from Actions secrets, so the runner masks them in logs; this
# script never prints them. Used by infra.yml and observability-sync.yml.
set -euo pipefail

INFRA_DIR="$(cd "$(dirname "$0")/.." && pwd)"
: "${GITHUB_ENV:?grafana-env.sh runs in GitHub Actions only}"

enabled="$(sed -n 's/^observability_enabled *= *\(true\|false\).*/\1/p' "$INFRA_DIR/prod.auto.tfvars")"
if [[ "$enabled" != true ]]; then
  echo "grafana-env: observability_enabled is not true; the Grafana provider gets no token."
  exit 0
fi

missing=()
[[ -n "${GRAFANA_CLOUD_TOKEN:-}" ]] || missing+=(GRAFANA_CLOUD_TOKEN)
[[ -n "${GRAFANA_SA_TOKEN:-}" ]] || missing+=(GRAFANA_SA_TOKEN)
if ((${#missing[@]} > 0)); then
  echo "::error::observability_enabled is true but these secrets are missing: ${missing[*]} (infra/BOOTSTRAP.md, items 7 and 8)."
  exit 1
fi
for name in GRAFANA_CLOUD_TOKEN GRAFANA_SA_TOKEN; do
  if [[ "${!name}" == *[[:space:]]* ]]; then
    echo "::error::$name contains whitespace (a stray newline when it was pasted?); set it again."
    exit 1
  fi
done

{
  echo "GRAFANA_CLOUD_ACCESS_POLICY_TOKEN=$GRAFANA_CLOUD_TOKEN"
  echo "GRAFANA_CONNECTIONS_API_ACCESS_TOKEN=$GRAFANA_CLOUD_TOKEN"
  echo "GRAFANA_FRONTEND_O11Y_API_ACCESS_TOKEN=$GRAFANA_CLOUD_TOKEN"
  echo "GRAFANA_AUTH=$GRAFANA_SA_TOKEN"
} >>"$GITHUB_ENV"
echo "grafana-env: Grafana provider credentials set for the following steps."
