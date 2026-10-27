# Repo interface outputs.

output "repository" {
  description = "Full name of the repository (owner/name)."
  value       = data.github_repository.this.full_name
}
