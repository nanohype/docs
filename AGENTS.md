# AGENTS.md — docs

Public Astro/Starlight site for the nanohype org. Agent entry point for this repo.

## What this is

- Content site at docs.nanohype.dev — not a product service. No application
  runtime, no eval suite, no coverage floor requirement
- There *is* a unit tier: vitest over the pure functions in `src/lib/` (the two
  link rewriters, the path resolver, the HTML-text helpers, the catalog
  collection helpers). It runs first in CI, before any checkout, because it
  needs neither. It is deliberately narrow — anything that reads the catalog,
  the atlas or `dist/` belongs to the postbuild gates, which run against the
  real thing rather than a fixture of it
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
- `scripts/check-transitions.ts` is the third assertion over `dist/`, run in CI
  as `pnpm check:transitions`. It drives headless Chrome over CDP and reads
  `getComputedStyle(el).viewTransitionName` on every element of every route, so
  it measures what the cascade produced rather than what a stylesheet says. A
  `view-transition-name` claimed twice aborts the whole transition, and nothing
  else in this repo can see that — a site whose every transition is dead passes
  the type gate, the lint gate, the unit tier and both postbuild gates. Run it
  against any `@shuttering/starlight` change, and against a build known to be
  broken before trusting a green run: a check that has never failed is a claim
  about the checker. It needs a Chrome on the machine (`CHROME_PATH` overrides
  the search) and fails rather than skipping when there is none. It runs as its
  own CI step rather than in `postbuild`, so `deploy.yml` does not need a
  browser to ship a page

## Commands

```bash
pnpm install
pnpm lint            # biome check .
pnpm check           # astro check
pnpm check:transitions   # view-transition uniqueness over dist/, needs Chrome
pnpm test            # vitest, unit tier over src/lib/
pnpm format          # biome check --write . — what to run when lint fails
pnpm preview         # serve the built dist/
pnpm build           # error pages + astro build + postbuild gates
pnpm dev
```

## Sibling checkouts

Five sections of this site are generated from other repos: `/catalog/` and the
guides from the catalog, `/repos/` from each repo's `AGENTS.md`, `/atlas/` from
the diagrams `nanohype/.github` emits, and `/platform/resources/` from the two
control planes' API definitions. `src/lib/checkouts.ts` resolves them against
the parent of the working directory, which is the org's layout — each repo
beside the others.

A git worktree is not beside its siblings. Its parent is the worktree root,
which holds no checkouts, so a build there fails on the first generated section
and reports one missing directory at a time. Name the directory the real
checkouts sit in and all five resolve from it:

```bash
NANOHYPE_CHECKOUTS_DIR=~/codes/nanohype pnpm build
```

The four per-repo variables `ci.yml` sets — `NANOHYPE_CATALOG_DIR`,
`NANOHYPE_ATLAS_DIR`, `NANOHYPE_CRDS_DIR`, `NANOHYPE_XRDS_DIR` — override that
base one path at a time, and each wins where it is set. CI needs them because
its layout is not the org's: it clones what it needs into the workspace, two of
them sparsely, so no single directory is the parent of all five.

## SEO / agent surface

- `seo-baseline`'s required files are emitted, not committed: `/robots.txt` and
  `/llms.txt` are routes under `src/pages/`, and `sitemap-index.xml` comes from
  `@astrojs/sitemap`. `llms.txt` is generated from the same collections the
  pages render, so a page added upstream appears in it on the next build
- `/og.png` is the exception: rendered from `src/assets/og.svg` by
  `node scripts/render-og.ts` and **committed**. Rasterising text needs fonts a
  CI runner does not have, so a build-time render would differ from this one
  silently. Regenerate and commit after editing the SVG
- `src/components/Head.astro` adds what Starlight does not emit — `og:image`,
  the Twitter card's title/description/image, `robots`, and the `llms.txt`
  alternate link. Title and description are read back out of the head Starlight
  already built so the Twitter tags cannot drift from the Open Graph ones
- **Knowingly unmet:** `seo-baseline`'s `shared-implementation` rule (severity
  `warn`) asks for the head tags and generators to come from a shared package.
  No such package exists in the org — `nanohype/` ships `error-pages`, `sdk`,
  `cli`, `mcp-server`, `library` and `tokens`, and no SEO layer. This repo
  hand-rolls them until one exists. Do not "fix" it by inventing a private copy;
  the fix is a shared package, which is a catalog decision

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
- Shared site module from landing-zone, pinned by tag in `_envcommon/aws/site.hcl`;
  `create_deploy_role = false`
  (publish role is shared with nanohype.dev)
- No state-migration `moved` blocks — adoption is complete
- `ci.yml`'s `iac` job runs `./scripts/pin-drift.sh infra/iac/live`: it resolves the
  `?ref=` against the module remote, checks it still points where
  `infra/iac/live/module-pins.lock` records, and reads the leaf's inputs against
  the variables that version declares. No AWS credentials
- **Cut the tag on `stxkxs/landing-zone` before merging a pin bump.** A ref naming
  a tag that does not exist cannot be fetched, so it fails at plan either way — the
  gate moves that failure in front of a reviewer
- **Bumping a ref is not a one-word edit** when the version changed its variable
  surface; the leaf's inputs move in the same commit
- `./scripts/pin-drift.sh infra/iac/live --plan` adds the layer that reads the
  account, classifying each proposed change `DESTRUCTIVE`, `REVERTING` or
  `ADVANCING`. It needs AWS read and runs from a workstation. State records which
  resources exist and not which module version produced them, so a leaf pinned
  behind the version that was applied plans a reversal that every credential-free
  check calls green. Do not apply as tracked to clear one — pin the version the
  account is running, and re-plan to empty

## Do not

- Reintroduce IRSA as the primary identity path
- Add an in-repo site OpenTofu component (deleted; use the shared module)
- Commit real AWS account ids — use `TERRAGRUNT_ACCOUNT_ID` at apply time
