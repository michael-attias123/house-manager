# Migrating: OpenTofu ⇄ Terraform, and swapping vendors

The code is plain HCL that both tools read. The one exception is
`encryption.tf` (client-side state and plan encryption), which is
OpenTofu-only and isolated in its own file.

## OpenTofu → Terraform

Order matters: Terraform cannot read an encrypted state, so decrypt first,
while OpenTofu can still read it.

### 1. Decrypt the state (still on OpenTofu)

Edit `encryption.tf` as the OpenTofu docs describe for rolling back
encryption: write unencrypted, keep the old method as the fallback for reading.

```hcl
terraform {
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }
    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }
    method "unencrypted" "migrate" {}

    state {
      method = method.unencrypted.migrate     # write plaintext
      fallback {
        method = method.aes_gcm.state         # read the current state
      }
      # no `enforced = true`
    }
    plan {
      method = method.unencrypted.migrate
      fallback {
        method = method.aes_gcm.state
      }
    }
  }
}
```

Then rewrite the state once:

```bash
cd infra
tofu init
tofu apply -refresh-only     # writes the state back, now unencrypted
```

Check that it worked: `select left(data, 200) from tofu_state.states;` shows
ordinary state JSON (`"version": 4`, `"resources"`), not an object with
`"encrypted_data"`. From now on the state holds secret values in plaintext,
protected only by the `tofu_state` role's password and the table's grants.

### 2. Remove the OpenTofu-only parts

1. Delete `encryption.tf` (the `state_passphrase` variable is declared there and goes with it).
2. Delete the `TF_STATE_PASSPHRASE` GitHub secret and `TF_VAR_state_passphrase` from `infra.yml`.

### 3. Switch the CLI and re-init

1. In `infra.yml` (and locally), replace the OpenTofu setup action with
   `hashicorp/setup-terraform` and `tofu` with `terraform`.
2. Same `backend.tf` (the pg backend is in both tools; Terraform's table is
   always `states`, the name used here), same `PG_CONN_STR`:
   ```bash
   terraform init -reconfigure
   ```

### 4. Provider addresses and the lock file

`versions.tf` uses unqualified sources (`cloudflare/cloudflare`). Each tool
expands them to its own registry: `registry.opentofu.org/cloudflare/cloudflare`
in OpenTofu, `registry.terraform.io/cloudflare/cloudflare` in Terraform. Keep
them unqualified; that is what makes the same file work in both.

The state records the full address (`provider["registry.opentofu.org/..."]`).
Left as is, `terraform init` installs the OpenTofu-registry copy of each
provider as well, just to read the old state. Point the state at the
Terraform registry once per provider:

```bash
for p in cloudflare/cloudflare integrations/github supabase/supabase carlpett/sops; do
  terraform state replace-provider -auto-approve "registry.opentofu.org/$p" "registry.terraform.io/$p"
done
```

`.terraform.lock.hcl` is keyed by the full address too. Delete it and
regenerate it for every platform you use, then commit:

```bash
terraform providers lock -platform=linux_amd64 -platform=darwin_arm64 -platform=darwin_amd64
```

### 5. Verify

`terraform plan` must be empty. Open a PR so CI shows the same.

## What is OpenTofu-only, and how CI guards it

| Feature | Where | Terraform |
|---|---|---|
| State and plan encryption (`terraform { encryption {} }`) | `encryption.tf` only | not supported; remove as above |
| Variables or locals in `backend` / module `source` (early evaluation) | not used | not supported |
| Provider `for_each`, the `enabled` meta-argument, `-exclude` | not used | not supported |
| `tofu test` specifics, `.tofu` files | not used | `.tofu` files are ignored by Terraform |

The guard: `infra.yml` runs `validate` twice on every PR, once with OpenTofu
and once with Terraform on a copy of `infra/` without `encryption.tf`. Code
that only OpenTofu accepts fails the Terraform job before it can merge.
tflint runs too. Rule of thumb: anything tool-specific goes in a file of its
own, the way `encryption.tf` does.

## Terraform → OpenTofu (the reverse)

1. Install OpenTofu, replace the setup action in `infra.yml`, `tofu init -reconfigure`.
2. Provider addresses: run the loop above the other way round
   (`tofu state replace-provider registry.terraform.io/$p registry.opentofu.org/$p`)
   if the plan reports providers missing from the configuration.
   Regenerate `.terraform.lock.hcl` with `tofu providers lock ...`.
3. Re-encrypt the state: restore `encryption.tf` with the `aes_gcm` method as
   the `method` and the plaintext as the fallback:
   ```hcl
   state {
     method = method.aes_gcm.state
     fallback {
       method = method.unencrypted.migrate
     }
   }
   ```
   (the same for `plan`), set `TF_STATE_PASSPHRASE` (bootstrap item 6), run
   `tofu apply -refresh-only`, check the row in `tofu_state.states` now has
   `"encrypted_data"`, then remove the fallback and the `unencrypted` method
   and add `enforced = true`.
4. `tofu plan` must be empty.

## Swapping a vendor

Modules are swappable by role, not by vendor. A new vendor is a new module
directory with the **same inputs and outputs**, plus the `source` line (and
any vendor-specific inputs) in `main.tf`.

| Role | Module | Inputs | Outputs |
|---|---|---|---|
| hosting | `modules/hosting/cloudflare_pages` | `account_id`, `project_name`, `production_branch`, `github_owner`, `github_repository`, `root_dir`, `build_command`, `output_dir`, `env_vars`, `secret_env_vars`, `custom_domain` | `url`, `redirect_urls`, `project_name` |
| backend | `modules/backend/supabase` | `project_ref`, `organization_id`, `project_name`, `region`, `database_password`, `site_url`, `redirect_urls`, `google_client_id`, `google_client_secret`, `function_secrets` | `api_url`, `publishable_key`, `function_url` |
| secrets | `modules/secrets/sops` | `file` | `values` (see `SECRETS.md`) |
| repo | `modules/repo/github` | `repository`, `actions_secrets`, `protected_branch`, `required_checks` | `repository` |

Inputs a vendor has no use for (for example `account_id` on Vercel) are
declared and ignored, so `main.tf` stays the same.

### Cloudflare Pages → Netlify or Vercel

1. Write `modules/hosting/vercel` (provider `vercel/vercel`) or
   `modules/hosting/netlify` (provider `netlify/netlify`):
   - the project/site linked to the GitHub repo, root `web`, `pnpm build`, output `dist`;
   - `env_vars` as plain variables for production and preview, `secret_env_vars` as sensitive ones;
   - `custom_domain` if set.
   Check what the provider can create: if it cannot create the site itself,
   create it by hand, add it to bootstrap, and import it.
2. Outputs: `url` is the production URL (custom domain, else the vendor's
   default domain). `redirect_urls` must cover production and previews, in
   Supabase's wildcard syntax, e.g. `https://<project>.vercel.app/**` and
   `https://<project>-*.vercel.app/**`, or `https://*--<site>.netlify.app/**`
   for Netlify deploy previews.
3. Change `source` in `main.tf`, and the provider in `versions.tf`.
4. The plan creates the new site and changes the Supabase Site URL and
   Redirect URLs (they come from the hosting outputs). Apply, check sign-in
   works on the new URL, then remove the Cloudflare module (its
   `prevent_destroy` has to go first, in its own PR).

### Supabase → another backend

The module covers the backend's settings; the web app itself talks to the
Supabase API (supabase-js, RLS policies, RPCs, Realtime, Edge Functions). So
"another backend" in practice means another Supabase-compatible host, for
example a self-hosted Supabase, or a new Supabase project:

1. Write `modules/backend/<host>` with the same inputs and outputs: `api_url`
   (what the browser uses as `VITE_SUPABASE_URL`), `publishable_key`, and
   `function_url` (the `send-push` endpoint that `sync-vault.sh` stores in the
   database).
2. Swap `source`. Migrations and Edge Function code keep deploying from
   `supabase/` as today; data moves with a dump and restore, outside IaC.
3. A truly different backend (not Supabase) is an app change as well, not
   only a module.
