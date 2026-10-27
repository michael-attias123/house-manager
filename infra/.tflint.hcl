# tflint --recursive, run from infra/. Uses only the bundled terraform
# ruleset, so nothing is downloaded.
config {
  call_module_type = "local"
}

plugin "terraform" {
  enabled = true
  preset  = "recommended"
}
