locals {
  environment         = "production"
  cost_center         = "nanohype-docs"
  business_unit       = "nanohype"
  data_classification = "public"
  compliance          = "none"
  repository          = "nanohype/docs"
  owner               = "nanohype"

  # The team that OPERATES these resources, per the required tier of the org
  # resource-tagging standard. Distinct from owner (the escalation handle) and
  # from cost_center (the billing rollup): the three answer different questions
  # and diverge the moment one moves without the others.
  team = "nanohype"
}
