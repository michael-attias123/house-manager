# Phase 0 only: pins the providers the real configuration will use, so the
# "Infra provider probe" workflow can print what each of them supports.
# No backend, no resources; nothing is created.
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    github = {
      source  = "integrations/github"
      version = "~> 6.0"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1.0"
    }
    sops = {
      source  = "carlpett/sops"
      version = "~> 1.0"
    }
  }
}
