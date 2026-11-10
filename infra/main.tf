# Wiring. Each module is a role with a fixed interface (secrets, hosting,
# backend, repo); swapping a vendor means a new module with the same inputs
# and outputs and a changed `source` line here.

# The shared Vault (github.com/michael-attias123/shared-platform): the keys of
# kv/house-manager/app and kv/house-manager/monitoring, as one map. The SOPS
# module in modules/secrets/sops returns the same map from secrets.enc.yaml;
# it stays as the fallback until that file is removed (infra/SECRETS.md).
module "secrets" {
  source = "git::https://github.com/michael-attias123/shared-platform.git//modules/secrets-vault?ref=main"

  paths = ["house-manager/app", "house-manager/monitoring"]
}

locals {
  # The keys of kv/house-manager/app (shared-platform projects/house-manager.yaml lists them).
  secret_keys = [
    "vapid_public_key",
    "vapid_private_key",
    "vapid_subject",
    "push_secret",
    "google_client_id",
    "google_client_secret",
    "supabase_db_password",
    "supabase_db_url",
  ]

  # Keys only monitoring uses. Optional: checks.tf requires them only while
  # observability_enabled is true (gitsync_github_token only with Git Sync).
  optional_secret_keys = [
    "grafana_reader_password",
    "alert_webhook_secret",
    "alert_email",
    "gitsync_github_token",
  ]

  # A missing key becomes "" so that checks.tf reports it by name instead of
  # an "Invalid index" error.
  secrets = { for k in concat(local.secret_keys, local.optional_secret_keys) : k => lookup(module.secrets.values, k, "") }

  # Public by design: the browser gets it in the bundle. One value feeds both
  # Cloudflare (VITE_VAPID_PUBLIC_KEY) and Supabase (VAPID_PUBLIC_KEY).
  vapid_public_key = nonsensitive(local.secrets.vapid_public_key)

  # Public by design as well (the bundle, and the uptime check's apikey header).
  publishable_key = nonsensitive(module.backend.publishable_key)
}

module "hosting" {
  source = "./modules/hosting/cloudflare_pages"

  account_id        = var.cloudflare_account_id
  project_name      = var.pages_project_name
  production_branch = var.production_branch
  github_owner      = var.github_owner
  github_repository = var.github_repository
  root_dir          = "web"
  build_command     = "pnpm build"
  output_dir        = "dist"
  custom_domain     = var.pages_custom_domain
  # Build only when the app changed (the build reads nothing outside web/).
  build_watch_paths = ["web/*"]

  # Build-time values baked into the public bundle: plain text, not secrets.
  env_vars = merge(
    {
      VITE_SUPABASE_URL             = module.backend.api_url
      VITE_SUPABASE_PUBLISHABLE_KEY = local.publishable_key
      VITE_VAPID_PUBLIC_KEY         = local.vapid_public_key
      NODE_VERSION                  = "22"
      # Not a VITE_ variable: vite.config.ts compares it with Cloudflare's
      # CF_PAGES_BRANCH to tell production builds from previews.
      PRODUCTION_BRANCH = var.production_branch
    },
    # The Faro collector URL is public by design. Unset = no telemetry.
    local.observability ? { VITE_FARO_URL = one(module.observability[*].faro_collector_url) } : {},
  )
  secret_env_vars = {}
}

module "backend" {
  source = "./modules/backend/supabase"

  project_ref       = var.supabase_project_ref
  organization_id   = var.supabase_organization_id
  project_name      = var.supabase_project_name
  region            = var.supabase_region
  database_password = local.secrets.supabase_db_password

  # Never typed by hand: derived from where the app is actually hosted.
  site_url      = module.hosting.url
  redirect_urls = concat(module.hosting.redirect_urls, var.extra_redirect_urls)

  google_client_id     = local.secrets.google_client_id
  google_client_secret = local.secrets.google_client_secret

  # Read by supabase/functions/send-push, and with monitoring on by
  # functions/_shared/otel.ts (OTLP_*) and alert-hook (ALERT_WEBHOOK_SECRET).
  # Secrets not listed here are deleted by the apply.
  function_secrets = merge(
    {
      VAPID_PUBLIC_KEY  = local.vapid_public_key
      VAPID_PRIVATE_KEY = local.secrets.vapid_private_key
      VAPID_SUBJECT     = local.secrets.vapid_subject
      PUSH_SECRET       = local.secrets.push_secret
    },
    local.observability ? {
      OTLP_ENDPOINT        = one(module.observability[*].otlp_endpoint)
      OTLP_BASIC_AUTH      = one(module.observability[*].edge_otlp_basic_auth)
      ALERT_WEBHOOK_SECRET = local.secrets.alert_webhook_secret
    } : {},
  )

  # The key Grafana scrapes the metrics endpoint with.
  metrics_key_enabled = local.observability
}

module "repo" {
  source = "./modules/repo/github"

  repository = var.github_repository

  # No Actions secrets: workflows read theirs from the shared Vault with the
  # job's OIDC token (shared-platform's vault-env). Plain values only:
  actions_variables = {
    SUPABASE_PROJECT_REF = var.supabase_project_ref
  }

  protected_branch = var.production_branch
  # The jobs of .github/workflows/ci.yml. "changes" is required too: the
  # others are skipped when their area didn't change, and a skipped job
  # passes, so a failed change detection must block the merge itself.
  required_checks = concat(
    ["changes", "web", "database"],
    var.require_observability_checks ? ["observability", "functions"] : [],
  )
}
