# Secrets: the module interface, and swapping the store

Today the secrets live in `infra/secrets.enc.yaml`, encrypted with SOPS + age.
The rest of the code does not know that: it only sees one module output.

## The interface

```hcl
module "secrets" {
  source = "./modules/secrets/sops"   # the one line that names the store

  file = "${path.module}/secrets.enc.yaml"   # store-specific inputs
}

# everywhere else:
module.secrets.values["vapid_public_key"]
```

| | |
|---|---|
| Inputs | Store-specific (here `file`). They live in the `module "secrets"` block only. |
| Output | `values`: a **sensitive `map(string)`** with exactly the keys below. |
| Keys | `vapid_public_key`, `vapid_private_key`, `vapid_subject`, `push_secret`, `google_client_id`, `google_client_secret`, `supabase_db_password`, `supabase_db_url` |
| Validation | `checks.tf` and variable validation check the values, whatever the store. |

Any store that produces the same `values` map is a drop-in replacement. The
plan after the swap must be empty: same values, same resources.

Values read through a data source are stored in the state. OpenTofu encrypts
the state (`encryption.tf`); on Terraform it is only encrypted at rest by R2
(see `MIGRATING.md`).

## Choosing a store

| Store | Hosting | CI auth without a stored secret | Notes |
|---|---|---|---|
| SOPS + age (today) | the repo | no: `SOPS_AGE_KEY` | nothing to run; values change by PR |
| Infisical Cloud | SaaS, free tier | yes: GitHub OIDC (machine identity) | web UI, audit log, versioning |
| Bitwarden Secrets Manager | SaaS, free tier | check current docs; it has used a machine-account access token (one stored secret, `BWS_ACCESS_TOKEN`) | good if you already use Bitwarden |
| Vault / OpenBao | self-hosted (a small VM) | yes: JWT auth with GitHub OIDC | most control; you run and back it up |

## Module skeletons

Each goes in `modules/secrets/<store>/` and returns the same `values`. They
are starting points: check resource and attribute names against the docs of
the provider version you pin, and pin it in `versions.tf`.

### Infisical (`modules/secrets/infisical`)

Infisical side: a project with an environment `prod` holding the eight keys
(lowercase names, as above), and a machine identity with **OIDC Auth**:
issuer/discovery URL `https://token.actions.githubusercontent.com`, subject
`repo:<owner>/house-manager:*` (or `:ref:refs/heads/main` for apply only),
audience of your choice. Give the identity read access to that project.

```hcl
# main.tf (provider, in the root; source "Infisical/infisical" in versions.tf)
provider "infisical" {
  host = "https://app.infisical.com"
  auth = {
    oidc = {
      identity_id = var.infisical_identity_id # not a secret
      # The JWT comes from the INFISICAL_AUTH_JWT environment variable.
    }
  }
}

# modules/secrets/infisical/main.tf
variable "project_id" { type = string }
variable "env_slug" {
  type    = string
  default = "prod"
}

data "infisical_secrets" "this" {
  workspace_id = var.project_id
  env_slug     = var.env_slug
  folder_path  = "/"
}

output "values" {
  sensitive = true
  value     = { for k, s in data.infisical_secrets.this.secrets : k => s.value }
}
```

CI step before `plan`/`apply` (the job needs `permissions: id-token: write`):

```yaml
- name: GitHub OIDC token for Infisical
  run: |
    jwt=$(curl -sSf -H "Authorization: bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN" \
      "$ACTIONS_ID_TOKEN_REQUEST_URL&audience=<your audience>" | jq -r .value)
    echo "::add-mask::$jwt"
    echo "INFISICAL_AUTH_JWT=$jwt" >> "$GITHUB_ENV"
```

### Bitwarden Secrets Manager (`modules/secrets/bitwarden`)

Bitwarden side: a project with the eight secrets (secret name = key), and a
machine account with read access to it. Its access token goes into GitHub as
`BWS_ACCESS_TOKEN` (it replaces `SOPS_AGE_KEY`, it does not remove a secret).
Example with the community `maxlaverse/bitwarden` provider; Bitwarden also
publishes its own Secrets Manager provider, which works the same way.

```hcl
# main.tf (provider, in the root)
provider "bitwarden" {
  access_token = var.bws_access_token # TF_VAR_bws_access_token from BWS_ACCESS_TOKEN
  experimental {
    embedded_client = true
  }
}

# modules/secrets/bitwarden/main.tf
variable "organization_id" { type = string }

locals {
  keys = [
    "vapid_public_key", "vapid_private_key", "vapid_subject", "push_secret",
    "google_client_id", "google_client_secret", "supabase_db_password", "supabase_db_url",
  ]
}

data "bitwarden_secret" "this" {
  for_each        = toset(local.keys)
  key             = each.key
  organization_id = var.organization_id
}

output "values" {
  sensitive = true
  value     = { for k, s in data.bitwarden_secret.this : k => s.value }
}
```

### Vault / OpenBao (`modules/secrets/vault`)

The `hashicorp/vault` provider works with OpenBao too. Server side, once:

```bash
vault secrets enable -path=kv kv-v2
vault kv put kv/house-manager/prod @values.json   # the eight keys; delete the file after
vault auth enable jwt
vault write auth/jwt/config \
  oidc_discovery_url=https://token.actions.githubusercontent.com \
  bound_issuer=https://token.actions.githubusercontent.com
vault policy write house-manager-infra - <<'EOF'
path "kv/data/house-manager/prod" { capabilities = ["read"] }
EOF
vault write auth/jwt/role/house-manager-infra role_type=jwt \
  user_claim=repository bound_audiences=<your audience> \
  bound_claims='{"repository":"<owner>/house-manager"}' \
  token_policies=house-manager-infra token_ttl=15m
```

Never put values on the command line: `@values.json` (or `key=@file`)
reads them from a file instead. Write it with umask 077 outside the repo.

```hcl
# main.tf (provider, in the root): reads VAULT_ADDR and VAULT_TOKEN from the env
provider "vault" {}

# modules/secrets/vault/main.tf
variable "mount" {
  type    = string
  default = "kv"
}
variable "path" {
  type    = string
  default = "house-manager/prod"
}

data "vault_kv_secret_v2" "this" {
  mount = var.mount
  name  = var.path
}

output "values" {
  sensitive = true
  value     = data.vault_kv_secret_v2.this.data
}
```

CI step (exports a short-lived `VAULT_TOKEN`; the job needs `permissions: id-token: write`):

```yaml
- uses: hashicorp/vault-action@v3 # pin a full version or SHA
  with:
    url: https://vault.example.com
    method: jwt
    role: house-manager-infra
    jwtGithubAudience: <your audience>
    exportToken: true
```

## Migration steps (SOPS → another store)

1. **Copy the values.** On your machine, paste them into the store's web UI,
   or decrypt once to a file outside the repo and import it
   (`umask 077; sops -d --output-type json infra/secrets.enc.yaml > ~/values.json`,
   then the store's file import, e.g. `vault kv put ... @values.json`, and
   `rm ~/values.json`). Avoid CLIs that take values as arguments.
2. **Add the module** `modules/secrets/<store>/` and its provider (in
   `versions.tf`, plus the provider block).
3. **Swap one module block** in `main.tf`: `source = "./modules/secrets/<store>"`
   and that store's inputs instead of `file`.
4. **CI:** add the auth step and `id-token: write` to `infra.yml` (and the
   store's check to `bootstrap-check.yml`). `scripts/sync-vault.sh` reads
   `push_secret` with sops today; switch it to the new store. Search for
   other readers: `grep -rn 'secrets.enc.yaml\|SOPS_AGE_KEY' .github infra`.
5. **Open a PR. The plan must be empty** (only the data source reads). Any
   change means a value differs: fix it in the store, not in code.
6. **Merge**, then delete `infra/secrets.enc.yaml`, `infra/.sops.yaml`,
   `modules/secrets/sops`, the `sops` provider, `scripts/encrypt-secrets.sh`,
   and the `SOPS_AGE_KEY` GitHub secret.

Rollback before step 6 is the same one line back to `./modules/secrets/sops`.

## What moves into the secret manager

| Bootstrap item | With a secret manager + OIDC |
|---|---|
| `SOPS_AGE_KEY` | removed |
| `CLOUDFLARE_API_TOKEN`, `SUPABASE_ACCESS_TOKEN`, `GH_ADMIN_TOKEN` | stored in the manager; CI reads them after the OIDC login and exports them as env vars for the providers |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | can move too (the backend needs them before init, so CI fetches them in the same step) |
| `TF_STATE_PASSPHRASE` | can move too, same way |
| `CLOUDFLARE_ACCOUNT_ID` | stays as config |

With Bitwarden's access token instead of OIDC, that token is the one stored
secret left in GitHub. `BOOTSTRAP.md` ("After OIDC and a secret manager")
shows the resulting layer zero.
