locals {
  account_vars = read_terragrunt_config(find_in_parent_folders("account.hcl"))
  region_vars  = read_terragrunt_config(find_in_parent_folders("region.hcl"))
  env_vars     = read_terragrunt_config(find_in_parent_folders("env.hcl"))

  region      = local.region_vars.locals.region
  environment = local.env_vars.locals.environment

  # TERRAGRUNT_ACCOUNT_ID injects the real AWS account id at run time so it never
  # lands in a tracked file (account.hcl carries only a placeholder). Falls back to
  # account.hcl for a local deploy where the operator sets it there directly.
  account_id = get_env("TERRAGRUNT_ACCOUNT_ID", local.account_vars.locals.account_id)

  # Common metadata → tags.
  cost_center         = local.env_vars.locals.cost_center
  business_unit       = local.env_vars.locals.business_unit
  data_classification = local.env_vars.locals.data_classification
  compliance          = local.env_vars.locals.compliance
  repository          = local.env_vars.locals.repository

  # Recommended-tier tags (own/trace/expire). owner falls back to cost_center;
  # revision is the CI commit (GITHUB_SHA), "local" off-CI.
  owner    = try(local.env_vars.locals.owner, local.cost_center)
  revision = substr(get_env("GITHUB_SHA", "local"), 0, 7)
}

# --- Common inputs ---
# region + environment are declared (no default) by every component, so the root
# resolves and passes them down. Component-specific inputs come from each
# component's _envcommon/*.hcl and the live leaf.
inputs = {
  region      = local.region
  environment = local.environment
}

# --- Provider ---
# One AWS provider, anchored on us-east-1 — the region CloudFront's ACM cert must
# live in, and where SES inbound runs, so the whole surface collapses to it. The
# default_tags carry the org tagging standard onto every resource a component
# creates.
generate "provider" {
  path      = "provider.tf"
  if_exists = "overwrite_terragrunt"
  contents  = <<EOF
provider "aws" {
  region = "${local.region}"
  default_tags {
    tags = {
      Environment        = "${local.environment}"
      ManagedBy          = "opentofu"
      Project            = "nanohype-docs"
      CostCenter         = "${local.cost_center}"
      BusinessUnit       = "${local.business_unit}"
      DataClassification = "${local.data_classification}"
      Compliance         = "${local.compliance}"
      Repository         = "${local.repository}"
      Owner              = "${local.owner}"
      Revision           = "${local.revision}"
      Lifecycle          = "persistent"
    }
  }
}
EOF
}

# --- Remote State ---
# Anchored on the AWS account + region: the state bucket resolves to
# {account_id}-us-east-1-tfstate (S3-native locking, no DynamoDB table).
remote_state {
  backend = "s3"

  config = {
    encrypt      = true
    bucket       = "${local.account_id}-${local.region}-tfstate"
    key          = "docs/${local.environment}/${path_relative_to_include()}/terraform.tfstate"
    region       = local.region
    use_lockfile = true
  }

  generate = {
    path      = "backend.tf"
    if_exists = "overwrite_terragrunt"
  }
}
