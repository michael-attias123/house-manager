# Hosting role, Cloudflare Pages implementation: the Pages project (Git
# builds from GitHub, PR previews), its build-time env vars for production
# and preview, and an optional custom domain.
# Interface (shared by any hosting module): see variables.tf and outputs.tf.

resource "cloudflare_pages_project" "this" {
  account_id        = var.account_id
  name              = var.project_name
  production_branch = var.production_branch

  build_config = {
    root_dir        = var.root_dir
    build_command   = var.build_command
    destination_dir = var.output_dir
  }

  source = {
    type = "github"
    config = {
      owner                          = var.github_owner
      repo_name                      = var.github_repository
      production_branch              = var.production_branch
      production_deployments_enabled = true
      # Every branch and PR gets a preview URL.
      preview_deployment_setting = "all"
      pr_comments_enabled        = true
    }
  }

  # Identical variables in both environments, so a preview builds like
  # production.
  deployment_configs = {
    production = {
      env_vars = local.env_vars
    }
    preview = {
      env_vars = local.env_vars
    }
  }

  lifecycle {
    precondition {
      condition     = length(setintersection(keys(var.env_vars), nonsensitive(keys(var.secret_env_vars)))) == 0
      error_message = "A variable name is in both env_vars and secret_env_vars."
    }

    # Deleting the project would take the app offline and free its
    # pages.dev name. name and account_id force a replacement in the
    # provider; with this, such a change fails the plan instead.
    prevent_destroy = true
  }
}

resource "cloudflare_pages_domain" "this" {
  for_each = toset(var.custom_domain == "" ? [] : [var.custom_domain])

  account_id   = var.account_id
  project_name = cloudflare_pages_project.this.name
  name         = each.key
}

locals {
  # Names are not secret; only the values of secret_env_vars are. Unwrapping
  # the names keeps the plan readable.
  env_vars = merge(
    { for name, value in var.env_vars : name => { type = "plain_text", value = value } },
    { for name in nonsensitive(keys(var.secret_env_vars)) : name => { type = "secret_text", value = var.secret_env_vars[name] } },
  )

  # e.g. house-manager-9y8.pages.dev (Cloudflare adds a suffix when the name
  # is taken, which is why this is read back instead of assumed).
  subdomain = cloudflare_pages_project.this.subdomain
  url       = var.custom_domain == "" ? "https://${local.subdomain}" : "https://${var.custom_domain}"
}
