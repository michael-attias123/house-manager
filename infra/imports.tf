# Everything that already exists (created by hand, or during bootstrap) is
# imported, never recreated. Import blocks are no-ops once the resource is in
# state, so they can stay; delete them after the first apply if preferred.
#
# ID formats, from each provider's docs at the pinned tag:
#   cloudflare_pages_project        <account_id>/<project_name>
#   cloudflare_pages_domain         <account_id>/<project_name>/<domain_name>
#   cloudflare_r2_bucket            <account_id>/<bucket_name>/<jurisdiction>
#   supabase_project                <project_ref>
#   supabase_settings               <project_ref>
#   supabase_edge_function_secrets  <project_ref>
#   github_branch_protection        <repository>:<pattern>   (not imported, below)
#
# Before the first plan:
# - Cloudflare cannot import a Pages project that has a Secret-type (encrypted)
#   environment variable. Delete any such variable in the dashboard first
#   (Settings -> Variables and Secrets); the apply recreates every VITE_*
#   variable as plain text.
# - The apply deletes Edge Function secrets that are not in
#   module.backend.function_secrets (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY,
#   VAPID_SUBJECT, PUSH_SECRET). SUPABASE_* secrets are never touched.
#
# Expected changes in the first plan after import (then the plan is empty):
# - supabase_edge_function_secrets: update in place. The API only returns
#   digests, so imported values are null and all four are set again.
# - supabase_settings.auth: update in place. Import stores the whole auth
#   config; the configuration names only the keys managed here, so the state
#   shrinks to those keys (the other settings are not changed on Supabase).
#   external_google_secret is returned hashed, so it is sent once. The diff
#   shows as (sensitive value) because the JSON contains that secret.
# - cloudflare_pages_project: any env var that is missing or different (for
#   example VITE_VAPID_PUBLIC_KEY in preview) is added; values print as
#   (sensitive value) because the provider schema marks them so. If the
#   project still builds on image v2, build_image_major_version moves to 3.
# - github_actions_secret: created. GitHub's API creates or overwrites, so an
#   existing SUPABASE_DB_URL / SUPABASE_PROJECT_REF needs no import.
# - github_branch_protection: created (see below).
# - terraform_data.guards: created (holds no data, only the checks).

import {
  to = module.hosting.cloudflare_pages_project.this
  id = "${var.cloudflare_account_id}/${var.pages_project_name}"
}

import {
  for_each = var.pages_custom_domain == "" ? toset([]) : toset([var.pages_custom_domain])

  to = module.hosting.cloudflare_pages_domain.this[each.key]
  id = "${var.cloudflare_account_id}/${var.pages_project_name}/${each.key}"
}

import {
  to = cloudflare_r2_bucket.state
  id = "${var.cloudflare_account_id}/${var.state_bucket_name}/default"
}

import {
  to = module.backend.supabase_project.this
  id = var.supabase_project_ref
}

import {
  to = module.backend.supabase_settings.this
  id = var.supabase_project_ref
}

import {
  to = module.backend.supabase_edge_function_secrets.this
  id = var.supabase_project_ref
}

# Branch protection is not imported: the provider's importer looks the rule up
# by pattern and fails with "could not find a branch protection rule" when
# main has none, which is the expected state today. If a rule for main was
# added by hand, the create fails instead ("already protected"); then uncomment
# this block for one plan/apply:
#
# import {
#   to = module.repo.github_branch_protection.this[0]
#   id = "${var.github_repository}:${var.production_branch}"
# }
