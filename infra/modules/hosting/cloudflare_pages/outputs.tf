# Hosting interface outputs.

output "url" {
  description = "Production URL: https://<custom domain> if set, else https://<pages.dev subdomain>."
  value       = local.url
}

output "redirect_urls" {
  description = "Auth redirect URLs for production and every preview deployment."
  value = [
    "${local.url}/**",
    "https://*.${local.subdomain}/**",
  ]
}

output "project_name" {
  description = "Pages project name."
  value       = cloudflare_pages_project.this.name
}
