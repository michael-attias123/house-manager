# OpenTofu only: client-side encryption of the state and of saved plans.
# This is the one file Terraform cannot read. Everything else is plain HCL.
#
# The key is derived (PBKDF2) from var.state_passphrase, which comes from the
# environment as TF_VAR_state_passphrase (the TF_STATE_PASSPHRASE secret in CI,
# bootstrap item 7). It must be at least 16 characters.
#
# Moving to Terraform: decrypt the state first, then delete this file.
#   1. Uncomment the "unencrypted" method, and in the state block set
#      `method = method.unencrypted.migrate`, drop `enforced = true`, and add
#      `fallback { method = method.aes_gcm.state }` so the encrypted state
#      can still be read.
#   2. Run `tofu apply -refresh-only` once: the state is rewritten in plaintext.
#   3. Delete this file (the variable goes with it) and run `terraform init`.
# infra/MIGRATING.md has the full steps.

variable "state_passphrase" {
  description = "Passphrase for OpenTofu state and plan encryption (TF_VAR_state_passphrase). Only used in this file."
  type        = string
  sensitive   = true
  nullable    = false

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "state_passphrase must be at least 16 characters (the pbkdf2 key provider's minimum)."
  }
}

terraform {
  encryption {
    key_provider "pbkdf2" "state" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "state" {
      keys = key_provider.pbkdf2.state
    }

    # Unused today. Needed to adopt an existing plaintext state (keep the
    # aes_gcm method and uncomment the fallback below) or to decrypt before a
    # move to Terraform (see the header).
    # method "unencrypted" "migrate" {}

    state {
      method   = method.aes_gcm.state
      enforced = true

      # Adopting a plaintext state: read it once with this, write it encrypted.
      # fallback {
      #   method = method.unencrypted.migrate
      # }
    }

    plan {
      method   = method.aes_gcm.state
      enforced = true
    }
  }
}
