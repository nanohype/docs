include "root" {
  path = find_in_parent_folders("root.hcl")
}

include "envcommon" {
  path           = "${dirname(find_in_parent_folders("cloud.hcl"))}/../_envcommon/aws/site.hcl"
  merge_strategy = "deep"
}

inputs = {
  domain      = "docs.nanohype.dev"
  zone_name   = "nanohype.dev"
  github_repo = "nanohype/docs"
}
