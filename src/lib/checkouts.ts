import { resolve } from "node:path";

/**
 * Where the org's other repos are.
 *
 * Every generated section on this site reads a sibling checkout — the catalog,
 * the atlas emit, the two control planes' API definitions. The layout is the
 * org's own: each repo beside the others, so a path out of this one and back
 * down reaches any of them.
 *
 * Resolved against `process.cwd()` rather than `import.meta.url`. These modules
 * are bundled into `dist/.prerender/chunks/` before they run, so a URL-relative
 * path resolves against the chunk and lands inside this repo — pointing the
 * loaders at a directory that exists and holds none of what they came for.
 *
 * The override exists because CI has no sibling checkouts. It clones what it
 * needs into the workspace and names each location through the environment.
 */
export function siblingDir(env: string, ...segments: string[]): string {
  const override = process.env[env];
  if (override) return override;
  return resolve(process.cwd(), "..", ...segments);
}
