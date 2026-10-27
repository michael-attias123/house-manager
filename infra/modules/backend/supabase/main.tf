# Backend role, Supabase implementation: the (imported) project, the auth
# settings this app depends on, and the Edge Function secrets.
# Schema, extensions and function code stay in supabase/ and are deployed by
# .github/workflows/db-migrate.yml, not here.

resource "supabase_project" "this" {
  organization_id   = var.organization_id
  name              = var.project_name
  region            = var.region
  database_password = var.database_password

  lifecycle {
    prevent_destroy = true

    # Provider v1.11.0 (internal/provider/project_resource.go) has no
    # RequiresReplace modifier, but these would still misbehave after import:
    # - database_password: never read back, so it is null after import; a
    #   value here would make the apply reset the live database password.
    #   Rotate it in the dashboard and update secrets.enc.yaml instead.
    # - region, organization_id: read back, but Update answers "Update is not
    #   supported for this attribute"; any mismatch would break every apply.
    # - instance_size: read from the compute add-on; a change resizes the
    #   instance (billing), which is not this configuration's business.
    ignore_changes = [database_password, region, organization_id, instance_size]
  }
}

resource "supabase_settings" "this" {
  project_ref = supabase_project.this.id

  # Only these keys are managed: after the first apply the provider refreshes
  # exactly the keys present in state (settings_resource.go, parseConfig ->
  # pickConfig), and the update endpoint is a PATCH, so every other auth
  # setting stays as configured in the dashboard.
  auth = jsonencode({
    site_url       = var.site_url
    uri_allow_list = join(",", var.redirect_urls)

    external_google_enabled   = true
    external_google_client_id = var.google_client_id
    # Returned hashed by the API; the provider keeps the value from state.
    external_google_secret = var.google_client_secret

    # Sign-up stays open at the auth level; public.allowed_emails decides who
    # may create an account (a trigger on auth.users).
    disable_signup = false
  })

  lifecycle {
    # Import reads every settings category into state. Without this, the
    # unmanaged ones (null here) would show as a change on every plan until
    # the first apply. They are not managed: the dashboard and migrations own
    # them.
    ignore_changes = [api, database, network, pooler, storage, ssl_enforcement]
  }
}

resource "supabase_edge_function_secrets" "this" {
  # project_ref forces a replacement in the provider; it is the same value as
  # the import id, so it never differs from state.
  project_ref = supabase_project.this.id

  # Names are not secret; unwrapping them keeps the set's structure visible.
  secrets = [
    for name in sort(nonsensitive(keys(var.function_secrets))) : {
      name  = name
      value = var.function_secrets[name]
    }
  ]
}

data "supabase_apikeys" "this" {
  project_ref = supabase_project.this.id
}
