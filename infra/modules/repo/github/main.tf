# Repo role, GitHub implementation: the app's Actions secrets and protection
# of the production branch. The owner comes from the provider (root
# versions.tf). The bootstrap secrets are never passed in here.

data "github_repository" "this" {
  name = var.repository
}

resource "github_actions_secret" "this" {
  # Names are not secret; only the values are.
  for_each = toset(nonsensitive(keys(var.actions_secrets)))

  repository  = data.github_repository.this.name
  secret_name = each.key
  # `value` replaces `plaintext_value`, deprecated in provider v6.13.
  value = var.actions_secrets[each.key]
}

# Signed commits stay optional: requiring them would block merging any PR with
# an unsigned commit (from a phone, a web editor or an automated session), for
# little gain with a single maintainer. Turn it on with require_signed_commits
# once every commit is signed.
#trivy:ignore:GIT-0004
resource "github_branch_protection" "this" {
  count = var.protected_branch == "" ? 0 : 1

  # The node id, as the importer stores it; repository_id forces a
  # replacement, so the name would differ from state after an import.
  repository_id = data.github_repository.this.node_id
  pattern       = var.protected_branch

  # A single maintainer: no required reviews, and admins may still merge.
  enforce_admins      = false
  allows_deletions    = false
  allows_force_pushes = false

  required_status_checks {
    # CI runs on push, so the head commit of a PR already carries these.
    strict   = false
    contexts = var.required_checks
  }
}
