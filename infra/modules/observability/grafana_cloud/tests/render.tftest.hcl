# Renders the GitOps files of tests/fixture through mocked providers: no
# Grafana account needed. Run from this module's directory:
#   tofu init -backend=false && tofu test
# (infra.yml's static job runs it on every PR.)

mock_provider "grafana" {}

mock_provider "grafana" {
  alias = "cloud"
}

variables {
  stack = {
    id          = "123456"
    slug        = "example"
    region_slug = "prod-eu-west-2"
    url         = "https://example.grafana.net"
    otlp_url    = "https://otlp-gateway-prod-eu-west-2.grafana.net"
    sm_url      = "https://synthetic-monitoring-api-eu-west-2.grafana.net"
  }
  app_name             = "house-manager"
  app_origin           = "https://house-manager-9y8.pages.dev"
  metrics_url          = "https://abcdefghijklmnopqrst.supabase.co/customer/v1/privileged/metrics"
  metrics_secret_key   = "sb_secret_fake"
  db_host              = "aws-0-eu-central-1.pooler.supabase.com:5432"
  db_name              = "postgres"
  db_user              = "grafana_reader.abcdefghijklmnopqrst"
  db_password          = "fakefakefakefakefakefake"
  alert_email          = "owner@example.com"
  alert_webhook_url    = "https://abcdefghijklmnopqrst.supabase.co/functions/v1/alert-hook"
  alert_webhook_secret = "0000000000000000000000000000000000000000"
  config_dir           = "./tests/fixture"
  runbook_base_url     = "https://github.com/example/house-manager/blob/main/docs/setup.md"
  git_sync = {
    repository_url = "https://github.com/example/house-manager"
    branch         = "main"
    path           = "observability/dashboards"
    token_version  = 1
  }
  git_sync_token = "github_pat_fake"
}

run "git_sync" {
  command = plan

  assert {
    condition     = keys(grafana_rule_group.this) == ["sample"] && grafana_rule_group.this["sample"].interval_seconds == 60 && grafana_rule_group.this["sample"].folder_uid == "hm-alerts"
    error_message = "The sample rule group must render with a 60 s interval in folder hm-alerts."
  }

  assert {
    condition = (
      grafana_rule_group.this["sample"].rule[0].uid == "hm-sample-down" &&
      grafana_rule_group.this["sample"].rule[0].name == "SampleDown" &&
      grafana_rule_group.this["sample"].rule[0].for == "5m" &&
      grafana_rule_group.this["sample"].rule[0].no_data_state == "OK" &&
      grafana_rule_group.this["sample"].rule[0].exec_err_state == "KeepLast" &&
      grafana_rule_group.this["sample"].rule[0].labels == tomap({ severity = "critical", push = "true" })
    )
    error_message = "Rule fields or labels are wrong."
  }

  assert {
    condition = (
      grafana_rule_group.this["sample"].rule[0].annotations["runbook_url"] == "https://github.com/example/house-manager/blob/main/docs/setup.md#runbook-sample-down" &&
      grafana_rule_group.this["sample"].rule[0].annotations["summary_he"] == "בדיקה"
    )
    error_message = "Annotations are wrong."
  }

  assert {
    condition = (
      length(grafana_rule_group.this["sample"].rule[0].data) == 2 &&
      jsondecode(grafana_rule_group.this["sample"].rule[0].data[0].model).expr == "avg_over_time(probe_success{job=\"app\"}[15m])" &&
      grafana_rule_group.this["sample"].rule[0].data[0].relative_time_range[0].from == 900 &&
      jsondecode(grafana_rule_group.this["sample"].rule[0].data[1].model).conditions[0].evaluator.params[0] == 0.5
    )
    error_message = "The data stages must be passed through with the model JSON-encoded."
  }

  assert {
    condition = (
      grafana_rule_group.this["sample"].rule[0].data[0].query_type == "instant" &&
      grafana_rule_group.this["sample"].rule[0].data[1].query_type == ""
    )
    error_message = "A stage's query_type must come from its model's queryType (as Grafana stores it), else be empty."
  }

  assert {
    condition = (
      grafana_notification_policy.this.contact_point == "email-owner" &&
      grafana_notification_policy.this.repeat_interval == "24h" &&
      grafana_notification_policy.this.policy[0].contact_point == "app-push" &&
      grafana_notification_policy.this.policy[0].continue == true &&
      one(grafana_notification_policy.this.policy[0].matcher).value == "true" &&
      grafana_notification_policy.this.policy[1].contact_point == "email-owner"
    )
    error_message = "The routing tree does not match policies.yaml."
  }

  assert {
    condition     = length(grafana_mute_timing.this) == 0
    error_message = "An empty mute-timings list renders nothing."
  }

  assert {
    condition     = length(grafana_apps_provisioning_repository_v0alpha1.dashboards) == 1 && length(grafana_dashboard.this) == 0 && length(grafana_folder.dashboards) == 0
    error_message = "With Git Sync, dashboards come from the repository, not from grafana_dashboard."
  }

  assert {
    condition     = grafana_frontend_o11y_app.this.allowed_origins == tolist(["https://house-manager-9y8.pages.dev"]) && grafana_frontend_o11y_app.this.settings["geolocation.enabled"] == "0"
    error_message = "Faro must accept only the production origin, without geolocation."
  }

  assert {
    condition     = grafana_data_source.postgres.uid == "hm-postgres" && output.otlp_endpoint == "https://otlp-gateway-prod-eu-west-2.grafana.net/otlp"
    error_message = "Data source uid or OTLP endpoint is wrong."
  }
}

run "fallback_dashboards" {
  command = plan

  variables {
    dashboards_via_git_sync = false
  }

  assert {
    condition     = length(grafana_apps_provisioning_repository_v0alpha1.dashboards) == 0 && keys(grafana_dashboard.this) == ["house-manager/overview.json", "house-manager/wrapped.json"]
    error_message = "The fallback must apply the dashboard files, without _folder.json."
  }

  assert {
    condition     = grafana_folder.dashboards["house-manager"].uid == "hm-house-manager" && grafana_folder.dashboards["house-manager"].title == "House manager" && grafana_dashboard.this["house-manager/overview.json"].folder == "hm-house-manager"
    error_message = "_folder.json gives the folder's uid and title."
  }

  assert {
    condition     = jsondecode(grafana_dashboard.this["house-manager/wrapped.json"].config_json).uid == "hm-wrapped" && !can(jsondecode(grafana_dashboard.this["house-manager/wrapped.json"].config_json).spec)
    error_message = "A wrapped dashboard is unwrapped, with metadata.name as its uid."
  }

  assert {
    condition     = length(grafana_organization_preferences.this) == 1 && grafana_organization_preferences.this[0].home_dashboard_uid == "hm-overview"
    error_message = "The overview becomes the home dashboard."
  }
}

run "no_files" {
  command = plan

  variables {
    config_dir = "./tests/does-not-exist"
  }

  assert {
    condition     = length(grafana_rule_group.this) == 0 && length(grafana_mute_timing.this) == 0
    error_message = "Missing files render no rules."
  }

  assert {
    condition     = grafana_notification_policy.this.contact_point == "email-owner" && length(grafana_notification_policy.this.policy) == 0
    error_message = "Without policies.yaml, everything goes to email-owner."
  }
}
