/**
 * Asserts that every reference this site publishes still resolves.
 *
 * The generated sections each carry their own staleness check, and each one can
 * only see its own source. None of them can see a link — a sentence in an
 * authored page pointing at a file in another repo, a cross-reference from one
 * section into a route another section owns. Those break when a repo moves,
 * which is precisely when nobody is looking at this site.
 *
 * Runs against `dist/`, so it covers the authored pages and the generated ones
 * together, and it sees what a reader sees rather than what a source file says.
 *
 * Four assertions:
 *
 *   1. Every site-internal link resolves to a page or asset that was built.
 *   2. Every `#fragment` exists as an id on the page it points at.
 *   3. Every link into an org repo names a path that repo actually has, at the
 *      ref the link names.
 *   4. Every generated section published exactly the pages its source declares.
 *
 * The fourth is the freshness half. The generators cannot ship a page describing
 * something that does not exist — they read the source of truth — but they can
 * quietly ship *fewer* pages than the source has, and a section that lost an
 * entry looks identical to one that never had it.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { loadAtlas } from "../src/lib/atlas.ts";
import { loadCatalogData } from "../src/lib/catalog.ts";
import { listPlatformResources, resourceSlug } from "../src/lib/resources.ts";

const DIST = "dist";

interface Violation {
  page: string;
  detail: string;
}

const violations: Violation[] = [];
function fail(page: string, detail: string): void {
  violations.push({ page, detail });
}

/* ── the built site ──────────────────────────────────────────────────────── */

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const files = new Set<string>();
const htmlByRoute = new Map<string, string>();

for await (const path of walk(DIST)) {
  const url = `/${relative(DIST, path).split("\\").join("/")}`;
  files.add(url);
  if (url.endsWith("/index.html")) {
    // Both spellings a link can use for a directory index.
    const route = url.slice(0, -"index.html".length);
    files.add(route);
    files.add(route.replace(/\/$/, ""));
    htmlByRoute.set(route, path);
  } else if (url.endsWith(".html")) {
    htmlByRoute.set(url, path);
  }
}

/** Ids on a page, read once and kept. */
const idCache = new Map<string, Set<string>>();
async function idsOf(path: string): Promise<Set<string>> {
  const cached = idCache.get(path);
  if (cached) return cached;
  const html = await readFile(path, "utf8");
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  idCache.set(path, ids);
  return ids;
}

function routeOf(url: string): string | undefined {
  for (const candidate of [url, `${url.replace(/\/$/, "")}/`, `${url}/`]) {
    if (htmlByRoute.has(candidate)) return candidate;
  }
  return undefined;
}

/* ── 1 + 2: internal links and their anchors ─────────────────────────────── */

const HREF = /href="([^"]+)"/g;

/** A repo link, split into the parts that have to be true separately. */
const REPO_LINK =
  /^https:\/\/github\.com\/nanohype\/([A-Za-z0-9._-]+?)(?:\.git)?(?:\/(blob|tree)\/([^/]+)\/([^"#?]*))?$/;

/** repo -> ref -> every path that ref holds. Filled lazily, one request each. */
const trees = new Map<string, Set<string>>();
const unreachable: string[] = [];

/**
 * Every path in a repo at a ref, from one recursive tree listing.
 *
 * One request per (repo, ref) rather than one per link: the site carries a few
 * hundred repo links and almost all of them point at the same two repos, so
 * per-link requests would be slow and would burn the rate limit for no extra
 * assurance.
 *
 * A truncated tree is treated as unreachable rather than as a source of truth —
 * a partial listing would report real paths as missing, which is worse than not
 * checking.
 */
async function treeOf(repo: string, ref: string): Promise<Set<string> | undefined> {
  const key = `${repo}@${ref}`;
  const cached = trees.get(key);
  if (cached) return cached;
  if (unreachable.includes(key)) return undefined;

  const url = `https://api.github.com/repos/nanohype/${repo}/git/trees/${ref}?recursive=1`;
  const headers: Record<string, string> = { accept: "application/vnd.github+json" };
  // Actions supplies a token; using it lifts the unauthenticated rate limit,
  // which a site this size would otherwise be close to on a busy day.
  if (process.env.GITHUB_TOKEN) headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  let payload: { tree?: { path: string }[]; truncated?: boolean };
  try {
    // Node's fetch has no default timeout, so a connection that opens and then
    // stalls never returns. This gate runs last in the build, which is the
    // worst place to hang from: the job holds a runner until the workflow
    // ceiling with no output. Ten seconds is far above a healthy tree listing
    // and a timeout lands in `unreachable` like any other failure — reported,
    // and fatal under CI rather than silently skipped.
    const response = await fetch(url, { headers, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    payload = await response.json();
  } catch (error) {
    unreachable.push(`${key} (${error instanceof Error ? error.message : String(error)})`);
    return undefined;
  }

  if (payload.truncated || !Array.isArray(payload.tree)) {
    unreachable.push(`${key} (tree listing truncated)`);
    return undefined;
  }

  const paths = new Set(payload.tree.map((node) => node.path));
  trees.set(key, paths);
  return paths;
}

const repoLinks = new Map<string, Set<string>>();

for (const [route, path] of htmlByRoute) {
  const html = await readFile(path, "utf8");

  for (const match of html.matchAll(HREF)) {
    const href = match[1];
    if (href.startsWith("mailto:") || href.startsWith("tel:")) continue;

    if (href.startsWith("http")) {
      const repo = href.match(REPO_LINK);
      if (repo) {
        const [, name, , ref = "", path = ""] = repo;
        if (path) {
          const key = `${name}@${ref}`;
          const seen = repoLinks.get(key) ?? new Set();
          seen.add(`${path.replace(/\/$/, "")}\u0000${route}`);
          repoLinks.set(key, seen);
        }
      }
      continue;
    }

    const [target, fragment] = href.split("#");

    // An empty target is a same-page `#fragment`, which falls through to the
    // anchor check below against the page it was found on.
    if (target) {
      // Relative link — Astro resolves these at build; nothing to check.
      if (!target.startsWith("/")) continue;
      const clean = target.split("?")[0];
      if (!files.has(clean)) {
        fail(route, `links to "${clean}", which is not a page or asset this build produced.`);
        continue;
      }
    }

    if (!fragment) continue;
    const page = routeOf(target || route);
    if (!page) continue;
    const ids = await idsOf(htmlByRoute.get(page) as string);
    if (!ids.has(decodeURIComponent(fragment))) {
      fail(route, `links to "${href}", but that page has no element with id "${fragment}".`);
    }
  }
}

/* ── 3: links into the org's repos ───────────────────────────────────────── */

for (const [key, targets] of repoLinks) {
  const [repo, ref] = key.split("@");
  const tree = await treeOf(repo, ref);
  if (!tree) continue;

  for (const target of targets) {
    const [path, page] = target.split("\u0000");
    if (!tree.has(path)) {
      fail(page, `links to nanohype/${repo}/${path} at ${ref}, which that repo does not have.`);
    }
  }
}

/* ── 4: every generated section published what its source declares ───────── */

const { templates, composites, standards } = await loadCatalogData();
const resources = await listPlatformResources();
const atlas = await loadAtlas();

const expected: { section: string; source: string; routes: string[] }[] = [
  {
    section: "/catalog/templates/",
    source: "the catalog's templates",
    routes: templates.map((t) => `/catalog/templates/${t.entry.name}/`),
  },
  {
    section: "/catalog/composites/",
    source: "the catalog's composites",
    routes: composites.map((c) => `/catalog/composites/${c.entry.name}/`),
  },
  {
    section: "/catalog/standards/",
    source: "the standards the catalog ships",
    routes: Object.keys(standards).map((name) => `/catalog/standards/${name}/`),
  },
  {
    section: "/platform/resources/",
    source: "the definitions the control planes ship",
    routes: resources.map((r) => `/platform/resources/${resourceSlug(r)}/`),
  },
  {
    section: "/atlas/",
    source: "the perspectives the atlas emits",
    routes: atlas.map((p) => `/atlas/${p.id}/`),
  },
];

for (const { section, source, routes } of expected) {
  if (routes.length === 0) {
    fail(section, `has no source entries at all — ${source} resolved to nothing.`);
    continue;
  }
  const built = [...htmlByRoute.keys()].filter(
    (route) => route.startsWith(section) && route !== section,
  );
  const missing = routes.filter((route) => !htmlByRoute.has(route));
  const extra = built.filter((route) => !routes.includes(route));

  for (const route of missing) {
    fail(section, `${source} declares ${route}, which this build did not publish.`);
  }
  for (const route of extra) {
    fail(section, `published ${route}, which ${source} does not declare.`);
  }
}

/* ── report ──────────────────────────────────────────────────────────────── */

if (unreachable.length > 0) {
  // Loud either way. In CI this is a failure: a check that silently stops
  // checking is the defect it exists to catch. Locally it is a warning, so a
  // build on a plane still completes.
  const lines = [
    "",
    `Could not read ${unreachable.length} repo tree listing(s):`,
    ...unreachable.map((entry) => `  ${entry}`),
    "",
    "Links into those repos were NOT checked.",
    "",
  ];
  if (process.env.CI) {
    console.error(lines.join("\n"));
    process.exit(1);
  }
  console.warn(lines.join("\n"));
}

if (violations.length > 0) {
  console.error(
    `\nThe published site carries ${violations.length} reference(s) that do not resolve.\n`,
  );
  for (const violation of violations) {
    console.error(`  ${violation.page}\n    ${violation.detail}`);
  }
  console.error(
    [
      "",
      "A link that 404s is the one defect a reader always notices. If the target",
      "moved, the link moves with it; if the target is gone, so is the sentence",
      "that promised it.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Counted from the trees that were actually read, not from the links that were
// found. With a listing unreachable those two numbers differ, and reporting the
// larger one would claim coverage this run does not have.
let checkedRepoLinks = 0;
let skippedRepoLinks = 0;
for (const [key, targets] of repoLinks) {
  if (trees.has(key)) checkedRepoLinks += targets.size;
  else skippedRepoLinks += targets.size;
}

console.log(
  `links ok — every internal link and anchor across ${htmlByRoute.size} pages resolves,` +
    ` ${checkedRepoLinks} link(s) into ${trees.size} org repo tree(s) exist,` +
    ` and ${expected.length} generated sections match their sources.` +
    (skippedRepoLinks > 0 ? ` ${skippedRepoLinks} repo link(s) went unchecked.` : ""),
);
