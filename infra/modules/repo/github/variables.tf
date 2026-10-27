# Repo interface inputs.

variable "repository" {
  description = "Repository name (the owner is set on the provider)."
  type        = string
}

variable "actions_secrets" {
  description = "Actions secrets to manage (name -> value). Bootstrap secrets do not belong here."
  type        = map(string)
  sensitive   = true
  default     = {}
  nullable    = false

  validation {
    condition = alltrue([
      for name in keys(var.actions_secrets) :
      can(regex("^[A-Z_][A-Z0-9_]*$", name)) && !startswith(name, "GITHUB_")
    ])
    error_message = "actions_secrets names must be upper-case letters, digits and underscores, and must not start with GITHUB_."
  }
}

variable "protected_branch" {
  description = "Branch to protect, or \"\" to manage no branch protection."
  type        = string
  default     = ""
  nullable    = false
}

variable "required_checks" {
  description = "Status checks (CI job names) that must pass before merging into protected_branch."
  type        = list(string)
  default     = []
  nullable    = false
}
