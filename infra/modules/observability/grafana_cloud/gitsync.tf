# Dashboards (GitOps, pull): Grafana Git Sync reads the dashboard JSON from
# GitHub every 60 s, or at once through the GitHub webhook it installs.
# Saves in the Grafana UI go to a new branch and a pull request (workflow
# "branch" only, never a direct commit), so nothing changes in Grafana that
# is not merged in git first.
#
# Sync target "folder": Grafana creates one folder for the repository (uid =
# the repository's uid, title = its title), and every directory under `path`
# becomes a subfolder; its _folder.json fixes the subfolder's uid and title
# (observability/dashboards/house-manager -> hm-house-manager, "House
# manager"). Repository folder + 1 folder + 4 dashboards = 6 of the 20
# resources Git Sync allows on the free tier.
#
# The token is a write-only argument: never stored in state or plan. To change
# it, set gitsync_github_token and bump gitsync_token_version.
# Resource: https://registry.terraform.io/providers/grafana/grafana/4.53.0/docs/resources/apps_provisioning_repository_v0alpha1
# Guide: https://grafana.com/docs/grafana/latest/as-code/observability-as-code/git-sync/git-sync-setup/set-up-terraform/

locals {
  git_sync_repository_uid = "hm-gitsync"
}

resource "grafana_apps_provisioning_repository_v0alpha1" "dashboards" {
  count = var.dashboards_via_git_sync ? 1 : 0

  metadata {
    uid = local.git_sync_repository_uid
  }

  spec {
    title       = "house-manager (GitHub)"
    description = "observability/dashboards on the main branch (infra/, OpenTofu)"
    type        = "github"
    workflows   = ["branch"]

    sync {
      enabled          = true
      target           = "folder"
      interval_seconds = 60
    }

    github {
      url    = var.git_sync.repository_url
      branch = var.git_sync.branch
      path   = var.git_sync.path
    }
  }

  secure {
    token = {
      create = var.git_sync_token
    }
  }
  secure_version = var.git_sync.token_version
}
