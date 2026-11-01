# Contact points stay in HCL because they hold secrets (the owner's address,
# the webhook HMAC). Their routing is a file: alerting/policies.yaml
# (alerting_files.tf). The receiver names below are the interface.
#
# On free stacks opened after April 2026, email may only go to users of the
# stack: alert_email must be the owner's Grafana login address. Push is the
# second, independent channel.

resource "grafana_contact_point" "email_owner" {
  name = "email-owner"

  email {
    addresses    = [var.alert_email]
    single_email = true
  }
}

# supabase/functions/alert-hook: verifies X-Grafana-Alerting-Signature (hex
# HMAC-SHA256 of "<timestamp>:<body>", timestamp in the header below) and
# pushes summary_he to the app's admins.
resource "grafana_contact_point" "app_push" {
  name = "app-push"

  webhook {
    url        = var.alert_webhook_url
    max_alerts = 10

    hmac_config {
      secret           = var.alert_webhook_secret
      timestamp_header = "X-Grafana-Alerting-Timestamp"
    }
  }
}

# Holds every rule group (read-only in the UI: provisioned). A folder of its
# own, not Git Sync's "House manager" (hm-house-manager): that one belongs to
# the repository, which would treat rules in it as foreign content, and its
# title must stay unique.
resource "grafana_folder" "alerts" {
  uid   = "hm-alerts"
  title = "House manager alerts"
}
