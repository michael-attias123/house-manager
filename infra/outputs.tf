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

output "auth_redirect_urls" {
  description = "Redirect URLs set in Supabase Auth."
  value       = concat(module.hosting.redirect_urls, var.extra_redirect_urls)
}
