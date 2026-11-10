# Root inputs. Values live in prod.auto.tfvars (committed, nothing secret).
# Secrets do not come in as variables: they come from module.secrets
# (the shared Vault, kv/house-manager/*). state_passphrase is declared in encryption.tf.

variable "cloudflare_account_id" {
  description = "Cloudflare account id (32 hex characters, dashboard sidebar or URL)."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{32}$", var.cloudflare_account_id))
    error_message = "cloudflare_account_id must be 32 lowercase hex characters (Cloudflare dashboard -> Account home -> Account ID). Replace REPLACE_ME in prod.auto.tfvars."
  }
}

variable "pages_project_name" {
  description = "Name of the Cloudflare Pages project (not its pages.dev subdomain, which may have a suffix)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,57}$", var.pages_project_name))
    error_message = "pages_project_name must start with a lowercase letter or digit and contain only lowercase letters, digits and hyphens (at most 58 characters)."
  }
}

variable "pages_custom_domain" {
  description = "Custom domain for the Pages project, or \"\" for none (the app then lives on <subdomain>.pages.dev)."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition = var.pages_custom_domain == "" || can(regex(
      "^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,63}$", var.pages_custom_domain
    ))
    error_message = "pages_custom_domain must be \"\" or a lowercase host name such as app.example.com (no scheme, no path)."
  }
}

variable "github_owner" {
  description = "GitHub user or organization that owns the repository."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9](-?[A-Za-z0-9]){0,38}$", var.github_owner))
    error_message = "github_owner must be a GitHub user or organization name (letters, digits, single hyphens)."
  }
}

variable "github_repository" {
  description = "Repository name, without the owner."
  type        = string

  validation {
    condition     = can(regex("^[A-Za-z0-9._-]{1,100}$", var.github_repository)) && !strcontains(var.github_repository, "/")
    error_message = "github_repository must be the bare repository name (no owner/ prefix)."
  }
}

variable "production_branch" {
  description = "Branch that deploys to production and gets branch protection."
  type        = string
  default     = "main"

  validation {
    condition     = can(regex("^[A-Za-z0-9._/-]+$", var.production_branch))
    error_message = "production_branch must be a plain branch name."
  }
}

variable "supabase_project_ref" {
  description = "Supabase project ref: the <ref> in https://<ref>.supabase.co."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{20}$", var.supabase_project_ref))
    error_message = "supabase_project_ref must be the 20 lowercase letters of the project ref (Project Settings -> General -> Project ID). Replace REPLACE_ME in prod.auto.tfvars."
  }
}

variable "supabase_organization_id" {
  description = "Supabase organization slug (Organization settings, or the dashboard URL /org/<slug>)."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]*$", var.supabase_organization_id))
    error_message = "supabase_organization_id must be the organization slug (lowercase letters, digits, hyphens). Replace REPLACE_ME in prod.auto.tfvars."
  }
}

variable "supabase_project_name" {
  description = "Display name of the Supabase project. Managed: a change renames the project."
  type        = string

  validation {
    # A placeholder here would rename the live project, so it is an error.
    condition     = length(trimspace(var.supabase_project_name)) > 0 && !strcontains(var.supabase_project_name, "REPLACE_ME")
    error_message = "supabase_project_name must be the project's current display name (Supabase -> Project Settings -> General); a different value renames the project. Replace REPLACE_ME in prod.auto.tfvars."
  }
}

variable "supabase_region" {
  description = "Supabase region code, e.g. eu-central-1 (Frankfurt). Fixed after creation."
  type        = string

  validation {
    condition     = can(regex("^[a-z]{2}-[a-z]+-[0-9]$", var.supabase_region))
    error_message = "supabase_region must be an AWS-style region code such as eu-central-1."
  }
}

variable "extra_redirect_urls" {
  description = "Auth redirect URLs beyond the ones derived from the hosting URL (local development)."
  type        = list(string)
  default     = ["http://localhost:5173/**"]
  nullable    = false

  validation {
    condition     = alltrue([for u in var.extra_redirect_urls : can(regex("^https?://[^\\s,]+$", u))])
    error_message = "Each extra_redirect_urls entry must be an http(s) URL without spaces or commas."
  }
}

# ------------------------------------------------------------- observability
# Grafana Cloud monitoring (observability.tf, modules/observability,
# modules/uptime). Off until Phase 0 is done (BOOTSTRAP.md, items 7-9):
# while it is off nothing Grafana-related is planned and no Grafana token is
# needed.

variable "observability_enabled" {
  description = "Manage Grafana Cloud monitoring (metrics scrape, Faro, alerting, dashboards). Needs bootstrap items 7-9 and the observability secrets."
  type        = bool
  default     = false
  nullable    = false
}

variable "uptime_enabled" {
  description = "Manage the Synthetic Monitoring checks. Turn it on in the PR after the one that turned on observability_enabled: the SM token must exist before the sm provider can be configured."
  type        = bool
  default     = false
  nullable    = false

  validation {
    condition     = !var.uptime_enabled || var.observability_enabled
    error_message = "uptime_enabled needs observability_enabled = true (the checks run on the Grafana stack)."
  }
}

variable "grafana_stack_slug" {
  description = "Grafana Cloud stack slug: the <slug> in https://<slug>.grafana.net. Required when observability_enabled is true."
  type        = string
  default     = ""
  nullable    = false

  validation {
    condition     = var.grafana_stack_slug == "" || can(regex("^[a-z][a-z0-9-]{1,61}[a-z0-9]$", var.grafana_stack_slug))
    error_message = "grafana_stack_slug must be the stack's slug as in https://<slug>.grafana.net (lowercase letters, digits, hyphens), or \"\" while observability is off."
  }

  validation {
    condition     = !var.observability_enabled || var.grafana_stack_slug != ""
    error_message = "observability_enabled = true needs grafana_stack_slug (the <slug> of https://<slug>.grafana.net)."
  }
}

variable "pages_subdomain" {
  description = "The Pages project's pages.dev host name without .pages.dev (e.g. house-manager-9y8). Gives the app origin without reading the hosting module, which the Faro app needs; checks.tf compares the two."
  type        = string

  validation {
    condition     = can(regex("^[a-z0-9][a-z0-9-]{0,62}$", var.pages_subdomain))
    error_message = "pages_subdomain must be the <name> in https://<name>.pages.dev (lowercase letters, digits and hyphens)."
  }
}

variable "dashboards_via_git_sync" {
  description = "true: Grafana Git Sync pulls observability/dashboards from GitHub (needs the gitsync_github_token secret). false: the fallback, OpenTofu applies the same files as grafana_dashboard resources."
  type        = bool
  default     = true
  nullable    = false
}

variable "gitsync_token_version" {
  description = "Bump by one after changing gitsync_github_token: the token is write-only (never in state), so a new version is how a new value reaches Grafana."
  type        = number
  default     = 1
  nullable    = false

  validation {
    condition     = var.gitsync_token_version >= 1 && floor(var.gitsync_token_version) == var.gitsync_token_version
    error_message = "gitsync_token_version must be a whole number, 1 or more."
  }
}

variable "require_observability_checks" {
  description = "Add the ci.yml jobs observability and functions to the production branch's required status checks. Turn it on only once both jobs run on main, or every PR is blocked."
  type        = bool
  default     = false
  nullable    = false
}
