# Nothing secret is ever output. CI may print these.

output "app_url" {
  description = "Production URL of the app."
  value       = module.hosting.url
}

output "supabase_function_url" {
  description = "URL of the send-push Edge Function (scripts/sync-vault.sh stores it in Supabase Vault)."
  value       = module.backend.function_url
}
