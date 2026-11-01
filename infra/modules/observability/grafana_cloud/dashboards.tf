# Fallback for dashboards (dashboards_via_git_sync = false): the same files
# Git Sync reads, applied as grafana_folder and grafana_dashboard resources,
# and kept in step by observability-sync.yml. No file moves; only the
# mechanism changes.
# - Each directory's _folder.json (folder.grafana.app/v1) gives its folder's
#   uid (metadata.name) and title (spec.title), as with Git Sync. Folders are
#   top level here (no repository folder above them).
# - A dashboard is classic JSON, or the wrapped form (apiVersion, kind,
#   metadata, spec): then spec is the model and metadata.name its uid.

locals {
  dashboards_dir = "${var.config_dir}/dashboards"

  folder_files = var.dashboards_via_git_sync ? [] : sort(fileset(local.dashboards_dir, "*/_folder.json"))
  fallback_folders = {
    for f in local.folder_files : dirname(f) => {
      uid   = jsondecode(file("${local.dashboards_dir}/${f}")).metadata.name
      title = jsondecode(file("${local.dashboards_dir}/${f}")).spec.title
    }
  }

  dashboard_files = var.dashboards_via_git_sync ? [] : [
    for f in sort(fileset(local.dashboards_dir, "*/*.json")) : f if !startswith(basename(f), "_")
  ]
  # file -> dashboard model as JSON text (each branch encodes, so both have one type).
  dashboard_json = {
    for f in local.dashboard_files : f => (
      can(jsondecode(file("${local.dashboards_dir}/${f}")).spec)
      ? jsonencode(merge(jsondecode(file("${local.dashboards_dir}/${f}")).spec, { uid = jsondecode(file("${local.dashboards_dir}/${f}")).metadata.name }))
      : jsonencode(jsondecode(file("${local.dashboards_dir}/${f}")))
    )
  }

  home_dashboard_uid = "hm-overview"
  # The folder Git Sync creates from observability/dashboards/house-manager.
  home_folder_uid = "hm-house-manager"

  synced_dashboard_uids = [for d in try(data.grafana_dashboards.synced[0].dashboards, []) : d.uid]
  file_dashboard_uids   = [for j in values(local.dashboard_json) : try(jsondecode(j).uid, "")]

  # The home dashboard may only point at a dashboard that exists. Git Sync
  # creates them asynchronously, so with Git Sync the preference is set by
  # the first plan that finds the overview (the reconciler runs every 30 min).
  home_dashboard_exists = contains(var.dashboards_via_git_sync ? local.synced_dashboard_uids : local.file_dashboard_uids, local.home_dashboard_uid)
}

resource "grafana_folder" "dashboards" {
  for_each = local.fallback_folders

  uid   = each.value.uid
  title = each.value.title
}

resource "grafana_dashboard" "this" {
  for_each = local.dashboard_json

  # A directory without _folder.json: the General folder.
  folder      = try(grafana_folder.dashboards[dirname(each.key)].uid, null)
  config_json = each.value
  overwrite   = true
}

# Read at plan time (no depends_on on purpose): an empty list until Git Sync
# has created the folder.
data "grafana_dashboards" "synced" {
  count = var.dashboards_via_git_sync ? 1 : 0

  folder_uids = [local.home_folder_uid]
}

resource "grafana_organization_preferences" "this" {
  count = local.home_dashboard_exists ? 1 : 0

  home_dashboard_uid = local.home_dashboard_uid

  depends_on = [grafana_dashboard.this]
}
