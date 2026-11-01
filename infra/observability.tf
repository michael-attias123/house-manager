# Monitoring: Grafana Cloud (metrics, traces, Faro, alerting, dashboards) and
# Synthetic Monitoring. Everything here has count 0 while
# observability_enabled is false, so main stays plannable without any
# Grafana token (versions.tf explains the providers).
#
# Dashboards and alerts are not written here: they are files in
# observability/ at the repo root (GitOps). Git Sync pulls the dashboards;
# this configuration renders the alert YAML into provisioned rule groups.
# .github/workflows/observability-sync.yml re-applies these two modules on a
# schedule, so a hand edit in Grafana is reverted.

locals {
  observability = var.observability_enabled
  uptime        = var.observability_enabled && var.uptime_enabled

  # The stack is looked up, never managed: nothing here can delete the one
  # free stack. null while monitoring is off.
  grafana_stack = one(data.grafana_cloud_stack.this[*])

  # Known before the hosting module is read, which the Faro app needs (the
  # Pages env vars in turn need the Faro URL). checks.tf compares the two.
  app_origin = var.pages_custom_domain != "" ? "https://${var.pages_custom_domain}" : "https://${var.pages_subdomain}.pages.dev"

  # host:port and database of the Session pooler, from supabase_db_url. Not
  # secret (the password is the part that is); "" when the URL has another shape.
  db_url_match = try(regex("^postgres(?:ql)?://[^@/\\s]+@([^/\\s]+)/([^?\\s]+)", local.secrets.supabase_db_url), [])
  db_host      = length(local.db_url_match) == 2 ? nonsensitive(local.db_url_match[0]) : ""
  db_name      = length(local.db_url_match) == 2 ? nonsensitive(local.db_url_match[1]) : ""

  repo_url = "https://github.com/${var.github_owner}/${var.github_repository}"
}

data "grafana_cloud_stack" "this" {
  count    = local.observability ? 1 : 0
  provider = grafana.cloud

  slug = var.grafana_stack_slug
}

module "observability" {
  source = "./modules/observability/grafana_cloud"
  count  = local.observability ? 1 : 0

  providers = {
    grafana       = grafana
    grafana.cloud = grafana.cloud
  }

  stack = {
    id          = local.grafana_stack.id
    slug        = local.grafana_stack.slug
    region_slug = local.grafana_stack.region_slug
    url         = local.grafana_stack.url
    otlp_url    = local.grafana_stack.otlp_url
    sm_url      = local.grafana_stack.sm_url
  }

  app_name   = var.pages_project_name
  app_origin = local.app_origin

  # Supabase metrics endpoint, scraped with a dedicated secret key.
  metrics_url        = module.backend.metrics_url
  metrics_secret_key = module.backend.metrics_secret_key

  # SQL data source hm-postgres: the read-only grafana_reader role
  # (supabase/migrations/*_monitoring.sql), password set by scripts/sync-db-roles.sh.
  db_host     = local.db_host
  db_name     = local.db_name
  db_user     = "grafana_reader.${var.supabase_project_ref}"
  db_password = local.secrets.grafana_reader_password

  alert_email          = local.secrets.alert_email
  alert_webhook_url    = "${module.backend.api_url}/functions/v1/alert-hook"
  alert_webhook_secret = local.secrets.alert_webhook_secret

  # observability/ at the repo root: alerts/, alerting/, dashboards/.
  config_dir       = "${path.root}/../observability"
  runbook_base_url = "${local.repo_url}/blob/${var.production_branch}/docs/setup.md"

  dashboards_via_git_sync = var.dashboards_via_git_sync
  git_sync = {
    repository_url = local.repo_url
    branch         = var.production_branch
    path           = "observability/dashboards"
    token_version  = var.gitsync_token_version
  }
  git_sync_token = local.secrets.gitsync_github_token
}

module "uptime" {
  source = "./modules/uptime/grafana_synthetics"
  count  = local.uptime ? 1 : 0

  providers = {
    grafana = grafana.sm
  }

  app_url          = "${local.app_origin}/"
  supabase_api_url = module.backend.api_url
  publishable_key  = local.publishable_key
  push_url         = module.backend.function_url
}
