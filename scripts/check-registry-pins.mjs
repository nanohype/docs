#!/usr/bin/env node
/**
 * check-registry-pins.mjs — assert the lockfile still resolves @shuttering
 * packages from the registry each one actually lives in.
 *
 * The `@shuttering` scope is split across two registries. `.npmrc` routes the
 * whole scope to GitHub Packages, which is right for `error-pages` and
 * `tokens` — but `@shuttering/starlight` is published to npmjs, and a copy of
 * 0.2.0 also exists on GitHub Packages *with different bytes*. Which registry
 * the lockfile records therefore decides what gets installed.
 *
 * `pnpm.overrides` holds starlight to its npmjs tarball URL. That override is
 * load-bearing and pnpm does not keep it: 10.32.1 rewrites the URL form to a
 * plain `0.2.0` on any lockfile regeneration — a full install and
 * `pnpm update <pkg> --lockfile-only` alike. The rewritten entry resolves
 * through the scope routing to GitHub Packages and fails integrity against the
 * hash the lockfile still carries.
 *
 * That failure is silent locally and red in CI, several minutes after a push,
 * with an error about checksums that names neither the override nor the
 * registry split. This check turns it into an immediate, local, explained one.
 *
 * It does not fix the split — that is a publishing decision, not a docs-repo
 * one. It stops a routine version bump from silently repointing a dependency
 * at a different registry while nobody is looking.
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
      "published to npmjs; the copy of this version on GitHub Packages has different bytes, " +
      "and .npmrc would otherwise route the whole @shuttering scope there",
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
        "    alike. The rewritten entry resolves through .npmrc's scope routing to\n" +
        "    GitHub Packages, whose copy of this version has different bytes, and\n" +
        "    the install fails on integrity.",
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
