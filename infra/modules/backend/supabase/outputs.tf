# Backend interface outputs.

output "api_url" {
  description = "Project API URL."
  value       = "https://${var.project_ref}.supabase.co"
}

output "publishable_key" {
  description = "Client key for the browser (public by design, but marked sensitive like every key the provider returns). Falls back to the legacy anon key on projects without a publishable key."
  value       = try(coalesce(data.supabase_apikeys.this.publishable_key, data.supabase_apikeys.this.anon_key), "")
  sensitive   = true
}

output "function_url" {
  description = "URL of the send-push Edge Function."
  value       = "https://${var.project_ref}.supabase.co/functions/v1/send-push"
}
