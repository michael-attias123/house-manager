# SQL data source with a fixed uid: dashboards and alerts in observability/
# reference it as hm-postgres (Git Sync reads the files as they are, so uids
# cannot be templated). The role grafana_reader may only read the aggregate
# views in schema monitoring, read-only, 5 s statement timeout, 3 connections.

resource "grafana_data_source" "postgres" {
  type = "grafana-postgresql-datasource"
  name = "house-manager-postgres"
  uid  = "hm-postgres"

  url      = var.db_host
  username = var.db_user

  json_data_encoded = jsonencode({
    database        = var.db_name
    sslmode         = "require"
    maxOpenConns    = 2
    maxIdleConns    = 1
    connMaxLifetime = 14400
    postgresVersion = 1500
    timescaledb     = false
  })

  secure_json_data_encoded = jsonencode({
    password = var.db_password
  })
}
