# Observability interface inputs. Another vendor is a sibling module with
# these same variables and outputs (infra/MIGRATING.md).
#
# Providers: the default `grafana` is the stack (url, auth, stack_id,
# connections_api_url); `grafana.cloud` is the Grafana Cloud API.

variable "stack" {
  description = "The Grafana Cloud stack (looked up by the root, never managed here)."
  type = object({
    id          = string
    slug        = string
    region_slug = string
    url         = string
    otlp_url    = string
    sm_url      = string
  })
}

variable "app_name" {
  description = "Short name for the app's objects (Faro app, scrape job)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,40}$", var.app_name))
    error_message = "app_name must be lowercase letters, digits and hyphens."
  }
}

variable "app_origin" {
  description = "Production origin of the app (https://host, no path): the only origin the Faro collector accepts."
  type        = string

  validation {
    condition     = can(regex("^https://[^\\s/]+$", var.app_origin))
    error_message = "app_origin must be an https:// origin without a path or trailing slash."
  }
}

variable "metrics_url" {
  description = "Prometheus endpoint to scrape (the backend's metrics endpoint)."
  type        = string
}

variable "metrics_secret_key" {
  description = "Basic auth password for metrics_url (user service_role)."
  type        = string
  sensitive   = true
}

variable "db_host" {
  description = "host:port of the Postgres connection for the SQL data source (Session pooler)."
  type        = string
}

variable "db_name" {
  description = "Database name."
  type        = string
}

variable "db_user" {
  description = "Read-only database user (grafana_reader.<ref> on the pooler)."
  type        = string
}

variable "db_password" {
  description = "Password of db_user."
  type        = string
  sensitive   = true
}

variable "alert_email" {
  description = "Where the email-owner contact point sends (on new free stacks, a user of the stack)."
  type        = string
  sensitive   = true
}

variable "alert_webhook_url" {
  description = "URL of the app-push contact point (the alert-hook Edge Function)."
  type        = string
}

variable "alert_webhook_secret" {
  description = "HMAC secret of the app-push contact point (alert-hook verifies it)."
  type        = string
  sensitive   = true
}

variable "config_dir" {
  description = "The GitOps directory (observability/ at the repo root): alerts/*.yaml, alerting/policies.yaml, alerting/mute-timings.yaml, dashboards/**.json. Missing files render nothing."
  type        = string
}

variable "runbook_base_url" {
  description = "Page that holds the runbook anchors; a rule's runbook X links to <this>#runbook-X."
  type        = string
}

variable "dashboards_via_git_sync" {
  description = "true: a Git Sync repository pulls the dashboards. false: grafana_dashboard resources apply the same files."
  type        = bool
  default     = true
  nullable    = false
}

variable "git_sync" {
  description = "Git Sync source: repository URL, branch, path, and the version of git_sync_token (bump it after changing the token)."
  type = object({
    repository_url = string
    branch         = string
    path           = string
    token_version  = number
  })
}

variable "git_sync_token" {
  description = "GitHub token for Git Sync (this repository only; Contents, Pull requests and Webhooks: read and write). Write-only: never stored in state."
  type        = string
  sensitive   = true
  default     = ""
  nullable    = false
}
