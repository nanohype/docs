# docs

Public documentation site for [nanohype](https://github.com/nanohype) — the k8s-native
software factory. Live at [docs.nanohype.dev](https://docs.nanohype.dev).

Starlight on the shuttering void + beam theme. Covers the catalog, fab, the platform
tenant model, and the substrate (landing-zone / eks-gitops / eks-fleet).

## Stack

- **Runtime:** Node 24+ (`.nvmrc`, `engines.node`, CI)
- **Site:** Astro 7 + `@astrojs/starlight` + `@shuttering/starlight`
- **Lint/format:** Biome (see `biome.json`)
- **Infra:** OpenTofu/Terragrunt leaf under `infra/iac/live/` consuming the shared
  landing-zone site module; S3 + CloudFront, OIDC deploy via the shared nanohype
  publish role

## Develop

```bash
pnpm install         # no credentials needed; every dependency is public
pnpm dev             # Astro dev server
pnpm build           # prebuild error pages + astro build + postbuild check
pnpm lint            # biome check (lint + format)
pnpm check           # astro check
pnpm test            # vitest over the pure functions in src/lib/
```

## Layout

- `src/content/docs/` — the published pages
- `src/components/Hero.astro` — custom Starlight hero
- `src/styles/site.css` — typefaces only; ground + palette come from shuttering
- `public/500.html` + `public/error.css` — JS-free 500 (404 is content-routed)
- `infra/iac/` — Terragrunt live leaf for docs.nanohype.dev
