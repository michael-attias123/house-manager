# Bootstrap: layer zero

Everything under `infra/` is managed by OpenTofu, except the few items here.
You create them once, by hand, in this order. After that, every change is a PR.

## The principle

**The chicken-and-egg problem.** Before OpenTofu can manage anything, it needs
three things it cannot create for itself:

1. **Credentials.** An API token per provider. A token created by `apply` cannot authorize that same `apply`.
2. **A place for the state.** A table in the project's own Postgres, reached by a login only you can give a password. Without state there is no `apply`, so the state cannot set up its own access.
3. **Keys to decrypt secrets.** The SOPS age key and the state passphrase. A key stored inside what it decrypts is useless.

**The rules for layer zero:**

| Rule | What it means here |
|---|---|
| Minimal | Only what truly cannot be automated: 6 items, plus 3 for monitoring (2–3 in all after OIDC and a secret manager). |
| Documented | This file: where to create each item, which permissions, where to paste it. |
| Least privilege | Each token gets only what IaC needs, on one account or repo, never admin. |
| Rotatable | Each item has rotation steps below, and an expiry where the provider allows one. |
| Verifiable | The read-only **Bootstrap check** workflow (`bootstrap-check.yml`) confirms every secret exists and every token works, before the first plan. |
| Import, don't recreate | Anything that already exists (the Pages and Supabase projects) is `import`ed (`imports.tf`), then described in code and protected by `prevent_destroy`. |

## Inventory

| # | Item | Created in | Stored in | Least privilege | After OIDC |
|---|---|---|---|---|---|
| 1 | State database login: the `tofu_state` role's password and its connection string | Supabase SQL editor + the Connect dialog | GitHub: `TF_STATE_PG_CONN` | the one table `tofu_state.states`, rows only (the migration grants nothing else) | stays (the backend needs it before anything else) |
| 2 | Cloudflare API token | My Profile → API Tokens | GitHub: `CLOUDFLARE_API_TOKEN` | Pages: Edit, one account | moves into the secret manager |
| 3 | Supabase access token | supabase.com/dashboard/account/tokens | GitHub: `SUPABASE_ACCESS_TOKEN` | not scopable; give it an expiry | moves into the secret manager |
| 4 | GitHub fine-grained PAT | GitHub, Developer settings | GitHub: `GH_ADMIN_TOKEN` | this repo: Administration, Secrets, Metadata | moves, or becomes a GitHub App |
| 5 | age key | `age-keygen`, locally | GitHub: `SOPS_AGE_KEY` + your password manager | – | **removed** (the secret manager replaces SOPS) |
| 6 | State passphrase | a random string | GitHub: `TF_STATE_PASSPHRASE` + your password manager | – | stays (state encryption) |
| 7 | Grafana Cloud access policy token (monitoring) | grafana.com → Access policies | GitHub: `GRAFANA_CLOUD_TOKEN` | one stack: read it, manage access policies, Connections, Frontend Observability; no `stacks:write` | moves into the secret manager |
| 8 | Grafana stack service account token (monitoring) | the stack → Administration → Service accounts | GitHub: `GRAFANA_SA_TOKEN` | the one stack, role Admin (data sources, alerting, Git Sync) | moves into the secret manager |
| 9 | Git Sync's GitHub access (monitoring) | GitHub, Developer settings | `gitsync_github_token` in `secrets.enc.yaml` | this repo: Contents, Pull requests, Webhooks (read and write), Metadata | the GitHub App (Git Sync connection) |
| – | Google OAuth client | Google Cloud console | values in `secrets.enc.yaml` | – | always manual (no API) |

Items 7–9 are needed only for monitoring. While `observability_enabled` is
`false` in `prod.auto.tfvars`, nothing requires them, and CI does not pass
them to OpenTofu even when they exist (the Bootstrap check still tests them,
as warnings).

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

### 1. State database login → `TF_STATE_PG_CONN`

The state lives in this project's own database, in the table
`tofu_state.states`. The migration `20261028000100_tofu_state.sql` (applied
by the Database migrations workflow) creates it with a role `tofu_state`
that can read and write that one table and nothing else, and that cannot log
in yet. No storage account or credit card is needed. OpenTofu encrypts the
state before writing it, so the table holds ciphertext only.

1. Supabase → **SQL Editor**. Generate a long random password in your
   password manager, then run:
   ```sql
   alter role tofu_state with login password '<the password>';
   ```
   The Supabase SQL editor may keep a query history: clear that entry, or
   rotate the password once afterwards (see Rotation) from a local `psql`.
2. Click **Connect** on the project's page and copy the **Session pooler**
   string (port **5432**). Not the Transaction pooler (6543): it hands each
   statement to a different connection and the state lock is lost. Not the
   Direct connection either: it is IPv6-only, which GitHub runners cannot reach.
3. In that string, replace the user `postgres.<ref>` with
   `tofu_state.<ref>` and the password with the one from step 1:
   ```
   postgresql://tofu_state.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
   ```
   A password with `@`, `:`, `/` or `#` has to be URL-encoded there; the
   simplest is a password of letters and digits only.
4. Paste it into `TF_STATE_PG_CONN`.

A free Supabase project pauses after a week without activity. The app and
the daily price update keep it awake; if it ever pauses, plans fail until it
is resumed in the dashboard. Nothing is lost.

### 2. Tokens

**Cloudflare API token** → `CLOUDFLARE_API_TOKEN`

1. **My Profile → API Tokens → Create Token → Create Custom Token**.
2. Permissions:

   | Scope | Permission | Level | Why |
   |---|---|---|---|
   | Account | Cloudflare Pages | Edit | the Pages project, build settings, env vars |
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

### 3. age key

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

### 4. State passphrase → `TF_STATE_PASSPHRASE`

Generate a random string of 32+ characters in your password manager (at least
16 is required), save it there, and paste it into `TF_STATE_PASSPHRASE`.
OpenTofu derives the state and plan encryption key from it
(`encryption.tf`). Losing it makes the state unreadable (recovery below).

### 5. Encrypt the app secrets

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

### 6. Fill `prod.auto.tfvars`

Replace every `REPLACE_ME`. The values must match what exists today exactly;
a wrong name or region makes the plan want to replace a resource.

| Variable | Where |
|---|---|
| `cloudflare_account_id` | the dashboard URL (`dash.cloudflare.com/<account_id>/...`) or the account's overview page; 32 hex characters, not a secret |
| `pages_project_name` | Workers & Pages, the project's name (may differ from the `*.pages.dev` subdomain) |
| `pages_custom_domain` | `""`, or your custom domain |
| `supabase_project_ref` | the `<ref>` in the Project URL (also on the project's general settings page) |
| `supabase_organization_id` | `npx supabase orgs list` (ID column), or the organization's settings page |
| `supabase_project_name` | the project's name in the dashboard |
| `supabase_region` | `npx supabase projects list` (REGION column); Frankfurt is `eu-central-1` |

`github_owner`, `github_repository`, `production_branch` and
`extra_redirect_urls` are already set. Commit.

### 7. Run the Bootstrap check

Push the branch, then **Actions → Bootstrap check → Run workflow**, on that
branch. It is read-only: it checks that
every bootstrap secret exists, that each token is accepted by its
provider, and that `TF_STATE_PG_CONN` logs in as `tofu_state` and can hold
the state lock. A failure names the secret or token to fix. Continue only when it
is green.

### 8. Open a PR and read the plan

Open a PR from the branch. The **infra** workflow (`infra.yml`) runs fmt,
validate (OpenTofu and Terraform), tflint, trivy and `plan`, and posts the plan
as a PR comment. Read it as described next. Merging applies exactly that plan.

## Monitoring (items 7–9)

Do these once the rest works. The stack itself is created by hand and only
looked up by the code, so nothing in `infra/` can delete it.

1. Sign up at grafana.com (Free, no card) and create the stack in an EU
   region. Put its slug (the `<slug>` of `https://<slug>.grafana.net`) in
   `prod.auto.tfvars` as `grafana_stack_slug`. Sign in to the stack once and
   turn on 2FA for your Grafana login: alert emails go to that address.
2. Check Git Sync is offered: in the stack, **Administration → Provisioning**
   lists Git Sync with a GitHub option. If not, set
   `dashboards_via_git_sync = false` (OpenTofu applies the dashboards
   instead) and skip item 9.

### 7. Grafana Cloud access policy token → `GRAFANA_CLOUD_TOKEN`

1. grafana.com → **My Account → Security → Access Policies → Create access policy**,
   named `house-manager-infra`.
2. Realm: the stack. If the portal requires the organization for the
   `accesspolicies` scopes, choose the organization (a free one has a single stack).
3. Scopes: `stacks:read`; `accesspolicies:read`, `accesspolicies:write`,
   `accesspolicies:delete`; `integration-management:read`,
   `integration-management:write`; `frontend-observability:read`,
   `frontend-observability:write`, `frontend-observability:delete`. No
   `stacks:write`: the token cannot create or delete stacks.
4. **Add token**, expiry 180 days, copy it once, and
   `gh secret set GRAFANA_CLOUD_TOKEN --repo <owner>/house-manager`.

OpenTofu uses it for the Cloud API, the Connections API (metrics scrape job)
and Frontend Observability (`infra/scripts/grafana-env.sh` maps it).

### 8. Stack service account token → `GRAFANA_SA_TOKEN`

1. In the stack: **Administration → Users and access → Service accounts →
   Add service account** `house-manager-infra`, role **Admin** (data sources,
   alerting provisioning and Git Sync need it).
2. **Add service account token**, expiry 90 days, copy it, and
   `gh secret set GRAFANA_SA_TOKEN --repo <owner>/house-manager`.

### 9. Git Sync's GitHub access → `gitsync_github_token`

Grafana Git Sync reads `observability/dashboards` and opens a PR for every
dashboard saved in the UI. Until the GitHub App planned for secret rotation
exists, it uses a fine-grained token:

1. GitHub **Settings → Developer settings → Fine-grained tokens → Generate
   new token**, named `house-manager-gitsync`, expiration 1 year at most.
2. Repository access: **Only select repositories → house-manager**.
3. Repository permissions: **Contents**, **Pull requests** and **Webhooks**:
   Read and write (Metadata: Read is added by GitHub). Nothing else.
4. `infra/scripts/encrypt-secrets.sh --set gitsync_github_token`, commit,
   PR. The token is a write-only argument (never stored in the state): after
   replacing it later, also bump `gitsync_token_version` in `prod.auto.tfvars`.

The Git Sync connection is fully code (`grafana_apps_provisioning_repository_v0alpha1`
in `modules/observability/grafana_cloud/gitsync.tf`): no step in the
Provisioning screen.

### Turning monitoring on

1. Add the other monitoring keys:
   `encrypt-secrets.sh --set alert_email` (your Grafana login address),
   `--set alert_webhook_secret` and `--set grafana_reader_password` (an empty
   line generates each). Run **Bootstrap check**: the Grafana lines are green.
2. The monitoring migration (role `grafana_reader`, schema `monitoring`) has
   run (Database migrations workflow).
3. **PR 1:** `observability_enabled = true`. The plan creates only: access
   policies and tokens, SM installation, Faro app, scrape job, the
   `hm-postgres` data source, contact points, the alerts folder, rule groups,
   policy, the Git Sync repository, the `grafana_metrics` Supabase key, and
   adds `VITE_FARO_URL`, three function secrets and two Actions secrets.
   After the apply, `sync-db-roles.sh` gives `grafana_reader` its login.
4. **PR 2:** `uptime_enabled = true`: the three checks. It is a second PR
   because the `sm` provider needs the SM token that PR 1 created.
5. The home dashboard is set by the first plan that finds the overview
   (Git Sync creates dashboards asynchronously): the next reconcile, within
   30 minutes.
6. When the `observability` and `functions` CI jobs run on main, set
   `require_observability_checks = true` (branch protection).

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
**Bootstrap check**, then revoke the old one. No PR needed for items 1–4.

| Item | Rotate |
|---|---|
| 1 State login | From a local `psql` as postgres (or the SQL editor): `alter role tofu_state password '<new>'`, replace `TF_STATE_PG_CONN`, run the check. The old password stops working at once, so do it when no infra run is in progress. |
| 2 Cloudflare token | Roll it on the API Tokens page (or create a new one with the same permissions), replace `CLOUDFLARE_API_TOKEN`, check, delete the old one. |
| 3 Supabase token | Generate a new token, replace `SUPABASE_ACCESS_TOKEN` (shared with Database migrations), check, delete the old one. |
| 4 GitHub PAT | Regenerate it on the token's page (keeps the permissions) or create a new one, replace `GH_ADMIN_TOKEN`, check. |
| 5 age key | See below. |
| 6 Passphrase | See below. |
| 7 Grafana Cloud token | Add a new token to the same access policy (180 days), replace `GRAFANA_CLOUD_TOKEN`, check, delete the old token. |
| 8 Grafana SA token | Add a new token to the service account (90 days), replace `GRAFANA_SA_TOKEN`, check, delete the old one. |
| 9 Git Sync token | Regenerate it, `encrypt-secrets.sh --set gitsync_github_token`, bump `gitsync_token_version` in `prod.auto.tfvars`, PR. |

**Minted by OpenTofu** (no person sees them):

| Credential | Rotate |
|---|---|
| Edge and CI OTLP tokens (`grafana_cloud_access_policy_rotating_token`) | Automatic: 90 days, renewed inside the last 14. The weekly drift check shows the replacement; apply it with **Actions → Infrastructure → Run workflow → apply main** (or the next merge). The old token is not deleted: it works until it expires, at least 14 days later, which covers the time until the new one reaches the function and Actions secrets. |
| SM publisher token (`grafana_cloud_access_policy_token.sm_publisher`) | By hand, rarely: it feeds the SM installation and the `sm` provider. PR A: `uptime_enabled = false` and a new `name` for the token (it and the installation are replaced); PR B: `uptime_enabled = true`. |
| Supabase metrics key (`supabase_apikey.grafana_metrics`) | Change its `name` in `modules/backend/supabase` in a PR: the new key is created and handed to the scrape job before the old one is deleted. |

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
| `grafana_reader_password` | Set it (empty input generates one). The apply updates the Grafana data source and `sync-db-roles.sh` the role; queries fail for the seconds in between. |
| `alert_webhook_secret` | Set it (empty input generates one). The apply updates the contact point and the function secret together. |
| `alert_email` | Set it; it must be a user of the Grafana stack. |

## Disaster recovery

The code rebuilds all configuration. Data is not part of this: it lives in
the database, and database backups are a separate topic.

| What was lost | Recover |
|---|---|
| GitHub secrets (or the repo) | Recreate items 1–6 (tokens and the state password are new; age key and passphrase from the password manager), run Bootstrap check, then an apply restores everything else. |
| The state (rows deleted, or passphrase lost) | `delete from tofu_state.states;` (or a new passphrase), then plan: `imports.tf` adopts every resource again. Continue as in "First import". |
| The Supabase project itself | The state went with it (it lives in that database). Restore or recreate the project, run the migrations, redo item 1, then plan: `imports.tf` adopts everything again. |
| The age key, with no copy | `secrets.enc.yaml` is unreadable. New age key (step 3), then `encrypt-secrets.sh --force` with new values: new VAPID pair, new push secret, new Google client secret, reset database password. |
| A leaked token | Revoke it at the provider first, then rotate. |
| A Pages project or settings changed by hand | The next plan shows it; apply puts the code back. |
| The Grafana stack | New stack (its slug in `prod.auto.tfvars`), new items 7 and 8. Drop the lost objects from the state once, locally with the credentials from `README.md`: `tofu state rm 'module.observability' 'module.uptime'`. Then a PR with `uptime_enabled = false` (everything is created again), then one with `uptime_enabled = true`. Dashboards and alerts come back from `observability/`; metrics, traces and alert history are lost. |
| Grafana items 7–9 leaked | Delete the token at grafana.com / in the stack / on GitHub first, then create a new one as above. Minted tokens: a PR that renames their `name_prefix` replaces them. |
| Everything | Restore the database from a backup, recreate items 1–6 (and 7–9), apply. |

Keep in the password manager: `keys.txt` (age), the state passphrase. Tokens
can always be regenerated.

## After OIDC and a secret manager

GitHub Actions can authenticate to Vault, OpenBao or Infisical per run with
a short-lived OIDC token (see `SECRETS.md`). Then:

| Item | Today | After |
|---|---|---|
| 1 State login | GitHub secret | GitHub secret, or in the secret manager |
| 2 Cloudflare token | GitHub secret | in the secret manager |
| 3 Supabase token | GitHub secret | in the secret manager |
| 4 GitHub PAT | GitHub secret | in the secret manager, or a GitHub App |
| 5 age key | GitHub secret | **gone** |
| 6 Passphrase | GitHub secret | GitHub secret, or in the secret manager |
| 7 Grafana Cloud token | GitHub secret | in the secret manager |
| 8 Grafana SA token | GitHub secret | in the secret manager |
| 9 Git Sync token | `secrets.enc.yaml` | a GitHub App and its `grafana_apps_provisioning_connection_v0alpha1` |
| + secret manager access | – | an OIDC trust (role, identity ID): config, not a secret |

Layer zero shrinks to the state login, the passphrase and the OIDC trust:
2–3 items.
