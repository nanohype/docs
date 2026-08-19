import { getCollection } from "astro:content";
import type { APIRoute } from "astro";
import { loadAtlas } from "../lib/atlas.ts";
import { loadCatalogData } from "../lib/catalog.ts";
import { listPlatformResources } from "../lib/resources.ts";

/**
 * `/llms.txt`, emitted at build time.
 *
 * The format is an H1, a blockquote summary, then sections of annotated links
 * (llmstxt.org). It exists because an agent arriving at a documentation site
 * has to reconstruct its shape by crawling; this hands over the shape directly.
 *
 * Generated from the same collections the pages render, for the same reason the
 * sitemap is generated rather than written: a hand-maintained index of a site
 * that publishes 187 pages is an index that is wrong. A page added upstream
 * appears here on the next build, and one removed disappears.
 *
 * The two reference sections are linked as indexes with their counts rather
 * than enumerated. Roughly 150 of this site's pages are generated detail pages
 * for individual templates, standards and resource kinds; listing every one
 * would bury the thirty pages that actually orient a reader, and the count
 * carries the useful part — how much is behind the link.
 */

interface Entry {
  title: string;
  href: string;
  description: string;
}

function section(heading: string, entries: Entry[]): string[] {
  if (entries.length === 0) return [];
  return [
    `## ${heading}`,
    "",
    ...entries.map((e) => `- [${e.title}](${e.href}): ${e.description}`),
    "",
  ];
}

/** A docs-collection id as the route it is published at. */
function docHref(id: string, site: URL): string {
  return new URL(id === "index" ? "/" : `/${id}/`, site).href;
}

export const GET: APIRoute = async ({ site }) => {
  if (!site) {
    throw new Error("llms.txt needs `site` set in astro.config.mjs to write absolute URLs.");
  }

  const [docs, guides, contracts, catalog, resources, atlas] = await Promise.all([
    getCollection("docs"),
    getCollection("guides"),
    getCollection("contracts"),
    loadCatalogData(),
    listPlatformResources(),
    loadAtlas(),
  ]);

  // 404 is a rendered page but not a document — it carries no description and
  // is excluded from search for the same reason it is excluded here.
  const published = docs.filter((doc) => doc.id !== "404" && doc.data.description);

  const entry = (doc: (typeof published)[number]): Entry => ({
    title: doc.data.title,
    href: docHref(doc.id, site),
    description: doc.data.description as string,
  });

  // `decisions` is the section index and `decisions/*` are its pages; both
  // belong under the decisions heading rather than the index sitting up in
  // Documentation next to a heading of its own name.
  const isDecision = (id: string) => id === "decisions" || id.startsWith("decisions/");

  const authored = published
    .filter((doc) => !isDecision(doc.id))
    .sort((a, b) => (a.id === "index" ? -1 : b.id === "index" ? 1 : a.id.localeCompare(b.id)))
    .map(entry);

  // The index first, then its pages alphabetically — the order the section
  // reads in, rather than the order the ids sort in.
  const decisions = published
    .filter((doc) => isDecision(doc.id))
    .sort((a, b) =>
      a.id === "decisions" ? -1 : b.id === "decisions" ? 1 : a.id.localeCompare(b.id),
    )
    .map(entry);

  const building = [...guides]
    .sort((a, b) => a.data.order - b.data.order)
    .map((guide) => ({
      title: guide.data.title,
      href: new URL(`/building/${guide.data.slug}/`, site).href,
      description: guide.data.description,
    }));

  const repos = contracts.map((contract) => ({
    title: contract.data.repo,
    href: new URL(`/repos/${contract.data.repo}/`, site).href,
    description: `${contract.data.role} — ${contract.data.owns}`,
  }));

  const reference: Entry[] = [
    {
      title: "Templates",
      href: new URL("/catalog/templates/", site).href,
      description: `${catalog.templates.length} templates in the catalog, each with its manifest, variables and rendered file tree.`,
    },
    {
      title: "Composites",
      href: new URL("/catalog/composites/", site).href,
      description: `${catalog.composites.length} composites, each naming the templates it draws in and how variables thread through them.`,
    },
    {
      title: "Standards",
      href: new URL("/catalog/standards/", site).href,
      description: `${Object.keys(catalog.standards).length} machine-readable standards — the production bar every deliverable is graded against.`,
    },
    {
      title: "Platform resources",
      href: new URL("/platform/resources/", site).href,
      description: `${resources.length} custom resources the control planes ship, generated from the CRDs themselves — every field, every version.`,
    },
    {
      title: "The atlas",
      href: new URL("/atlas/", site).href,
      description: `${atlas.length} generated diagrams of the stack, each answering one question about it.`,
    },
  ];

  const body = [
    "# nanohype",
    "",
    "> The k8s-native software factory: a template and composite catalog, a factory",
    "> client that ships merge-gated software, and the substrate it deploys onto.",
    "",
    "Everything under /catalog/, /platform/resources/ and /atlas/ is generated at",
    "build time from the org's own artifacts — the catalog manifests, the shipped",
    "CRDs, and the emitted diagrams — so this site cannot describe a template, a",
    "resource kind or a field that does not exist. The pages under /repos/ render",
    "each repo's AGENTS.md as it stands today rather than a copy of it.",
    "",
    ...section("Documentation", authored),
    ...section("Building against it", building),
    ...section("Architecture decisions", decisions),
    ...section("Repos", repos),
    ...section("Generated reference", reference),
  ].join("\n");

  return new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });
};
