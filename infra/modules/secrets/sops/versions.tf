terraform {
  required_version = ">= 1.10.0"

  required_providers {
    sops = {
      source  = "carlpett/sops"
      version = "~> 1.4"
    }
  }
}
