# Alerts as files (GitOps): observability/alerts/<group>.yaml (one rule group
# each), observability/alerting/policies.yaml and mute-timings.yaml are
# rendered into provisioned Grafana objects, read-only in the UI. The schema
# is in observability/README.md; scripts/observability/validate.py checks it
# in CI. A missing file renders nothing (or the default policy below).

locals {
  alerts_dir   = "${var.config_dir}/alerts"
  alerting_dir = "${var.config_dir}/alerting"

  # Keyed by group name: two files with one group name fail the plan.
  rule_groups = {
    for f in sort(fileset(local.alerts_dir, "*.yaml")) :
    yamldecode(file("${local.alerts_dir}/${f}")).group => yamldecode(file("${local.alerts_dir}/${f}"))
  }

  # "1m", "15m", "1h30m" -> seconds.
  duration_units = { s = 1, m = 60, h = 3600 }
  group_interval_seconds = {
    for name, g in local.rule_groups :
    name => sum(concat([0], [for p in regexall("([0-9]+)([smh])", g.interval) : tonumber(p[0]) * local.duration_units[p[1]]]))
  }

  # Without the file: everything to email-owner, grouped by alert. (Through
  # JSON so both branches have one type; a broken file still fails the plan.)
  policies_file = "${local.alerting_dir}/policies.yaml"
  policy = jsondecode(fileexists(local.policies_file) ? jsonencode(yamldecode(file(local.policies_file))) : jsonencode({
    receiver = grafana_contact_point.email_owner.name
    group_by = ["alertname"]
  }))

  # A list, or { mute_timings: [...] }; an empty file is null.
  mute_timings_file = "${local.alerting_dir}/mute-timings.yaml"
  mute_doc          = fileexists(local.mute_timings_file) ? yamldecode(file(local.mute_timings_file)) : null
  mute_list         = local.mute_doc == null ? [] : try(local.mute_doc.mute_timings, local.mute_doc)
  mute_timings      = { for m in coalesce(local.mute_list, []) : m.name => m }
}

resource "grafana_rule_group" "this" {
  for_each = local.rule_groups

  name             = each.key
  folder_uid       = grafana_folder.alerts.uid
  interval_seconds = local.group_interval_seconds[each.key]

  dynamic "rule" {
    for_each = each.value.rules

    content {
      uid            = rule.value.uid
      name           = rule.value.title
      for            = try(rule.value["for"], "0s")
      condition      = rule.value.condition
      no_data_state  = try(rule.value.no_data_state, "NoData")
      exec_err_state = try(rule.value.exec_err_state, "Error")

      labels = {
        severity = rule.value.severity
        # YAML true/false -> label "true"/"false" (policies.yaml matches on it).
        push = tostring(rule.value.push)
      }

      annotations = {
        summary     = rule.value.summary
        summary_he  = rule.value.summary_he
        runbook_url = "${var.runbook_base_url}#runbook-${rule.value.runbook}"
      }

      # "data" would read as a data source reference, hence the iterator name.
      dynamic "data" {
        for_each = rule.value.data
        iterator = stage

        # query_type: Grafana copies a stage's model.queryType into it (Loki's
        # "instant"); sending "" instead showed as a change on every plan.
        content {
          ref_id         = stage.value.ref_id
          datasource_uid = stage.value.datasource_uid
          query_type     = try(stage.value.query_type, try(stage.value.model.queryType, ""))
          model          = jsonencode(stage.value.model)

          relative_time_range {
            from = stage.value.relative_time_range.from
            to   = stage.value.relative_time_range.to
          }
        }
      }
    }
  }

  lifecycle {
    precondition {
      condition     = local.group_interval_seconds[each.key] >= 10
      error_message = "observability/alerts: the interval of group ${each.key} must be a duration such as 1m or 15m (10s or more)."
    }
  }
}

resource "grafana_mute_timing" "this" {
  for_each = local.mute_timings

  name = each.key

  dynamic "intervals" {
    for_each = try(each.value.intervals, [])
    iterator = interval

    content {
      weekdays      = try(interval.value.weekdays, null)
      days_of_month = try(interval.value.days_of_month, null)
      months        = try(interval.value.months, null)
      years         = try(interval.value.years, null)
      location      = try(interval.value.location, null)

      dynamic "times" {
        for_each = try(interval.value.times, [])
        iterator = t

        content {
          start = t.value.start
          end   = t.value.end
        }
      }
    }
  }
}

# The whole routing tree (one per stack). Two levels of routes.
resource "grafana_notification_policy" "this" {
  contact_point   = local.policy.receiver
  group_by        = local.policy.group_by
  group_wait      = try(local.policy.group_wait, null)
  group_interval  = try(local.policy.group_interval, null)
  repeat_interval = try(local.policy.repeat_interval, null)

  dynamic "policy" {
    for_each = try(local.policy.routes, [])
    iterator = route

    content {
      contact_point   = try(route.value.receiver, null)
      continue        = try(route.value["continue"], false)
      group_by        = try(route.value.group_by, null)
      group_wait      = try(route.value.group_wait, null)
      group_interval  = try(route.value.group_interval, null)
      repeat_interval = try(route.value.repeat_interval, null)
      mute_timings    = try(route.value.mute_timings, null)
      active_timings  = try(route.value.active_timings, null)

      dynamic "matcher" {
        for_each = try(route.value.matchers, [])

        content {
          label = matcher.value.label
          match = matcher.value.match
          value = tostring(matcher.value.value)
        }
      }

      dynamic "policy" {
        for_each = try(route.value.routes, [])
        iterator = sub

        content {
          contact_point   = try(sub.value.receiver, null)
          continue        = try(sub.value["continue"], false)
          group_by        = try(sub.value.group_by, null)
          group_wait      = try(sub.value.group_wait, null)
          group_interval  = try(sub.value.group_interval, null)
          repeat_interval = try(sub.value.repeat_interval, null)
          mute_timings    = try(sub.value.mute_timings, null)
          active_timings  = try(sub.value.active_timings, null)

          dynamic "matcher" {
            for_each = try(sub.value.matchers, [])

            content {
              label = matcher.value.label
              match = matcher.value.match
              value = tostring(matcher.value.value)
            }
          }
        }
      }
    }
  }

  # Receivers and mute timings are referenced by name.
  depends_on = [
    grafana_contact_point.email_owner,
    grafana_contact_point.app_push,
    grafana_mute_timing.this,
  ]
}
