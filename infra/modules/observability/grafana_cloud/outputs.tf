# Observability interface outputs.

locals {
  # OTLP base URL; exporters append /v1/traces and /v1/metrics. Grafana
  # documents it with the /otlp path, which the stack attribute may omit.
  otlp_endpoint = endswith(trimsuffix(var.stack.otlp_url, "/"), "/otlp") ? trimsuffix(var.stack.otlp_url, "/") : "${trimsuffix(var.stack.otlp_url, "/")}/otlp"
}

output "grafana_url" {
  description = "URL of the Grafana stack."
  value       = "https://${var.stack.slug}.grafana.net"
}

output "faro_collector_url" {
  description = "Faro collector URL for the browser (public by design: VITE_FARO_URL)."
  value       = grafana_frontend_o11y_app.this.collector_endpoint
}

output "otlp_endpoint" {
  description = "OTLP/HTTP base URL of the stack (username: the stack id)."
  value       = local.otlp_endpoint
}

output "edge_otlp_basic_auth" {
  description = "base64(<stack id>:<traces token>) for the Edge Functions (OTLP_BASIC_AUTH)."
  value       = base64encode("${var.stack.id}:${grafana_cloud_access_policy_rotating_token.edge_otlp.token}")
  sensitive   = true
}

output "ci_otlp_headers" {
  description = "OTEL_EXPORTER_OTLP_HEADERS value for GitHub Actions: Authorization=Basic%20<base64>."
  value       = "Authorization=Basic%20${base64encode("${var.stack.id}:${grafana_cloud_access_policy_rotating_token.ci_otlp.token}")}"
  sensitive   = true
}

output "sm_access_token" {
  description = "Synthetic Monitoring API token (configures the root's grafana.sm provider)."
  value       = grafana_synthetic_monitoring_installation.this.sm_access_token
  sensitive   = true
}

output "sm_url" {
  description = "Synthetic Monitoring API URL of the stack's region."
  value       = grafana_synthetic_monitoring_installation.this.stack_sm_api_url
}

output "dashboards_folder_uid" {
  description = "Folder of the house-manager dashboards (from observability/dashboards/house-manager/_folder.json)."
  value       = local.home_folder_uid
}
