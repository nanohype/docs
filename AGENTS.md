# AGENTS.md — docs

Public Astro/Starlight site for the nanohype org. Agent entry point for this repo.

## What this is

- Content site at docs.nanohype.dev — not a product service
- No application runtime, no eval suite, no coverage floor requirement
- Biome is the lint/format gate; `astro check` is the type gate; CI also runs
  osv-scanner and a production build
- `postbuild` runs two assertions over `dist/`, so they cover the generated
  pages as well as the authored ones:
  - `scripts/check-vocabulary.ts` — every `*.nanohype.dev` name is an API group
    a control plane serves or a reserved label namespace, and every `kind:` is
    one that group ships
  - `scripts/check-links.ts` — every internal link and `#fragment` resolves,
    every link into an org repo names a path that repo has at that ref, and
    every generated section published exactly the pages its source declares.
    Repo paths are checked against one tree listing per repo from the GitHub
    API; unreachable listings warn locally and **fail** under `CI`

## Commands

```bash
pnpm install
pnpm lint            # biome check .
pnpm check           # astro check
pnpm build           # error pages + astro build + postbuild gates
pnpm dev
```

## Content rules

- Describe the design state, never migration history (greenfield doctrine)
- **Tenant** identity is EKS Pod Identity — a tenant ServiceAccount carries no
  role-arn annotation, and no page should claim otherwise. Two control-plane
  bootstrap identities are IRSA-trusted (the operator's own role, and the fleet
  hub's provider) because each exists before the thing that would mint it;
  `/decisions/identity-binding/` states that boundary and it is accurate. Do not
  "correct" it to a blanket claim
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
