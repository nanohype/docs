# AGENTS.md — docs

Public Astro/Starlight site for the nanohype org. Agent entry point for this repo.

## What this is

- Content site at docs.nanohype.dev — not a product service
- No application runtime, no eval suite, no coverage floor requirement
- Biome is the lint/format gate; `astro check` is the type gate; CI also runs
  osv-scanner and a production build

## Commands

```bash
pnpm install
pnpm lint            # biome check .
pnpm check           # astro check
pnpm build           # error pages + astro build + 500.html assertion
pnpm dev
```

## Content rules

- Describe the design state, never migration history (greenfield doctrine)
- Identity model is **EKS Pod Identity**, not IRSA — no role-arn annotation claims
- `eks-fleet` vends via Crossplane + provider-opentofu, not CAPA
- Standards: count `nanohype/standards/*.json` before claiming how many — never guess, and never list a subset as if it were all of them
- Public repo table should name this repo and `homebrew-tap` when claiming coverage

## Infra

- Leaf: `infra/iac/live/aws/nanohype/us-east-1/production/site/`
- Shared site module from landing-zone (`site-v1.1.0`); `create_deploy_role = false`
  (publish role is shared with nanohype.dev)
- No state-migration `moved` blocks — adoption is complete

## Do not

- Reintroduce IRSA as the primary identity path
- Add an in-repo site OpenTofu component (deleted; use the shared module)
- Commit real AWS account ids — use `TERRAGRUNT_ACCOUNT_ID` at apply time
