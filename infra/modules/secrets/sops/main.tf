# Secrets role, SOPS implementation: decrypts a SOPS file (age key from
# SOPS_AGE_KEY) into a flat map of strings.
# Interface: in `file`, out `values` (sensitive map(string)). Another store
# (Vault, OpenBao, Infisical...) is a sibling module with the same interface.

data "sops_file" "this" {
  source_file = var.file
}
