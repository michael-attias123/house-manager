# tflint --recursive, run from infra/. Uses only the bundled terraform
# ruleset, so nothing is downloaded.
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}

# shared-platform's modules are used at ref=main on purpose (its docs/contract.md):
# each platform change is tested against this repo before it merges, and a bad
# merge is fixed by a revert there. This rule wants a tag or SHA instead.
rule "terraform_module_pinned_source" {
  enabled = false
}
