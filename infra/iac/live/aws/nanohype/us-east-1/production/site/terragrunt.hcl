include "root" {
  path = find_in_parent_folders("root.hcl")
}

include "envcommon" {
  path           = "${dirname(find_in_parent_folders("cloud.hcl"))}/../_envcommon/aws/site.hcl"
  merge_strategy = "deep"
}

locals {
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
  create_zone = false
  enable_www  = false

  # name_prefix derives the deploy role (nanohype-docs-site-deploy) and the
  # www-redirect bucket name (unused, enable_www = false); the origin bucket is
  # pinned to its existing name so the live content bucket is adopted, not
  # replaced.
  name_prefix      = "nanohype-docs-"
  site_bucket_name = "nanohype-docs-site"

  # nanohype's publish role lives in the standalone deploy component in nanohype.dev —
  # one role shared across nanohype.dev + docs.nanohype.dev — so this site module must
  # not create a colliding one. CI assumes it via the AWS_DEPLOY_ROLE_ARN variable.
  create_deploy_role = false
  github_repository  = "nanohype/docs"

  content_security_policy = local.content_security_policy
}
