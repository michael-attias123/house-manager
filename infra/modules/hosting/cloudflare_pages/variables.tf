# Hosting interface inputs. A different host is a sibling module with these
# same variables.

variable "account_id" {
  description = "Cloudflare account id."
  type        = string
}

variable "project_name" {
  description = "Pages project name."
  type        = string
}

variable "production_branch" {
  description = "Branch whose commits deploy to production."
  type        = string
}

variable "github_owner" {
  description = "Owner of the GitHub repository to build from."
  type        = string
}

variable "github_repository" {
  description = "GitHub repository name (without the owner)."
  type        = string
}

variable "root_dir" {
  description = "Directory the build runs in."
  type        = string
  default     = "web"
}

variable "build_command" {
  description = "Build command."
  type        = string
  default     = "pnpm build"
}

variable "output_dir" {
  description = "Build output directory, relative to root_dir."
  type        = string
  default     = "dist"
}

variable "env_vars" {
  description = "Build-time variables, stored as plain text in production and preview. Only values that may be public (they end up in the bundle)."
  type        = map(string)
  default     = {}
  nullable    = false
}

variable "secret_env_vars" {
  description = "Build-time variables stored encrypted (secret_text) in production and preview. Note: a project with secret variables cannot be imported."
  type        = map(string)
  default     = {}
  sensitive   = true
  nullable    = false
}

variable "custom_domain" {
  description = "Custom domain, or \"\" for none."
  type        = string
  default     = ""
  nullable    = false
}
