/**
 * Asserts that the platform vocabulary this site publishes is the vocabulary
 * the platform ships.
 *
 * Runs against `dist/`, not against source, so it covers the generated pages
 * too — the catalog skeletons, the guides pulled from the catalog repo, the
 * contracts pulled from each repo. Those are the pages most likely to name a
 * resource nobody checked, because nobody here wrote them.
 *
 * Two assertions, both positive — each one names something that must exist,
 * never something that must not appear:
 *
 *   1. Every `<label>.nanohype.dev` the site prints is an API group a control
 *      plane serves, a reserved label namespace, or a hostname this site serves.
 *   2. Every `kind:` next to an `apiVersion:` in one of those groups is a kind
 *      that group ships.
 *
 * The second is the one that earns its keep. A manifest naming a resource the
 * API server would reject is indistinguishable from a correct one on the page,
 * and an agent reading this site as its front door will apply it and get an
 * error whose text says nothing about where it came from.
 *
 * What this does not do is judge prose. "AgentFleet runs <product>" is a claim
 * about the world that no lexical check can settle. That is what the generated
 * pages are for: the reference under /platform/resources/ has no independent
 * record to be wrong with, so there is nothing there to drift.
 */
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadCatalogData } from "../src/lib/catalog.ts";
import { listPlatformResources } from "../src/lib/resources.ts";

const DIST = "dist";

/**
 * Subdomains of nanohype.dev that are origins rather than API groups. Kept
 * short deliberately: a new one showing up here should be a decision someone
 * makes, not a line this file quietly grew.
 */
const HOSTNAMES = new Set(["docs", "www"]);

/**
 * `tenants.nanohype.dev/` is a label namespace, not an API group — nothing
 * serves it, and a page naming it is labelling an object rather than applying
 * one. The reserved namespaces are declared in the resource-tagging standard,
 * so they are read from there rather than listed again here: one of them being
 * retired should retire it everywhere at once.
 */
async function labelNamespaces(): Promise<Set<string>> {
  const { standards } = await loadCatalogData();
  const reserved = (
    standards["resource-tagging"]?.content as { reserved_prefixes?: { k8s?: unknown } } | undefined
  )?.reserved_prefixes?.k8s;

  if (!Array.isArray(reserved)) {
    throw new Error(
      "The resource-tagging standard no longer declares content.reserved_prefixes.k8s.\n" +
        "That list is what tells this check which nanohype.dev names are label\n" +
        "namespaces rather than API groups. Update scripts/check-vocabulary.ts to\n" +
        "read wherever they moved to.",
    );
  }

  return new Set(
    reserved
      .filter((prefix): prefix is string => typeof prefix === "string")
      .map((prefix) => prefix.replace(/\/$/, "")),
  );
}

/**
 * Recovers the text a reader sees. Inline markup is removed with nothing in its
 * place, because a highlighted code block is one string cut into spans and any
 * separator would corrupt it; everything else becomes a newline so that prose
 * from adjacent blocks cannot run together into a token that was never written.
 */
const INLINE = /<\/?(?:span|a|code|em|strong|b|i|mark|sup|sub)\b[^>]*>/gi;
const TAG = /<[^>]+>/g;

/**
 * Applies a pattern until the string stops changing.
 *
 * One pass is not enough: removing a match can splice its neighbours into a new
 * match that the same pass already stepped over. `<<span>span>` reduces to
 * `<span>` and would survive, taking whatever it wrapped out of the scan with
 * it. Repeating to a fixed point is what makes "the tags are gone" true rather
 * than usually true, and every pattern here only ever shortens the string, so
 * it terminates.
 */
function stripToFixedPoint(input: string, pattern: RegExp, replacement: string): string {
  let current = input;
  for (;;) {
    const next = current.replace(pattern, replacement);
    if (next === current) return current;
    current = next;
  }
}

function textOf(html: string): string {
  const withoutScripts = stripToFixedPoint(html, /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "\n");
  const withoutInline = stripToFixedPoint(withoutScripts, INLINE, "");
  return stripToFixedPoint(withoutInline, TAG, "\n")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

async function* htmlFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* htmlFiles(path);
    else if (entry.name.endsWith(".html")) yield path;
  }
}

const GROUP = /\b([a-z0-9-]+)\.nanohype\.dev\b/g;

/**
 * The version is matched as alphanumerics rather than as non-space, because
 * prose puts punctuation right after it — a sentence ending in
 * `apiVersion: fleet.nanohype.dev/v1alpha1`. carries a full stop that is not
 * part of the version, and once the inline markup is stripped there is nothing
 * left to tell them apart.
 */
const API_VERSION = /apiVersion:\s*([a-z0-9.-]+\.nanohype\.dev)\/([A-Za-z0-9]+)/g;

/**
 * `apiVersion` and `kind` are adjacent in every manifest anyone writes, but not
 * always on consecutive lines once a comment sits between them. The window is
 * wide enough to survive that and narrow enough that it cannot reach the next
 * document in a multi-document file.
 */
const KIND_WINDOW = 400;
const KIND = /^\s*kind:\s*([A-Za-z][A-Za-z0-9]*)/m;

interface Violation {
  file: string;
  detail: string;
}

const resources = await listPlatformResources();
const groups = new Set(resources.map((resource) => resource.group));
const labels = await labelNamespaces();
const kindsByGroup = new Map<string, Set<string>>();
for (const resource of resources) {
  const existing = kindsByGroup.get(resource.group);
  if (existing) existing.add(resource.kind);
  else kindsByGroup.set(resource.group, new Set([resource.kind]));
}

const violations: Violation[] = [];
let pages = 0;
let manifests = 0;
let names = 0;

for await (const file of htmlFiles(DIST)) {
  pages += 1;
  const text = textOf(await readFile(file, "utf8"));
  const page = file.slice(DIST.length + 1);

  for (const match of text.matchAll(GROUP)) {
    names += 1;
    if (groups.has(match[0]) || labels.has(match[0]) || HOSTNAMES.has(match[1])) continue;
    violations.push({
      file: page,
      detail: `names "${match[0]}", which is neither an API group any control plane serves nor a reserved label namespace.`,
    });
  }

  for (const match of text.matchAll(API_VERSION)) {
    const [, group, version] = match;
    const shipped = kindsByGroup.get(group);
    if (!shipped) continue; // Already reported by the group check above.

    const known = resources.find((r) => r.group === group)?.versions ?? [];
    if (!known.includes(version)) {
      violations.push({
        file: page,
        detail: `uses apiVersion "${group}/${version}"; ${group} serves ${known.join(", ")}.`,
      });
    }

    const window = text.slice(match.index, match.index + KIND_WINDOW);
    const kind = window.match(KIND)?.[1];
    if (!kind) continue;
    manifests += 1;
    if (!shipped.has(kind)) {
      violations.push({
        file: page,
        detail: `applies kind "${kind}" in group ${group}, which ships ${[...shipped].sort().join(", ")}.`,
      });
    }
  }
}

if (violations.length > 0) {
  console.error(
    `\nThe published site names ${violations.length} resource(s) no control plane ships.\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.file}\n    ${violation.detail}`);
  }
  console.error(
    [
      "",
      "Every apiVersion and kind on this site has to resolve against the definitions",
      "eks-agent-platform and eks-fleet ship. If the resource is real, the control",
      "plane is missing it. If it is not, the page is teaching a manifest the API",
      "server will reject.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Both numbers, because they measure different things. The name count is the
// site-wide sweep; the manifest count is how many places actually spell out an
// apiVersion and a kind, and it is small because the pages mostly talk about
// resources rather than print them. It grows as the site prints more.
console.log(
  `vocabulary ok — ${names} nanohype.dev name(s) and ${manifests} manifest(s) across ${pages} pages` +
    ` resolve against ${resources.length} shipped resources in ${groups.size} groups.`,
);
