# Uptime role, Grafana Synthetic Monitoring implementation: three HTTP checks.
# The job names are the interface: the alerts in observability/alerts match
# probe_success{job="app" | "supabase-auth" | "send-push"}.
#
# About 37k executions a month of the free 100k: 2 probes every 5 min for
# app and supabase-auth, 1 probe every 15 min for send-push. The traffic also
# keeps the free Supabase project from pausing.

data "grafana_synthetic_monitoring_probes" "this" {}

locals {
  probes      = [for name in var.probes : data.grafana_synthetic_monitoring_probes.this.probes[name]]
  push_probes = [for name in var.push_probes : data.grafana_synthetic_monitoring_probes.this.probes[name]]
}

resource "grafana_synthetic_monitoring_check" "app" {
  job                = "app"
  target             = var.app_url
  enabled            = true
  probes             = local.probes
  frequency          = 300000
  timeout            = 10000
  basic_metrics_only = true

  settings {
    http {
      method                          = "GET"
      fail_if_not_ssl                 = true
      valid_status_codes              = [200]
      fail_if_body_not_matches_regexp = ["id=\"root\""]
    }
  }
}

resource "grafana_synthetic_monitoring_check" "supabase_auth" {
  job                = "supabase-auth"
  target             = "${var.supabase_api_url}/auth/v1/health"
  enabled            = true
  probes             = local.probes
  frequency          = 300000
  timeout            = 10000
  basic_metrics_only = true

  settings {
    http {
      method             = "GET"
      fail_if_not_ssl    = true
      valid_status_codes = [200]
      # The publishable key is public (it is in the bundle).
      headers = ["apikey: ${var.publishable_key}"]
    }
  }
}

resource "grafana_synthetic_monitoring_check" "send_push" {
  job                = "send-push"
  target             = var.push_url
  enabled            = true
  probes             = local.push_probes
  frequency          = 900000
  timeout            = 10000
  basic_metrics_only = true

  settings {
    http {
      method          = "POST"
      fail_if_not_ssl = true
      # No secret: 401 means deployed and running, and nothing is sent.
      valid_status_codes = [401]
    }
  }
}
