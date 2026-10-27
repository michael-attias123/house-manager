# Secrets interface input.

variable "file" {
  description = "Path to the SOPS-encrypted YAML file (a flat map of strings)."
  type        = string

  validation {
    condition     = can(regex("\\.ya?ml$", var.file))
    error_message = "file must be a .yaml or .yml file."
  }
}
