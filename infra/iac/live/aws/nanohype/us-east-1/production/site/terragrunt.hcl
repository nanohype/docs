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

  # Required by the module. Its three uses are the site-bucket fallback, the
  # www-bucket fallback and the deploy role name — the bucket name is set below,
  # enable_www is false and no role is created, so it governs nothing here. The OAC
  # takes its name from the resolved site bucket, not from this prefix.
  name_prefix = "nanohype-docs-"

  # Account-qualified, and permanently so. S3 names are global; 351619759866
  # still holds `nanohype-docs-site` and will until after the cutover.
  site_bucket_name = "nanohype-docs-site-${local.account_id}"

  # The publish role for docs is owned by the standalone deploy component in
  # nanohype.dev (its github_repositories includes nanohype/docs), so this module
  # must not create a colliding role.
  create_deploy_role = false

  # Required by the module whether or not it creates the role: both inputs are
  # declared with no default, so omitting them fails the plan on a missing
  # variable rather than being ignored alongside create_deploy_role = false.
  #
  # The value is the trust boundary — the numeric repository id from
  # `gh api repos/OWNER/NAME --jq .id`, which survives a rename. The key is what
  # a reader sees in the role description.
  github_repositories = {
    "nanohype/docs" = "1298572588"
  }

  # deploy.yml is the only workflow here that assumes a role, and every path into
  # it resolves to main: the `workflow_run` trigger runs on the default branch,
  # and `workflow_dispatch` is dispatched against it. ci.yml requests no id-token,
  # so no pull-request subject is trusted.
  github_sub_refs = ["ref:refs/heads/main"]

  # The TXT RRset at docs.nanohype.dev, which is this site's own name and not the apex.
  # nanohype.dev's Search Console token and its apex SPF belong to the site leaf in
  # nanohype/nanohype.dev, which owns that name; a string published here would land on
  # the subdomain and leave the apex as it was, with a clean plan either way.
  domain_txt_records = []

  content_security_policy = local.content_security_policy
}
