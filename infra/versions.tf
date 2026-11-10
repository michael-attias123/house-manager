# Tool and provider versions. Plain HCL that OpenTofu and Terraform both read.
# Provider credentials never appear here: each provider reads its token from
# the environment (see the comments below), so no secret is ever in code.
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.11"
    }
    sops = {
      source  = "carlpett/sops"
      version = "~> 1.4"
    }
    grafana = {
      source  = "grafana/grafana"
      version = "~> 4.53"
    }
    vault = {
      source  = "hashicorp/vault"
      version = "~> 5.13"
    }
  }
}

# CLOUDFLARE_API_TOKEN
provider "cloudflare" {}

# GITHUB_TOKEN: in CI an installation token of the house-manager-bot GitHub App
# (tofu-stack.yml github-app), locally `gh auth token`. The owner is not a credential.
provider "github" {
  owner = var.github_owner
}

# SUPABASE_ACCESS_TOKEN
provider "supabase" {}

# SOPS_AGE_KEY (or SOPS_AGE_KEY_FILE locally). Only the fallback module in
# modules/secrets/sops uses it (infra/SECRETS.md).
provider "sops" {}

# The shared Vault: VAULT_ADDR and VAULT_TOKEN from the environment (in CI the
# vault-env action logs in with the job's OIDC token; locally `vault login`).
# The JWT login's token may not create child tokens, so the provider uses it
# as it is.
provider "vault" {
  skip_child_token = true
}

# Grafana Cloud: three instances of one provider (observability.tf has the
# stack lookup they share). Tokens come from the environment only:
#   GRAFANA_CLOUD_ACCESS_POLICY_TOKEN       the GRAFANA_CLOUD_TOKEN secret (bootstrap item 7)
#   GRAFANA_CONNECTIONS_API_ACCESS_TOKEN    the same value
#   GRAFANA_FRONTEND_O11Y_API_ACCESS_TOKEN  the same value
#   GRAFANA_AUTH                            the GRAFANA_SA_TOKEN secret (bootstrap item 8)
#
# While observability_enabled is false every argument below is null and every
# Grafana resource has count 0. The provider then builds no API client (it
# only builds one for an argument that is set, and treats an empty env
# variable as unset), makes no request, and plans with no token at all.
# Arguments are null, never "": the provider rejects an empty url.

# Grafana Cloud API (grafana.com): the stack lookup, access policies and
# tokens, the Synthetic Monitoring installation, the Faro app.
provider "grafana" {
  alias = "cloud"
}

# The stack itself (<slug>.grafana.net): data source, folders, alerting, Git
# Sync, dashboards; plus the Connections API for the metrics scrape job.
provider "grafana" {
  url                 = local.observability ? "https://${var.grafana_stack_slug}.grafana.net/" : null
  stack_id            = local.observability ? tonumber(local.grafana_stack.id) : null
  connections_api_url = local.observability ? local.grafana_stack.connections_api_url : null
}

# Synthetic Monitoring API. Its token is minted by the SM installation in
# module.observability, so it is unknown until that exists: uptime_enabled
# stays false for the first apply (infra/BOOTSTRAP.md, item 7).
provider "grafana" {
  alias           = "sm"
  sm_url          = local.uptime ? local.grafana_stack.sm_url : null
  sm_access_token = local.uptime ? one(module.observability[*].sm_access_token) : null
}
