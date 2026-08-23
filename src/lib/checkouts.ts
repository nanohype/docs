import { resolve } from "node:path";

/**
 * The directory the org's other repos are checked out into.
 *
 * Defaults to the parent of the working directory, which is the org's own
 * layout: each repo beside the others, so a path out of this one and back down
 * reaches any of them.
 *
 * A git worktree is the case that default gets wrong. A worktree of this repo
 * lives under the worktree root rather than beside the catalog and the atlas,
 * so the parent directory holds none of them and every generated section fails
 * — one at a time, each after a build. Name the directory the real checkouts
 * sit in and all five resolve:
 *
 * ```
 * NANOHYPE_CHECKOUTS_DIR=~/codes/nanohype pnpm build
 * ```
 *
 * Resolved against `process.cwd()` rather than `import.meta.url`. These modules
 * are bundled into `dist/.prerender/chunks/` before they run, so a URL-relative
 * path resolves against the chunk and lands inside this repo — pointing the
 * loaders at a directory that exists and holds none of what they came for.
 */
function checkoutsDir(): string {
  return process.env.NANOHYPE_CHECKOUTS_DIR || resolve(process.cwd(), "..");
}

/**
 * Where one sibling checkout's contents are.
 *
 * The per-repo override wins over the base directory, because a layout that is
 * not the org's needs each location named individually: CI clones what it needs
 * into the workspace under paths of its own choosing, and sparsely, so no one
 * directory is the parent of all five.
 */
export function siblingDir(env: string, ...segments: string[]): string {
  const override = process.env[env];
  if (override) return override;
  return resolve(checkoutsDir(), ...segments);
}
