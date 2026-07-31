#!/usr/bin/env node
/**
 * check-registry-pins.mjs — assert the lockfile still resolves @shuttering
 * packages from the registry each one actually lives in.
 *
 * The `@shuttering` scope is split across two registries, and it is a hole
 * rather than a conflict. `.npmrc` routes the whole scope to GitHub Packages,
 * which is where every package in it lives *except* `@shuttering/starlight` —
 * that one is published to npmjs and is absent from GitHub Packages entirely
 * (404, "does not exist under owner"). npm's registry routing is per-scope
 * with no per-package escape, so the one package that is not where the scope
 * points has nothing to resolve through.
 *
 * `pnpm.overrides` holds starlight to its npmjs tarball URL. That override is
 * load-bearing and pnpm does not keep it: 10.32.1 rewrites the URL form to a
 * plain `0.2.0` on any lockfile regeneration — a full install and
 * `pnpm update <pkg> --lockfile-only` alike. The rewritten entry has no
 * `tarball:` field left, so it resolves through the scope routing to GitHub
 * Packages and 404s.
 *
 * Declaring the URL as the `dependencies` specifier instead of an override
 * does not survive either; this was tried. pnpm canonicalises a recognisable
 * npmjs registry-tarball URL to its plain version wherever it is declared. The
 * `specifier:` line keeps the URL — which is exactly why this check does not
 * look there — while the package key and `resolution:` collapse to the bare
 * form. The override is not the fragile part; the URL form is.
 *
 * That failure is silent locally and red in CI, several minutes after a push,
 * with a 404 that names neither the override nor the registry split. This
 * check turns it into an immediate, local, explained one.
 *
 * It does not fix the split — that is a publishing decision, not a docs-repo
 * one, and the durable fix is for the whole scope to be resolvable from one
 * registry. It stops a routine version bump from silently repointing a
 * dependency at a registry that does not have it.
 *
 * Usage: node scripts/check-registry-pins.mjs
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Every dependency whose registry cannot be inferred from `.npmrc` alone.
 *
 * Written out rather than derived from `pnpm.overrides`: deriving it would make
 * the check agree with the override no matter what the override said, and the
 * failure being guarded against is precisely the override going missing.
 *
 * `resolution` is the line that decides where bytes come from, and it is the
 * one that disappears on a regeneration. It is NOT enough to look for the URL
 * anywhere in the lockfile — the `specifier:` line under `importers` echoes
 * package.json verbatim and survives the rewrite, so a substring search finds
 * it and reports intact pins on a lockfile that has already flipped.
 *
 * `forbiddenKey` is the same assertion from the other side: the bare-version
 * package key that only appears once the URL form is gone.
 */
const REQUIRED_PINS = [
  {
    pkg: "@shuttering/starlight",
    override: "https://registry.npmjs.org/@shuttering/starlight/-/starlight-0.2.0.tgz",
    resolution:
      "resolution: {tarball: https://registry.npmjs.org/@shuttering/starlight/-/starlight-0.2.0.tgz}",
    forbiddenKey: "'@shuttering/starlight@0.2.0'",
    why:
      "published to npmjs and absent from GitHub Packages, where .npmrc would " +
      "otherwise route the whole @shuttering scope",
  },
];

const lockPath = join(repoRoot, "pnpm-lock.yaml");
const lock = readFileSync(lockPath, "utf8");
const manifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const overrides = manifest.pnpm?.overrides ?? {};

const problems = [];

for (const { pkg, override, resolution, forbiddenKey, why } of REQUIRED_PINS) {
  if (overrides[pkg] !== override) {
    problems.push(
      `package.json: pnpm.overrides["${pkg}"] is ${
        overrides[pkg] === undefined ? "missing" : `"${overrides[pkg]}"`
      }\n    expected "${override}"\n    ${why}`,
    );
  }

  if (!lock.includes(resolution)) {
    problems.push(
      `pnpm-lock.yaml no longer resolves ${pkg} from npmjs.\n` +
        `    Expected to find:\n      ${resolution}\n` +
        "    pnpm rewrites the URL form to a plain version on any lockfile\n" +
        "    regeneration — a full install and `pnpm update <pkg> --lockfile-only`\n" +
        "    alike. The rewritten entry keeps no `tarball:` field, so it resolves\n" +
        "    through .npmrc's scope routing to GitHub Packages, which does not\n" +
        "    carry this package at all, and the install 404s.\n" +
        "\n" +
        "    Restore it with the override in package.json, then regenerate. Moving\n" +
        "    the URL into `dependencies` does not help — pnpm canonicalises an\n" +
        "    npmjs tarball URL wherever it is declared.",
    );
  }

  if (lock.includes(forbiddenKey)) {
    problems.push(
      `pnpm-lock.yaml carries the bare-version key ${forbiddenKey} for ${pkg}.\n` +
        "    That key only exists once the npmjs URL pin has been dropped.",
    );
  }
}

if (problems.length > 0) {
  console.error("Registry pins have drifted:\n");
  for (const p of problems) console.error(`  ${p}\n`);
  console.error(
    "The @shuttering scope is split across two registries; see the header of\n" +
      "this script for why, and CLAUDE.md for the standing constraint.",
  );
  process.exit(1);
}

console.log(`ok: ${REQUIRED_PINS.length} registry pin(s) intact`);
