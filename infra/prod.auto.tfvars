# Production settings. Committed: nothing here is secret (secrets live in
# secrets.enc.yaml). Replace every REPLACE_ME before the first plan; the
# variable validations and the no_placeholders check point at what is left.

# Cloudflare dashboard -> Account home -> Account ID (32 hex characters).
cloudflare_account_id = "f697709c05e8539b524581056f5eb6c8"

# The Pages project name as shown in Workers & Pages (not the pages.dev
# subdomain, which may carry a suffix such as -9y8).
pages_project_name = "house-manager"

# "" = no custom domain; the app is served from <subdomain>.pages.dev.
pages_custom_domain = ""

github_owner      = "michael-attias123"
github_repository = "house-manager"
production_branch = "main"

# Supabase -> Project Settings -> General: Project ID (20 lowercase letters).
supabase_project_ref = "zcjhpedhmhmsozgteqxq"
# Supabase -> Organization settings: the slug (also in the URL /org/<slug>).
supabase_organization_id = "vsipawetcgnuzjostfvh"
# The project's display name exactly as it is now; a different value renames it.
supabase_project_name = "House-Manager"
# Central EU (Frankfurt), as docs/setup.md recommends.
supabase_region = "eu-central-1"


extra_redirect_urls = ["http://localhost:5173/**"]
