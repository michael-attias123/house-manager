# Grafana's hosted scraper pulls the backend's Prometheus endpoint once a
# minute (Supabase's recommendation; the allowed values are 30, 60 and 120).
# No relabel or allow-list option exists: if the series count grows past the
# free tier, set enabled = false here (the SQL data source still covers the
# data alerts).

resource "grafana_connections_metrics_endpoint_scrape_job" "backend" {
  stack_id                      = var.stack.id
  name                          = "${var.app_name}-backend"
  enabled                       = true
  url                           = var.metrics_url
  authentication_method         = "basic"
  authentication_basic_username = "service_role"
  authentication_basic_password = var.metrics_secret_key
  scrape_interval_seconds       = 60

  static_labels = {
    env = "prod"
  }
}
