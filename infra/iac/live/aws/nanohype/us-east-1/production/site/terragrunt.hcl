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

  # The docs deploy role has always been owned by this site component (the local
  # component created aws_iam_role.deploy); keep that ownership.
  create_deploy_role = true
  github_repository  = "nanohype/docs"

  content_security_policy = local.content_security_policy
}

# ─── State migration: local component addresses → shared module addresses ──────
# The site was previously served by the in-repo //components/aws/site component.
# These moves relink the existing state onto the shared module's addresses so the
# ref adoption is a state move, not a destroy+create. The module's own www moves
# (un-indexed → [0]) are handled by moved blocks inside the module; enable_www =
# false makes those no-ops here.
generate "moved" {
  path      = "zz_moved.tf"
  if_exists = "overwrite"
  contents  = <<-EOF
    # The single apex/site distribution: renamed .site → .apex.
    moved {
      from = aws_cloudfront_distribution.site
      to   = aws_cloudfront_distribution.apex
    }

    # The deploy role + its inline policy gained count(var.create_deploy_role).
    moved {
      from = aws_iam_role.deploy
      to   = aws_iam_role.deploy[0]
    }
    moved {
      from = aws_iam_role_policy.deploy
      to   = aws_iam_role_policy.deploy[0]
    }

    # The apex A alias: renamed .alias → .apex and keyed by record type. The
    # matching AAAA instance has no predecessor and is created fresh.
    moved {
      from = aws_route53_record.alias
      to   = aws_route53_record.apex["A"]
    }

    # The shared module does not manage bucket versioning. Drop the local
    # aws_s3_bucket_versioning.site from state WITHOUT touching the live bucket
    # (destroy = false) — versioning stays Enabled on the origin, content intact.
    removed {
      from = aws_s3_bucket_versioning.site
      lifecycle {
        destroy = false
      }
    }
  EOF
}
