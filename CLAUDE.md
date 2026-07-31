# CLAUDE.md — docs

Inherits org conventions from `nanohype/Claude.md`. This is a public Astro/Starlight
documentation site for the nanohype factory and platform.

See `AGENTS.md` for the agent-facing entry point (commands, content rules, infra).

## Stack

- Node 24+, pnpm, Astro 7, Starlight, `@shuttering/starlight` (void + beam)
- Biome for lint/format; `astro check` for types
- Infra: Terragrunt leaf → shared landing-zone site module (S3 + CloudFront)

## Scripts

```bash
pnpm dev
pnpm build
pnpm lint
pnpm check
```

## The @shuttering scope spans two registries

`.npmrc` routes the whole `@shuttering` scope to GitHub Packages, which is
right for `error-pages` and `tokens`. `@shuttering/starlight` is on **npmjs**,
and a copy of 0.2.0 also exists on GitHub Packages **with different bytes** —
so which registry the lockfile records decides what gets installed.

`pnpm.overrides` holds starlight to its npmjs tarball URL. **pnpm does not keep
that override across a lockfile regeneration** — 10.32.1 rewrites the URL form
to a plain `0.2.0` on a full install and on
`pnpm update <pkg> --lockfile-only` alike. The result installs the wrong bytes
and fails CI on integrity.

So: after any dependency change, run `pnpm run check:pins` before pushing. If
it fails, restore the `resolution: {tarball: …}` entry and the URL-form package
keys for starlight rather than accepting the regenerated lockfile.

This is a workaround for a split that should not exist. The durable fix is to
publish the whole scope to one registry — the `shuttering` org is owned on
npmjs, so consolidating there is available and would let `.npmrc`'s scope
routing and the override both go away.

## Conventions

- Greenfield prose — no migration framing in published pages
- Pod Identity, not IRSA; Crossplane + provider-opentofu, not CAPA
- Apache-2.0 (LICENSE at repo root)
