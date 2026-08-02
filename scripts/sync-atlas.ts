/**
 * Copy the emitted atlas diagrams into `public/atlas/` before a build.
 *
 * The SVGs are emitted in `nanohype/.github` and are not committed here — the
 * pages under /atlas/ render what that repo last emitted, not a copy of it that
 * someone has to remember to refresh. Astro serves `public/` verbatim, so a
 * prebuild copy is all that is needed to reference them from a page.
 *
 * Everything this validates is validated here rather than at page-render time
 * because a missing diagram should stop the build before Astro starts, with a
 * message that names the directory it looked in.
 *
 * Usage: node scripts/sync-atlas.ts
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { atlasFailure, readAtlasManifest, resolveAtlasDir } from "../src/lib/atlas.ts";

const source = resolveAtlasDir();
if (!existsSync(source)) {
  throw atlasFailure(source, "That directory does not exist.");
}

const entries = await readAtlasManifest(source);
const target = "public/atlas";

// Swept first, and only of SVGs. A renamed perspective would otherwise leave
// its old diagram behind to be served forever by a page nothing links to.
await mkdir(target, { recursive: true });
for (const name of await readdir(target)) {
  if (name.endsWith(".svg")) await rm(join(target, name));
}

for (const entry of entries) {
  await copyFile(join(source, entry.svg), join(target, entry.svg));
}

console.log(`atlas: ${entries.length} diagram(s) from ${source}`);
