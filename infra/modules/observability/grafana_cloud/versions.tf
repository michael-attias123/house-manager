terraform {
  # 1.11: Git Sync's repository token is a write-only argument (OpenTofu
  # 1.11, Terraform 1.11).
  required_version = ">= 1.11.0"

  required_providers {
    grafana = {
      source                = "grafana/grafana"
      version               = "~> 4.53"
      configuration_aliases = [grafana.cloud]
    }
  }
}
