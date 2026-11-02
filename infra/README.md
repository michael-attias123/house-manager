# infra

All of house-manager's infrastructure as code: Cloudflare Pages, Supabase
settings and Edge Function secrets, GitHub secrets and branch protection,
and monitoring on Grafana Cloud (off until `observability_enabled = true`).
OpenTofu runs it; the HCL also runs on Terraform (only `encryption.tf` is
OpenTofu-only).

| Doc | For |
|---|---|
| [BOOTSTRAP.md](BOOTSTRAP.md) | The manual layer zero: first-time setup, first import, rotation, disaster recovery |
| [SECRETS.md](SECRETS.md) | The secrets module interface, and moving from SOPS to Infisical, Bitwarden, Vault or OpenBao |
| [MIGRATING.md](MIGRATING.md) | OpenTofu ⇄ Terraform, and swapping Cloudflare Pages or Supabase for another vendor |

## Layout

```
versions.tf         tool and provider versions; providers read tokens from the env
backend.tf          state in this project's Supabase Postgres, tofu_state.states (pg backend)
encryption.tf       OpenTofu only: state and plan encryption (TF_VAR_state_passphrase)
main.tf             wires the modules together
observability.tf    monitoring: the Grafana stack lookup, module.observability, module.uptime
variables.tf        root inputs; values in prod.auto.tfvars (committed, nothing secret)
outputs.tf          app_url, supabase_function_url, grafana_url, faro_collector_url
checks.tf           guards: VAPID format, one public key everywhere, monitoring secrets, Faro origin
imports.tf          adopts the resources that existed before IaC
modules/
  secrets/sops/             -> values (sensitive map)
  hosting/cloudflare_pages/ -> url, redirect_urls, project_name
  backend/supabase/         -> api_url, publishable_key, function_url, metrics_url, metrics_secret_key
  repo/github/              -> repository
  observability/grafana_cloud/  -> grafana_url, faro_collector_url, otlp_endpoint, edge_otlp_basic_auth,
                                   ci_otlp_headers, sm_access_token, sm_url (tests/: tofu test)
  uptime/grafana_synthetics/    -> jobs (the SM checks app, supabase-auth, send-push)
.sops.yaml          age recipient for secrets.enc.yaml
secrets.enc.yaml    the app secrets, SOPS-encrypted (created by you, see BOOTSTRAP.md)
secrets.example.yaml  its keys, with fake values and where each comes from
scripts/
  encrypt-secrets.sh  create, change (--set KEY) or check (--check) secrets.enc.yaml
  sync-vault.sh       CI: writes push_function_url and push_secret into Supabase Vault
  sync-db-roles.sh    CI: login + password (SCRAM verifier) for grafana_reader; no-op while monitoring is off
  scram-verifier.py   password on stdin -> SCRAM-SHA-256 verifier (standard library only)
  grafana-env.sh      CI: Grafana provider env from the two Grafana secrets, only while monitoring is on
  pages-rebuild.sh    CI: a Pages production build after an apply that changes its build variables (tests: test-pages-rebuild.sh)
```

Workflows: `.github/workflows/infra.yml` (plan on PR, apply on merge, weekly
drift check, "apply main" from the Actions tab for token rotations) and
`.github/workflows/bootstrap-check.yml` (read-only check of the bootstrap
secrets). `.github/workflows/observability-sync.yml` re-applies only
`module.observability` and `module.uptime` every 30 minutes and on changes to
`observability/` (the GitOps reconciler).

## Monitoring (Grafana Cloud)

Off while `observability_enabled = false` in `prod.auto.tfvars`: every
Grafana resource has count 0, the Grafana providers are configured with
nulls and get no token, and the plan is the same as without monitoring.

| What | Where |
|---|---|
| Stack lookup (never managed), access policies, minted OTLP tokens, SM installation, Faro app, metrics scrape job, data source `hm-postgres`, contact points, alerts folder `hm-alerts` | `modules/observability/grafana_cloud` |
| Alert rule groups, notification policy, mute timings | files in `observability/alerts` and `observability/alerting`, rendered by the module (`alerting_files.tf`) |
| Dashboards | files in `observability/dashboards`, pulled by Grafana **Git Sync** (`gitsync.tf`); with `dashboards_via_git_sync = false`, applied as `grafana_dashboard` instead (`dashboards.tf`) |
| Uptime checks | `modules/uptime/grafana_synthetics` (`uptime_enabled`) |
| Supabase metrics key | `supabase_apikey.grafana_metrics` in `modules/backend/supabase` |

Turning it on: bootstrap items 7–9 (`BOOTSTRAP.md`), the monitoring keys in
`secrets.enc.yaml`, then a PR with `observability_enabled = true`, then a
second PR with `uptime_enabled = true` (the SM token must exist before the
`sm` provider can use it). Edits in the Grafana UI to provisioned alerts are
refused; dashboard saves become a PR through Git Sync.

## Daily flow

1. Edit a `.tf` file, `prod.auto.tfvars`, or a secret
   (`scripts/encrypt-secrets.sh --set KEY`).
2. Open a PR. CI runs fmt, validate (OpenTofu and Terraform), tflint, trivy and
   `plan`, and posts the plan as a comment. Read it.
3. Merge. CI applies that plan. If it changes the Pages build variables
   (`VITE_*` and the rest) or build settings, CI then starts a production
   build itself (`scripts/pages-rebuild.sh`), since Vite bakes them in at
   build time. Pages builds on its own only for changes under `web/`.

Do not change managed settings in the dashboards: the next apply puts the
code's value back, and the weekly drift check opens an issue meanwhile.

## Running locally

Plan locally if you want; leave `apply` to CI. Tools: OpenTofu ≥ 1.11 (CI
pins 1.12.8; write-only arguments need 1.11), sops, age, tflint. Credentials come from the environment only. In bash, without
putting them in shell history:

```bash
cd infra
for v in TF_VAR_state_passphrase PG_CONN_STR \
         CLOUDFLARE_API_TOKEN SUPABASE_ACCESS_TOKEN GITHUB_TOKEN; do
  read -rsp "$v: " "$v"; echo; export "$v"
done
export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt

tofu init
tofu plan
```

| Variable | Bootstrap item |
|---|---|
| `TF_VAR_state_passphrase` | `TF_STATE_PASSPHRASE` |
| `PG_CONN_STR` | `TF_STATE_PG_CONN` (the Session pooler string, port 5432) |
| `CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN` | same names |
| `GITHUB_TOKEN` | `GH_ADMIN_TOKEN` |
| `GRAFANA_CLOUD_ACCESS_POLICY_TOKEN`, `GRAFANA_CONNECTIONS_API_ACCESS_TOKEN`, `GRAFANA_FRONTEND_O11Y_API_ACCESS_TOKEN` | all three `GRAFANA_CLOUD_TOKEN`; only while `observability_enabled = true` |
| `GRAFANA_AUTH` | `GRAFANA_SA_TOKEN`; only while `observability_enabled = true` |

Checks that need no credentials:

```bash
tofu fmt -check -recursive
tofu init -backend=false && tofu validate
tflint --init && tflint --recursive
(cd modules/observability/grafana_cloud && tofu init -backend=false && tofu test)   # renders tests/fixture
scripts/encrypt-secrets.sh --check     # needs only your age key
```
