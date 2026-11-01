# Uptime interface inputs. The provider is Grafana's Synthetic Monitoring API
# (the root passes grafana.sm as this module's default grafana).

variable "app_url" {
  description = "Production URL of the app (job app: 200 and the root element in the body)."
  type        = string

  validation {
    condition     = can(regex("^https://[^\\s]+$", var.app_url))
    error_message = "app_url must be an https:// URL."
  }
}

variable "supabase_api_url" {
  description = "Backend API URL (job supabase-auth: <url>/auth/v1/health answers 200)."
  type        = string
}

variable "publishable_key" {
  description = "Public client key, sent as the apikey header of the auth health check."
  type        = string
}

variable "push_url" {
  description = "URL of the send-push function (job send-push: answers 401 without its secret, so it runs and sends nothing)."
  type        = string
}

variable "probes" {
  description = "Probe names for the 5-minute checks (two in the EU)."
  type        = list(string)
  default     = ["Frankfurt", "London"]
  nullable    = false
}

variable "push_probes" {
  description = "Probe names for the 15-minute send-push check."
  type        = list(string)
  default     = ["Frankfurt"]
  nullable    = false
}
