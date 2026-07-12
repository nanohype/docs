locals {
  # Placeholder only. The real account id (also the state + SES account) is
  # injected at run time via TERRAGRUNT_ACCOUNT_ID so it never lands in a tracked
  # file. See root.hcl and DEPLOY.md (the state bucket resolves to
  # {account_id}-us-east-1-tfstate).
  account_id    = "000000000000" # Replace via TERRAGRUNT_ACCOUNT_ID
  account_alias = "nanohype"
}
