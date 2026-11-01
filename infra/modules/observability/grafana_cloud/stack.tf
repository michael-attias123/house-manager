# Credentials minted for the stack (provider grafana.cloud). None of them is
# ever seen by a person: each goes straight to its consumer.
#
# OTLP tokens rotate: 90 days, renewed by the first apply inside the last 14
# (the weekly drift plan shows it as a replacement; `infra.yml` -> Run
# workflow -> apply main applies it). The new token exists before the old
# one is deleted.

locals {
  # Least privilege: every policy is limited to this one stack.
  realm = {
    type       = "stack"
    identifier = var.stack.id
  }
}

# Edge Function spans (supabase/functions/_shared/otel.ts).
resource "grafana_cloud_access_policy" "edge_otlp" {
  provider = grafana.cloud

  region       = var.stack.region_slug
  name         = "hm-edge-otlp"
  display_name = "house-manager Edge Functions (OTLP traces)"
  scopes       = ["traces:write"]

  realm {
    type       = local.realm.type
    identifier = local.realm.identifier
  }
}

resource "grafana_cloud_access_policy_rotating_token" "edge_otlp" {
  provider = grafana.cloud

  region                = var.stack.region_slug
  access_policy_id      = grafana_cloud_access_policy.edge_otlp.policy_id
  name_prefix           = "hm-edge-otlp"
  expire_after          = "2160h"
  early_rotation_window = "336h"
  delete_on_destroy     = true

  lifecycle {
    create_before_destroy = true
  }
}

# GitHub Actions: price ingest and telemetry.yml (metrics and traces).
resource "grafana_cloud_access_policy" "ci_otlp" {
  provider = grafana.cloud

  region       = var.stack.region_slug
  name         = "hm-ci-otlp"
  display_name = "house-manager GitHub Actions (OTLP metrics and traces)"
  scopes       = ["metrics:write", "traces:write"]

  realm {
    type       = local.realm.type
    identifier = local.realm.identifier
  }
}

resource "grafana_cloud_access_policy_rotating_token" "ci_otlp" {
  provider = grafana.cloud

  region                = var.stack.region_slug
  access_policy_id      = grafana_cloud_access_policy.ci_otlp.policy_id
  name_prefix           = "hm-ci-otlp"
  expire_after          = "2160h"
  early_rotation_window = "336h"
  delete_on_destroy     = true

  lifecycle {
    create_before_destroy = true
  }
}

# Synthetic Monitoring publishes its results with this token. Not rotating on
# purpose: a new token replaces the installation, whose SM token configures
# the `sm` provider, which would then be unknown during the plan. Rotate it by
# hand (infra/BOOTSTRAP.md, Rotation).
resource "grafana_cloud_access_policy" "sm_publisher" {
  provider = grafana.cloud

  region       = var.stack.region_slug
  name         = "hm-sm-publisher"
  display_name = "house-manager Synthetic Monitoring publisher"
  scopes       = ["metrics:write", "logs:write", "traces:write", "stacks:read"]

  realm {
    type       = local.realm.type
    identifier = local.realm.identifier
  }
}

resource "grafana_cloud_access_policy_token" "sm_publisher" {
  provider = grafana.cloud

  region           = var.stack.region_slug
  access_policy_id = grafana_cloud_access_policy.sm_publisher.policy_id
  name             = "hm-sm-publisher"
}

resource "grafana_synthetic_monitoring_installation" "this" {
  provider = grafana.cloud

  stack_id              = var.stack.id
  metrics_publisher_key = grafana_cloud_access_policy_token.sm_publisher.token
  stack_sm_api_url      = var.stack.sm_url
}
