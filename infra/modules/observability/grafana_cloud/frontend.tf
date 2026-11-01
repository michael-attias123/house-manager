# Frontend Observability (Faro). Its collector URL is public by design: it
# goes into the bundle as VITE_FARO_URL. Only the production origin may send
# (CORS), so previews and local builds are rejected here as well.

resource "grafana_frontend_o11y_app" "this" {
  provider = grafana.cloud

  stack_id        = tonumber(var.stack.id)
  name            = var.app_name
  allowed_origins = [var.app_origin]

  extra_log_attributes = {}

  # No IP geolocation (privacy rule: nothing that locates a user).
  settings = {
    "geolocation.enabled" = "0"
  }
}
