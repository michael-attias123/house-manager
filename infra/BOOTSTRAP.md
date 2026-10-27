# Bootstrap: layer zero

Everything under `infra/` is managed by OpenTofu, except the few items here.
You create them once, by hand, in this order. After that, every change is a PR.

## The principle

**The chicken-and-egg problem.** Before OpenTofu can manage anything, it needs
three things it cannot create for itself:

1. **Credentials.** An API token per provider. A token created by `apply` cannot authorize that same `apply`.
2. **A place for the state.** An R2 bucket. Without state there is no `apply`, so the state cannot manage its own storage.
3. **Keys to decrypt secrets.** The SOPS age key and the state passphrase. A key stored inside what it decrypts is useless.

**The rules for layer zero:**

| Rule | What it means here |
|---|---|
| Minimal | Only what truly cannot be automated: 7 items (3–4 after OIDC and a secret manager). |
| Documented | This file: where to create each item, which permissions, where to paste it. |
| Least privilege | Each token gets only what IaC needs, on one account or repo, never admin. |
| Rotatable | Each item has rotation steps below, and an expiry where the provider allows one. |
| Verifiable | The read-only **Bootstrap check** workflow (`bootstrap-check.yml`) confirms every secret exists and every token works, before the first plan. |
| Import, don't recreate | Anything made by hand (the bucket, the existing Pages and Supabase projects) is `import`ed (`imports.tf`), then described in code and protected by `prevent_destroy`. |

## Inventory

| # | Item | Created in | Stored in | Least privilege | After OIDC |
|---|---|---|---|---|---|
| 1 | R2 bucket `house-manager-tfstate` | Cloudflare, R2 | (imported later) | – | stays |
| 2 | R2 access key + secret | R2 API tokens page | GitHub: `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Object Read & Write, that bucket only | stays (R2 has no OIDC) |
| 3 | Cloudflare API token | My Profile → API Tokens | GitHub: `CLOUDFLARE_API_TOKEN` | Pages: Edit, Workers R2 Storage: Edit, one account | moves into the secret manager |
| 4 | Supabase access token | supabase.com/dashboard/account/tokens | GitHub: `SUPABASE_ACCESS_TOKEN` | not scopable; give it an expiry | moves into the secret manager |
| 5 | GitHub fine-grained PAT | GitHub, Developer settings | GitHub: `GH_ADMIN_TOKEN` | this repo: Administration, Secrets, Metadata | moves, or becomes a GitHub App |
| 6 | age key | `age-keygen`, locally | GitHub: `SOPS_AGE_KEY` + your password manager | – | **removed** (the secret manager replaces SOPS) |
| 7 | State passphrase | a random string | GitHub: `TF_STATE_PASSPHRASE` + your password manager | – | stays (state encryption) |
| – | Cloudflare account ID | Cloudflare dashboard | GitHub: `CLOUDFLARE_ACCOUNT_ID` + `prod.auto.tfvars` | not a credential (R2 endpoint) | stays |
| – | Google OAuth client | Google Cloud console | values in `secrets.enc.yaml` | – | always manual (no API) |

Not bootstrap, but also manual: the Google consent screen and Test users, and
the in-app data (allowed emails, admins). See `docs/setup.md`.

## Step by step

Add each GitHub secret on the repo's **Settings → Secrets and variables →
Actions → New repository secret**, or from a terminal (the value is prompted
for, hidden, and stays out of shell history):

```bash
gh secret set NAME --repo <owner>/house-manager
```

Keep a note of each token's expiry date in your calendar.

### 1. R2 bucket

1. Cloudflare dashboard → **R2 Object Storage**. The first time, R2 has to be
   enabled for the account (it may ask for a payment method; the state is far
   inside the free tier).
2. **Create bucket**: name `house-manager-tfstate`, location automatic,
   default jurisdiction. Leave public access off.

### 2. R2 access key

1. On the R2 overview, open the page for managing R2 API tokens and create a
   token (account or user token; either works).
2. Permissions: **Object Read & Write**. Scope: specific buckets only,
   `house-manager-tfstate`. Set a TTL if you want an expiry.
3. The result page shows the S3 credentials once. Paste them:

   | Shown as | GitHub secret |
   |---|---|
   | Access Key ID | `R2_ACCESS_KEY_ID` |
   | Secret Access Key | `R2_SECRET_ACCESS_KEY` |

   Ignore the token value and the endpoint on that page: CI builds the
   endpoint from `CLOUDFLARE_ACCOUNT_ID`.

### 3. Tokens

**Cloudflare API token** → `CLOUDFLARE_API_TOKEN`

1. **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Permissions:

   | Scope | Permission | Level | Why |
   |---|---|---|---|
   | Account | Cloudflare Pages | Edit | the Pages project, build settings, env vars |
   | Account | Workers R2 Storage | Edit | the state bucket resource (the backend itself uses the R2 key) |
   | Account | Account Settings | Read | only if the Bootstrap check's verify step needs it |

   Only if you set `pages_custom_domain` on a Cloudflare zone and the plan
   asks for it: add Zone → DNS → Edit, for that one zone.
3. Account Resources: **Include → your account** (just the one).
4. TTL: set an end date (for example 6 months).
5. Create, copy once, paste.

**Supabase access token** → `SUPABASE_ACCESS_TOKEN`

1. [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) → **Generate new token**, named `house-manager-infra`.
2. It is account-wide (no scopes): it can reach every project in your
   account. Choose an expiry if the page offers one; otherwise rotate on a
   calendar reminder.
3. If push notifications are already set up, this secret exists (the
   Database migrations workflow deploys `send-push` with it). Replace it with
   the new token so it has an expiry; both workflows use the same secret.

**GitHub fine-grained PAT** → `GH_ADMIN_TOKEN`

1. Your GitHub **Settings → Developer settings → Personal access tokens →
   Fine-grained tokens → Generate new token**.
2. Resource owner: your account. Expiration: set one (for example 90 days).
3. Repository access: **Only select repositories → house-manager**.
4. Repository permissions:

   | Permission | Access | Why |
   |---|---|---|
   | Administration | Read and write | branch protection on `main` |
   | Secrets | Read and write | the app's Actions secrets |
   | Metadata | Read | required by GitHub |

   Nothing else.

### 4. age key

```bash
mkdir -p ~/.config/sops/age
age-keygen -o ~/.config/sops/age/keys.txt     # prints "Public key: age1..."
```

1. Put the public key in `infra/.sops.yaml`, replacing `age1REPLACE_ME`.
2. Save the whole `keys.txt` in your password manager. Without it, nobody can
   decrypt `secrets.enc.yaml`.
3. Store the private key as `SOPS_AGE_KEY`, straight from the file:
   ```bash
   grep '^AGE-SECRET-KEY-' ~/.config/sops/age/keys.txt | gh secret set SOPS_AGE_KEY --repo <owner>/house-manager
   ```

On macOS, sops looks in `~/Library/Application Support/sops/age/keys.txt`;
`encrypt-secrets.sh` also finds `~/.config/...`, and for other tools
`export SOPS_AGE_KEY_FILE=~/.config/sops/age/keys.txt`.

### 5. State passphrase → `TF_STATE_PASSPHRASE`

Generate a random string of 32+ characters in your password manager (at least
16 is required), save it there, and paste it into `TF_STATE_PASSPHRASE`.
OpenTofu derives the state and plan encryption key from it
(`encryption.tf`). Losing it makes the state unreadable (recovery below).

### 6. `CLOUDFLARE_ACCOUNT_ID`

The account ID is in the dashboard URL (`dash.cloudflare.com/<account_id>/...`)
and on the account's overview page. Paste it into the `CLOUDFLARE_ACCOUNT_ID`
secret, and keep it for step 8.

### 7. Encrypt the app secrets

Gather the values first (`infra/secrets.example.yaml` says where each comes
from). Reuse the live ones: the current VAPID pair (new keys make every phone
turn notifications on again), the current `PUSH_SECRET`, the Google client
and the database password.

On a new branch:

```bash
git switch -c infra-bootstrap
infra/scripts/encrypt-secrets.sh            # asks for each value, validates, encrypts
infra/scripts/encrypt-secrets.sh --check    # decrypts to /dev/null, lists the keys
git add infra/.sops.yaml infra/secrets.enc.yaml
git commit -m "infra: bootstrap secrets"
```

The script refuses invalid values (a `VAPID_SUBJECT` without `mailto:`, a
padded or truncated key, a short push secret, a non-postgres URL) without
printing them. Values never appear on the command line.

### 8. Fill `prod.auto.tfvars`

Replace every `REPLACE_ME`. The values must match what exists today exactly;
a wrong name or region makes the plan want to replace a resource.

| Variable | Where |
|---|---|
| `cloudflare_account_id` | step 6 |
| `pages_project_name` | Workers & Pages, the project's name (may differ from the `*.pages.dev` subdomain) |
| `pages_custom_domain` | `""`, or your custom domain |
| `supabase_project_ref` | the `<ref>` in the Project URL (also on the project's general settings page) |
| `supabase_organization_id` | `npx supabase orgs list` (ID column), or the organization's settings page |
| `supabase_project_name` | the project's name in the dashboard |
| `supabase_region` | `npx supabase projects list` (REGION column); Frankfurt is `eu-central-1` |

`github_owner`, `github_repository`, `production_branch`, `state_bucket_name`
and `extra_redirect_urls` are already set. Commit.

### 9. Run the Bootstrap check

Push the branch, then **Actions → Bootstrap check → Run workflow**, on that
branch. It is read-only: it checks that
every bootstrap secret exists and that each token is accepted by its
provider. A failure names the secret or token to fix. Continue only when it
is green.

### 10. Open a PR and read the plan

Open a PR from the branch. The **infra** workflow (`infra.yml`) runs fmt,
validate (OpenTofu and Terraform), tflint, trivy and `plan`, and posts the plan
as a PR comment. Read it as described next. Merging applies exactly that plan.

## First import

`imports.tf` adopts the existing resources. The first plan should show
**imports, and in-place updates only where values cannot be read back**:

| Expected diff | Why |
|---|---|
| `supabase_edge_function_secrets`: update | the API returns no values after import; apply re-sets the same values |
| `github_actions_secret`: update | GitHub never returns secret values; apply re-sets them |
| `supabase_settings` (auth): Google secret | it is returned hashed; apply re-sets it |
| `cloudflare_pages_project`: env vars | secret-typed values cannot be read; `VITE_*` become plain text, as intended |
| `supabase_settings` (auth): in-place update | the import reads the whole auth config; the code manages only its own keys. The diff prints as `(sensitive value)` because it holds the Google secret, so read the `auth_site_url` and `auth_redirect_urls` outputs instead |
| `supabase_edge_function_secrets`: removals | any Edge Function secret other than the four VAPID/push ones is deleted |
| `terraform_data.guards`: create | a no-op resource that carries the value checks (VAPID format, `mailto:`) |

Anything else is drift between the dashboards and the code: a redirect URL,
the Site URL, a build setting. Decide per line: fix the code (or
`prod.auto.tfvars`) if the dashboard is right, keep the diff if the code is
right.

**Before the first plan:** the Cloudflare provider cannot import a Pages
project that has a variable of type *Secret*. On the project's variables page,
change every Secret variable to *Text* (or delete it; the code re-creates it).
None of the app's variables is a secret: they all end up in the public bundle.

**If the plan wants to replace or destroy anything: STOP. Do not merge.**

- `prevent_destroy` turns most of these into a plan error ("Instance cannot be
  destroyed"). That is the guard working; do not remove it.
- Find the attribute marked `# forces replacement`. Usually a value in
  `prod.auto.tfvars` differs from reality (project name, region, organization
  ID, account ID). Fix the value, push, and read the new plan.
- If the real value is right and the provider still forces replacement, add
  that attribute to the module's `lifecycle { ignore_changes }`, never to a
  workaround that recreates.
- **Never apply a replace of the Supabase project.** It deletes the database
  and every row in it. No `state rm` plus re-create either.

After the first apply: open the app, sign in with Google, send a test
notification. From now on the next plans should be empty unless you change
something. GitHub secrets are the bootstrap set plus the app's own
(`SUPABASE_DB_URL`, `SUPABASE_PROJECT_REF`), which IaC now owns. Change those
through `secrets.enc.yaml`, not the GitHub page: the next apply overwrites
manual edits, and so does it for anything else managed here.

## Rotation

General pattern: create the new credential, replace the GitHub secret, run
**Bootstrap check**, then revoke the old one. No PR needed for items 2–5.

| Item | Rotate |
|---|---|
| 1 Bucket | Not rotated. |
| 2 R2 key | Create a new R2 token (same scope), replace both `R2_*` secrets, run the check, delete the old token. |
| 3 Cloudflare token | Roll it on the API Tokens page (or create a new one with the same permissions), replace `CLOUDFLARE_API_TOKEN`, check, delete the old one. |
| 4 Supabase token | Generate a new token, replace `SUPABASE_ACCESS_TOKEN` (shared with Database migrations), check, delete the old one. |
| 5 GitHub PAT | Regenerate it on the token's page (keeps the permissions) or create a new one, replace `GH_ADMIN_TOKEN`, check. |
| 6 age key | See below. |
| 7 Passphrase | See below. |

**age key.** CI must be able to decrypt `main` at every moment, so the file
is encrypted for both keys before the secret changes. Run the sops commands
from `infra/` (sops looks for `.sops.yaml` in the current directory and its
parents).

1. `age-keygen -o ~/.config/sops/age/new.txt`, and append it to `keys.txt`
   (sops tries every identity in that file).
2. Add the new public key to `.sops.yaml`, comma separated next to the old one.
   `sops updatekeys secrets.enc.yaml`, then `sops rotate -i secrets.enc.yaml`
   (new data key). PR, merge (the plan is empty).
3. Replace `SOPS_AGE_KEY` with the new private key, run the check, update the password manager.
4. Remove the old public key from `.sops.yaml`, `sops updatekeys secrets.enc.yaml`, PR, merge.
   Then drop the old identity from `keys.txt`.
5. If the old key leaked: git history still decrypts with it, so also rotate the values (next table).

**State passphrase.** The state records the name of the key provider that
encrypted it, so a new passphrase gets a new name (`state` → `v2` → `v3`).
Do steps 2–4 in one sitting: between them, CI cannot read the state.

1. Locally, edit `encryption.tf`: keep the current key provider for reading,
   now fed by the old passphrase, and add the new one for writing.
   ```hcl
   variable "state_passphrase_old" {   # temporary
     type      = string
     sensitive = true
   }

   # inside terraform { encryption { ... } }:
   key_provider "pbkdf2" "state" {
     passphrase = var.state_passphrase_old
   }
   method "aes_gcm" "state" {
     keys = key_provider.pbkdf2.state
   }
   key_provider "pbkdf2" "v2" {
     passphrase = var.state_passphrase
   }
   method "aes_gcm" "v2" {
     keys = key_provider.pbkdf2.v2
   }
   state {                              # the same for plan
     method   = method.aes_gcm.v2
     enforced = true
     fallback {
       method = method.aes_gcm.state
     }
   }
   ```
2. With `TF_VAR_state_passphrase_old` = current, `TF_VAR_state_passphrase` = new and
   the credentials from `README.md`, run `tofu apply -refresh-only`. The state is
   rewritten with the new key.
3. Set `TF_STATE_PASSPHRASE` to the new value and update the password manager.
4. Reduce `encryption.tf` to the `v2` key provider and method only (no fallback, no
   `state_passphrase_old`), commit, PR (the plan is empty), merge.

**Values in `secrets.enc.yaml`** (each is `encrypt-secrets.sh --set KEY`, then a PR; the plan
shows where the new value goes):

| Key | Rotate |
|---|---|
| `vapid_public_key` + `vapid_private_key` | `npx web-push generate-vapid-keys`, set both. After apply and the Pages build, every phone turns notifications on again. |
| `vapid_subject` | Set it. |
| `push_secret` | Set it (empty input on `--set` generates one). Apply updates the function secret and CI syncs the Vault copy; pushes may fail briefly in between. |
| `google_client_id` / `google_client_secret` | Add a new client secret on the OAuth client's page, set it, apply, then delete the old secret there. |
| `supabase_db_password` + `supabase_db_url` | Reset the password in the project's database settings first, then set both. Apply updates `SUPABASE_DB_URL`. Update any home ingest setup too. |

## Disaster recovery

The code rebuilds all configuration. Data is not part of this: it lives in
the database, and database backups are a separate topic.

| What was lost | Recover |
|---|---|
| GitHub secrets (or the repo) | Recreate items 2–7 (tokens are new; age key and passphrase from the password manager), run Bootstrap check, then an apply restores everything else. |
| The state (bucket emptied, or passphrase lost) | Create an empty bucket (or a new passphrase), then plan: `imports.tf` adopts every resource again. Continue as in "First import". |
| The age key, with no copy | `secrets.enc.yaml` is unreadable. New age key (step 4), then `encrypt-secrets.sh --force` with new values: new VAPID pair, new push secret, new Google client secret, reset database password. |
| A leaked token | Revoke it at the provider first, then rotate. |
| A Pages project or settings changed by hand | The next plan shows it; apply puts the code back. |
| Everything | Recreate items 1–7, restore the database from a backup, apply. |

Keep in the password manager: `keys.txt` (age), the state passphrase. Tokens
can always be regenerated.

## After OIDC and a secret manager

GitHub Actions can authenticate to Vault, OpenBao or Infisical per run with
a short-lived OIDC token (see `SECRETS.md`). Then:

| Item | Today | After |
|---|---|---|
| 1 Bucket | manual | same |
| 2 R2 key | GitHub secret | GitHub secret, or in the secret manager |
| 3 Cloudflare token | GitHub secret | in the secret manager |
| 4 Supabase token | GitHub secret | in the secret manager |
| 5 GitHub PAT | GitHub secret | in the secret manager, or a GitHub App |
| 6 age key | GitHub secret | **gone** |
| 7 Passphrase | GitHub secret | GitHub secret, or in the secret manager |
| + secret manager access | – | an OIDC trust (role, identity ID): config, not a secret |

Layer zero shrinks to the bucket, the R2 key, the passphrase and the OIDC
trust: 3–4 items.
