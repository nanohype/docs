output "bucket_name" {
  description = "The origin bucket name — the deploy workflow syncs the built site here."
  value       = aws_s3_bucket.site.id
}

output "distribution_id" {
  description = "The CloudFront distribution id — the deploy workflow invalidates it after a sync."
  value       = aws_cloudfront_distribution.site.id
}

output "distribution_domain_name" {
  description = "The distribution's *.cloudfront.net domain (what the alias record targets)."
  value       = aws_cloudfront_distribution.site.domain_name
}

output "deploy_role_arn" {
  description = "ARN of the GitHub OIDC deploy role — set as the AWS_DEPLOY_ROLE_ARN repo variable to enable the deploy workflow."
  value       = aws_iam_role.deploy.arn
}
