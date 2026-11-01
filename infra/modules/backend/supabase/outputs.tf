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

output "metrics_url" {
  description = "Prometheus metrics endpoint of the project (Basic auth: service_role and metrics_secret_key)."
  value       = "https://${var.project_ref}.supabase.co/customer/v1/privileged/metrics"
}

output "metrics_secret_key" {
  description = "Secret API key for the metrics endpoint, or null when metrics_key_enabled is false."
  value       = one(supabase_apikey.grafana_metrics_new[*].api_key)
  sensitive   = true
}

output "function_url" {
  description = "URL of the send-push Edge Function."
  value       = "https://${var.project_ref}.supabase.co/functions/v1/send-push"
}
