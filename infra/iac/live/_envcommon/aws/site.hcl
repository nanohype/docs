# Shared wiring for the nanohype.dev site component: points every live leaf at the
# published landing-zone module. Concrete inputs live in the leaf terragrunt.hcl.
terraform {
  source = "git::git@github.com:stxkxs/landing-zone.git//iac/components/aws/site?ref=site-v1.1.0"
}
