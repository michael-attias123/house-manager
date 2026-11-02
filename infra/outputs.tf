# Nothing secret is ever output. CI may print these.

output "app_url" {
  description = "Production URL of the app."
  value       = module.hosting.url
}

output "supabase_function_url" {
  description = "URL of the send-push Edge Function (scripts/sync-vault.sh stores it in Supabase Vault)."
  value       = module.backend.function_url
}

# The auth diff prints as "(sensitive value)" because it holds the Google
# secret; these show the URLs that go into it, readable in every plan.
output "auth_site_url" {
  description = "Site URL set in Supabase Auth."
  value       = module.hosting.url
}

# null (absent) while observability_enabled is false.
output "grafana_url" {
  description = "URL of the Grafana stack."
  value       = one(module.observability[*].grafana_url)
}

output "faro_collector_url" {
  description = "Faro collector URL (public: it is VITE_FARO_URL in the bundle)."
  value       = one(module.observability[*].faro_collector_url)
}

output "auth_redirect_urls" {
  description = "Redirect URLs set in Supabase Auth."
  value       = concat(module.hosting.redirect_urls, var.extra_redirect_urls)
}

# For scripts/pages-rebuild.sh (infra.yml starts a production build after an
# apply that changes the build variables).
output "pages_project" {
  description = "Cloudflare account id, Pages project name and production branch."
  value = {
    account_id        = var.cloudflare_account_id
    project_name      = module.hosting.project_name
    production_branch = var.production_branch
  }
}
