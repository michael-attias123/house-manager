# Guards against the mistakes that hand configuration used to make.
#
# Hard guards (plan fails): preconditions on terraform_data.guards. They read
# secret values, so no error message ever interpolates one.
# Soft guards (plan warns): check blocks, for things that are suspicious but
# not certainly wrong.
#
# Guards that need no code, by construction in main.tf:
# - one VAPID public key value feeds both Cloudflare and Supabase;
# - Site URL and Redirect URLs come from the hosting module's url, never typed;
# - VITE_* variables are plain_text in production and preview
#   (modules/hosting/cloudflare_pages).

resource "terraform_data" "guards" {
  lifecycle {
    precondition {
      condition     = alltrue([for k in local.secret_keys : local.secrets[k] != ""])
      error_message = "infra/secrets.enc.yaml must define a non-empty value for each of: ${join(", ", local.secret_keys)} (see infra/secrets.example.yaml)."
    }

    precondition {
      condition     = can(regex("^(mailto:[^@\\s]+@[^@\\s]+\\.[^@\\s]+|https://[^\\s]+)$", local.secrets.vapid_subject))
      error_message = "vapid_subject must start with mailto: (e.g. mailto:you@example.com) or https://, with no spaces. Apple and Google push services reject anything else."
    }

    # 65-byte uncompressed P-256 point -> 87 base64url characters, first byte
    # 0x04 -> first character "B". This is what `npx web-push
    # generate-vapid-keys` prints. The key is public, so its length may be shown.
    precondition {
      condition     = can(regex("^B[A-Za-z0-9_-]{86}$", local.vapid_public_key))
      error_message = "vapid_public_key must be the 87-character base64url public key from `npx web-push generate-vapid-keys` (only A-Z a-z 0-9 - _, no '=' padding, no spaces or line breaks); this one has ${length(local.vapid_public_key)} characters."
    }

    # 32-byte private scalar -> 43 base64url characters.
    precondition {
      condition     = can(regex("^[A-Za-z0-9_-]{43}$", local.secrets.vapid_private_key))
      error_message = "vapid_private_key must be the 43-character base64url private key from `npx web-push generate-vapid-keys` (no '=' padding, no spaces or line breaks)."
    }

    precondition {
      condition     = length(local.secrets.push_secret) >= 32 && can(regex("^[^\\s]+$", local.secrets.push_secret))
      error_message = "push_secret must be at least 32 characters with no whitespace (e.g. the output of `openssl rand -hex 32`)."
    }

    precondition {
      condition     = can(regex("^[0-9]+-[a-z0-9]+\\.apps\\.googleusercontent\\.com$", local.secrets.google_client_id))
      error_message = "google_client_id must be a Google OAuth Web client ID (<number>-<id>.apps.googleusercontent.com)."
    }

    precondition {
      condition     = can(regex("^postgres(ql)?://[^\\s]+$", local.secrets.supabase_db_url))
      error_message = "supabase_db_url must be a postgresql:// connection string with no spaces (Supabase -> Connect -> Session pooler)."
    }

    # Monitoring secrets: required only while observability_enabled is true,
    # so today's file (without them) passes.
    precondition {
      condition = !var.observability_enabled || alltrue([
        for k in local.observability_secret_keys : local.secrets[k] != ""
      ])
      error_message = "observability_enabled = true needs these keys in infra/secrets.enc.yaml: ${join(", ", local.observability_secret_keys)} (infra/scripts/encrypt-secrets.sh --set KEY; see infra/secrets.example.yaml)."
    }

    precondition {
      condition     = !var.observability_enabled || can(regex("^[^@\\s:]+@[^@\\s]+\\.[^@\\s]+$", local.secrets.alert_email))
      error_message = "alert_email must be a plain email address (no mailto:): the owner's Grafana login address."
    }

    precondition {
      condition     = !var.observability_enabled || (length(local.secrets.alert_webhook_secret) >= 32 && can(regex("^[^\\s]+$", local.secrets.alert_webhook_secret)))
      error_message = "alert_webhook_secret must be at least 32 characters with no whitespace (encrypt-secrets.sh --set generates one)."
    }

    # Letters and digits only: it travels in a connection string.
    precondition {
      condition     = !var.observability_enabled || can(regex("^[A-Za-z0-9]{24,}$", local.secrets.grafana_reader_password))
      error_message = "grafana_reader_password must be at least 24 letters and digits (encrypt-secrets.sh --set generates one)."
    }

    precondition {
      condition     = !(var.observability_enabled && var.dashboards_via_git_sync) || can(regex("^(github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{36,})$", local.secrets.gitsync_github_token))
      error_message = "gitsync_github_token must be a GitHub token (github_pat_... fine-grained, see BOOTSTRAP.md item 9), or set dashboards_via_git_sync = false."
    }

    precondition {
      condition     = !var.observability_enabled || (local.db_host != "" && local.db_name != "")
      error_message = "supabase_db_url must have the shape postgresql://user:password@host:port/database (the Grafana data source uses its host and database)."
    }
  }
}

locals {
  # The optional keys the current settings need.
  observability_secret_keys = concat(
    ["grafana_reader_password", "alert_webhook_secret", "alert_email"],
    var.dashboards_via_git_sync ? ["gitsync_github_token"] : [],
  )
}

check "faro_origin_matches_hosting" {
  assert {
    # The Faro collector accepts only this origin; pages_subdomain must match
    # the subdomain Cloudflare actually gave the project.
    condition     = module.hosting.url == local.app_origin
    error_message = "The app is served from ${module.hosting.url}, but pages_subdomain / pages_custom_domain give ${local.app_origin}: fix prod.auto.tfvars, or Faro rejects every production session."
  }
}

check "db_url_uses_session_pooler" {
  assert {
    # The direct connection is IPv6 only; GitHub-hosted runners cannot reach it.
    condition     = strcontains(local.secrets.supabase_db_url, ".pooler.supabase.com:5432/") && strcontains(local.secrets.supabase_db_url, "postgres.${var.supabase_project_ref}:")
    error_message = "supabase_db_url does not look like this project's Session pooler URL (user postgres.<ref>, host *.pooler.supabase.com, port 5432). The direct connection is IPv6 only and fails on GitHub Actions."
  }
}

check "no_placeholders" {
  assert {
    condition = length([
      for name, value in local.placeholder_inputs : name if strcontains(value, "REPLACE_ME")
    ]) == 0
    error_message = "prod.auto.tfvars still has REPLACE_ME in: ${join(", ", [for name, value in local.placeholder_inputs : name if strcontains(value, "REPLACE_ME")])}."
  }
}

locals {
  # Every non-secret root input that prod.auto.tfvars sets.
  placeholder_inputs = {
    cloudflare_account_id    = var.cloudflare_account_id
    pages_project_name       = var.pages_project_name
    pages_custom_domain      = var.pages_custom_domain
    github_owner             = var.github_owner
    github_repository        = var.github_repository
    production_branch        = var.production_branch
    supabase_project_ref     = var.supabase_project_ref
    supabase_organization_id = var.supabase_organization_id
    supabase_project_name    = var.supabase_project_name
    supabase_region          = var.supabase_region
    extra_redirect_urls      = join(",", var.extra_redirect_urls)
    pages_subdomain          = var.pages_subdomain
    grafana_stack_slug       = var.grafana_stack_slug
  }
}
