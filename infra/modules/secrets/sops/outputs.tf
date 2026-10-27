# Secrets interface output.

output "values" {
  description = "Every key of the file and its decrypted value."
  value       = data.sops_file.this.data
  sensitive   = true
}
