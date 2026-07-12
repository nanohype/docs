# Shared wiring for the nanohype.dev site component: points every live leaf at the
# component source. Concrete inputs live in the leaf terragrunt.hcl.
terraform {
  source = "${dirname(find_in_parent_folders("cloud.hcl"))}/../..//components/aws/site"
}
