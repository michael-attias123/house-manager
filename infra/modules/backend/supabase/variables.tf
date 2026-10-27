# Backend interface inputs.

variable "project_ref" {
  description = "Project ref (the <ref> in https://<ref>.supabase.co)."
  type        = string
}

variable "organization_id" {
  description = "Organization slug."
  type        = string
}

variable "project_name" {
  description = "Project display name."
  type        = string
}

variable "region" {
  description = "Region code, e.g. eu-central-1."
  type        = string
}

variable "database_password" {
  description = "Database password. Required by the provider; ignored after import (see main.tf)."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.database_password) >= 4
    error_message = "database_password must be at least 4 characters (provider minimum)."
  }
}

variable "site_url" {
  description = "Auth Site URL: where sign-in returns by default."
  type        = string

  validation {
    condition     = can(regex("^https://[^\\s,/]+$", var.site_url))
    error_message = "site_url must be an https:// origin without a path or trailing slash."
  }
}

variable "redirect_urls" {
  description = "Auth Redirect URLs (allow list); wildcards allowed."
  type        = list(string)

  validation {
    condition     = length(var.redirect_urls) > 0 && alltrue([for u in var.redirect_urls : can(regex("^https?://[^\\s,]+$", u))])
    error_message = "redirect_urls must be a non-empty list of http(s) URLs without spaces or commas."
  }
}

variable "google_client_id" {
  description = "Google OAuth Web client ID."
  type        = string
  sensitive   = true
}

variable "google_client_secret" {
  description = "Google OAuth client secret."
  type        = string
  sensitive   = true

  validation {
    condition     = length(var.google_client_secret) > 0
    error_message = "google_client_secret must not be empty."
  }
}

variable "function_secrets" {
  description = "Edge Function secrets (name -> value). Secrets not listed here are deleted by the apply."
  type        = map(string)
  sensitive   = true

  validation {
    condition = alltrue([
      for name in keys(var.function_secrets) :
      can(regex("^[A-Za-z_][A-Za-z0-9_]*$", name)) && !startswith(upper(name), "SUPABASE_")
    ])
    error_message = "function_secrets names must be letters, digits and underscores, and must not start with SUPABASE_ (reserved by Supabase)."
  }
}
