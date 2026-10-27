# infra

All of house-manager's infrastructure as code: Cloudflare Pages, Supabase
settings and Edge Function secrets, GitHub secrets and branch protection.
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
variables.tf        root inputs; values in prod.auto.tfvars (committed, nothing secret)
outputs.tf          app_url, supabase_function_url
checks.tf           guards: VAPID format, one public key everywhere, plain-text VITE_*
imports.tf          adopts the resources that existed before IaC
modules/
  secrets/sops/             -> values (sensitive map)
  hosting/cloudflare_pages/ -> url, redirect_urls, project_name
  backend/supabase/         -> api_url, publishable_key, function_url
  repo/github/              -> repository
.sops.yaml          age recipient for secrets.enc.yaml
secrets.enc.yaml    the app secrets, SOPS-encrypted (created by you, see BOOTSTRAP.md)
secrets.example.yaml  its keys, with fake values and where each comes from
scripts/
  encrypt-secrets.sh  create, change (--set KEY) or check (--check) secrets.enc.yaml
  sync-vault.sh       CI: writes push_function_url and push_secret into Supabase Vault
```

Workflows: `.github/workflows/infra.yml` (plan on PR, apply on merge, weekly
drift check) and `.github/workflows/bootstrap-check.yml` (read-only check of
the bootstrap secrets).

## Daily flow

1. Edit a `.tf` file, `prod.auto.tfvars`, or a secret
   (`scripts/encrypt-secrets.sh --set KEY`).
2. Open a PR. CI runs fmt, validate (OpenTofu and Terraform), tflint, trivy and
   `plan`, and posts the plan as a comment. Read it.
3. Merge. CI applies that plan.

Do not change managed settings in the dashboards: the next apply puts the
code's value back, and the weekly drift check opens an issue meanwhile.

## Running locally

Plan locally if you want; leave `apply` to CI. Tools: OpenTofu ≥ 1.10, sops,
age, tflint. Credentials come from the environment only. In bash, without
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

Checks that need no credentials:

```bash
tofu fmt -check -recursive
tofu init -backend=false && tofu validate
tflint --init && tflint --recursive
scripts/encrypt-secrets.sh --check     # needs only your age key
```
