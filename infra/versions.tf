# Tool and provider versions. Plain HCL that OpenTofu and Terraform both read.
# Provider credentials never appear here: each provider reads its token from
# the environment (see the comments below), so no secret is ever in code.
terraform {
  required_version = ">= 1.10.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.28"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.11"
    }
    sops = {
      source  = "carlpett/sops"
      version = "~> 1.4"
    }
  }
}

# CLOUDFLARE_API_TOKEN
provider "cloudflare" {}

# GITHUB_TOKEN (the GH_ADMIN_TOKEN secret in CI). The owner is not a credential.
provider "github" {
  owner = var.github_owner
}

# SUPABASE_ACCESS_TOKEN
provider "supabase" {}

# SOPS_AGE_KEY (or SOPS_AGE_KEY_FILE locally)
provider "sops" {}
