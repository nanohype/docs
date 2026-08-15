include "root" {
  path = find_in_parent_folders("root.hcl")
}

include "envcommon" {
  path           = "${dirname(find_in_parent_folders("cloud.hcl"))}/../_envcommon/aws/site.hcl"
  merge_strategy = "deep"
}

locals {
  # Injected at apply time so the account id never lands in a tracked file.
  # This repo is public; a hardcoded account-qualified name would publish the
  # destination account id. An unset var produces a nonsense bucket name and
  # the apply fails loudly rather than colliding with the live origin.
  account_id = get_env("TERRAGRUNT_ACCOUNT_ID", "000000000000")

  # Content-Security-Policy for the built Starlight docs bundle:
  #   - script-src: client JS is bundled same-origin (/_astro/*.js) → 'self';
  #     Starlight emits a few inline <script> blocks (theme init, view
  #     transitions) → 'unsafe-inline'; the Pagefind search compiles a WASM
  #     module → 'wasm-unsafe-eval'.
  #   - style-src: Astro ships scoped inline <style> and style="" attributes →
  #     'unsafe-inline'; the theme CSS @imports the Google Fonts stylesheet →
  #     https://fonts.googleapis.com.
  #   - font-src: that stylesheet pulls the woff2 faces from fonts.gstatic.com.
  #   - connect-src / worker-src: Pagefind fetches its index + fragments and
  #     spawns a worker, all same-origin → 'self'.
  #   - img-src: 'self' plus data: URIs (inlined icons/marks).
  content_security_policy = join("; ", [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "worker-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ])
}

inputs = {
  # Identity — a subdomain site: the records live in the parent nanohype.dev zone,
  # which is managed elsewhere (adopted via data source, not created here).
  domain      = "docs.nanohype.dev"
  hosted_zone = "nanohype.dev"

  # create_zone MUST stay false. The parent zone already exists in this account
  # (Z01486163EQUBJKF0RTR9). Flipping this creates a second zone for
  # docs.nanohype.dev that nothing delegates to.
  #
  # Until the NS switch that parent is inert — ACM cannot resolve a validation
  # record placed in it — so the first apply runs with
  # `-var create_validation_records=false` and the records are published from
  # the old account. Pass it as -var, never TF_VAR_*. See the note at the foot
  # of nanohype.dev's site/terragrunt.hcl.
  create_zone = false
  enable_www  = false

  # name_prefix scopes the module's derived names (e.g. the OAC) for docs.
  name_prefix = "nanohype-docs-"

  # Account-qualified, and permanently so. S3 names are global; 351619759866
  # still holds `nanohype-docs-site` and will until after the cutover.
  site_bucket_name = "nanohype-docs-site-${local.account_id}"

  # The publish role for docs is owned by the standalone deploy component in
  # nanohype.dev (github_repos includes nanohype/docs), so this module must not
  # create a colliding role.
  create_deploy_role = false
  github_repository  = "nanohype/docs"

  content_security_policy = local.content_security_policy
}
