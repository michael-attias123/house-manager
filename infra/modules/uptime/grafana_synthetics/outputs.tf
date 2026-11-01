# Uptime interface outputs.

output "jobs" {
  description = "The check job names (the job label of probe_success)."
  value = [
    grafana_synthetic_monitoring_check.app.job,
    grafana_synthetic_monitoring_check.supabase_auth.job,
    grafana_synthetic_monitoring_check.send_push.job,
  ]
}
