# CLAUDE.md — docs

Inherits org conventions from `nanohype/Claude.md`. This is a public Astro/Starlight
documentation site for the nanohype factory and platform.

See `AGENTS.md` for the agent-facing entry point (commands, content rules, infra).

## Stack

- Node 24+, pnpm, Astro 7, Starlight, `@shuttering/starlight` (void + beam)
- `@nanohype/error-pages` renders the 500 page from `@nanohype/tokens`;
  `prebuild` emits it, `postbuild` checks the published file
- Biome for lint/format; `astro check` for types
- Infra: Terragrunt leaf → shared landing-zone site module (S3 + CloudFront)

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm check
```

## Conventions

- Greenfield prose — no migration framing in published pages
- Pod Identity, not IRSA; Crossplane + provider-opentofu, not CAPA
- Apache-2.0 (LICENSE at repo root)
