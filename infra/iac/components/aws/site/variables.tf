variable "domain" {
  description = "Subdomain the docs site serves at. Drives the certificate, the CloudFront alias, and the Route53 record."
  type        = string
  default     = "docs.nanohype.dev"
}

variable "zone_name" {
  description = "The parent Route53 hosted zone the docs subdomain's records are written into."
  type        = string
  default     = "nanohype.dev"
}

variable "bucket_name" {
  description = "Name of the private origin bucket CloudFront reads through OAC. Not user-visible (the site is only ever reached via the distribution)."
  type        = string
  default     = "nanohype-docs-site"
}

variable "github_repo" {
  description = "owner/repo whose GitHub Actions may assume the deploy role via OIDC (main branch only)."
  type        = string
  default     = "nanohype/docs"
}
