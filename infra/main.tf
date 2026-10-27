# Wiring. Each module is a role with a fixed interface (secrets, hosting,
# backend, repo); swapping a vendor means a new module with the same inputs
# and outputs and a changed `source` line here.

module "secrets" {
  source = "./modules/secrets/sops"

  file = "${path.module}/secrets.enc.yaml"
}

locals {
  # The keys of secrets.enc.yaml (secrets.example.yaml documents them).
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

  # A missing key becomes "" so that checks.tf reports it by name instead of
  # an "Invalid index" error.
  secrets = { for k in local.secret_keys : k => lookup(module.secrets.values, k, "") }

  # Public by design: the browser gets it in the bundle. One value feeds both
  # Cloudflare (VITE_VAPID_PUBLIC_KEY) and Supabase (VAPID_PUBLIC_KEY).
  vapid_public_key = nonsensitive(local.secrets.vapid_public_key)
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

  # Build-time values baked into the public bundle: plain text, not secrets.
  env_vars = {
    VITE_SUPABASE_URL             = module.backend.api_url
    VITE_SUPABASE_PUBLISHABLE_KEY = nonsensitive(module.backend.publishable_key)
    VITE_VAPID_PUBLIC_KEY         = local.vapid_public_key
    NODE_VERSION                  = "22"
  }
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

  # Read by supabase/functions/send-push.
  function_secrets = {
    VAPID_PUBLIC_KEY  = local.vapid_public_key
    VAPID_PRIVATE_KEY = local.secrets.vapid_private_key
    VAPID_SUBJECT     = local.secrets.vapid_subject
    PUSH_SECRET       = local.secrets.push_secret
  }
}

module "repo" {
  source = "./modules/repo/github"

  repository = var.github_repository

  # App secrets only. The bootstrap secrets (provider tokens, state connection, age key,
  # state passphrase) are set by hand and never managed here.
  actions_secrets = {
    SUPABASE_DB_URL      = local.secrets.supabase_db_url
    SUPABASE_PROJECT_REF = var.supabase_project_ref
  }

  protected_branch = var.production_branch
  # The jobs of .github/workflows/ci.yml.
  required_checks = ["web", "database"]
}
