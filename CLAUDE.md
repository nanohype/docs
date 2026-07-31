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
where every package in it lives **except** `@shuttering/starlight`. That one is
published to npmjs and is absent from GitHub Packages entirely — a 404, not a
second copy. npm's registry routing is per-scope with no per-package escape, so
the one package that is not where the scope points has nothing to resolve
through.

`pnpm.overrides` holds starlight to its npmjs tarball URL. **pnpm does not keep
that override across a lockfile regeneration** — 10.32.1 rewrites the URL form
to a plain `0.2.0` on a full install and on
`pnpm update <pkg> --lockfile-only` alike. The rewritten entry has no
`tarball:` field left, so it resolves through the scope routing and 404s.

Moving the URL into `dependencies` instead of `pnpm.overrides` does not help;
this was tried. pnpm canonicalises a recognisable npmjs registry-tarball URL to
its plain version wherever it is declared. The override is not the fragile
part — the URL form is.

So: after any dependency change, run `pnpm run check:pins` before pushing. If
it fails, restore the `resolution: {tarball: …}` entry and the URL-form package
keys for starlight rather than accepting the regenerated lockfile.

This is a workaround for a split that should not exist, and the split has a
second cost: **this repository is public but cannot be built by the public**,
because `@shuttering/error-pages` is a private GitHub Packages dependency that
`prebuild` and `postbuild` both invoke. `pnpm install` needs a token.

The durable fix addresses both — make the whole scope resolvable from npmjs, so
`.npmrc`, the override and this note all go away, and a clone builds without
credentials.

## Conventions

- Greenfield prose — no migration framing in published pages
- Pod Identity, not IRSA; Crossplane + provider-opentofu, not CAPA
- Apache-2.0 (LICENSE at repo root)
