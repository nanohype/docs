/**
 * The reference guides the catalog repo carries.
 *
 * Nine documents — the Platform Reference and the two contract specifications
 * among them — that are the deepest writing the org has about how to build
 * against it, and that lived where only someone already inside the catalog repo
 * would find them. The Platform Reference in particular calls itself the public,
 * agent-consumable front door while sitting one repo away from the public front
 * door.
 *
 * Pulled at build time and rendered through this site's markdown pipeline, the
 * same way `src/lib/contracts.ts` handles each repo's AGENTS.md. Nothing is
 * copied into this repo.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Loader } from "astro/loaders";
// `astro/zod`, not `astro:content` — see the note in src/lib/contracts.ts.
import { z } from "astro/zod";
import { siblingDir } from "./checkouts.ts";
import { rewriteMarkdownLinks } from "./markdown-links.ts";

interface GuideSource {
  /** Route slug under /building/. */
  slug: string;
  /** File under the catalog repo's docs/ directory. */
  file: string;
  title: string;
  description: string;
  /** Ordering within the section. */
  order: number;
}

/**
 * What gets published, in reading order.
 *
 * `quick-start.md` is deliberately absent. Its "by problem" table is a shorter
 * copy of the decision matrix in `catalog.md`, and its scaffolding walkthrough
 * is covered by this site's own Quickstart — so publishing it would put a third
 * overlapping selection guide on the front door. The content is not lost; it is
 * the weakest of the three sources for it. Consolidating upstream is the real
 * fix and belongs to the catalog repo, not here.
 */
const GUIDES: GuideSource[] = [
  {
    slug: "platform-reference",
    file: "platform-reference.md",
    title: "Platform Reference",
    description:
      "The agent-consumable front door: the stack, the layer boundaries, the contract repos, and the SDK and MCP entry points.",
    order: 1,
  },
  {
    slug: "catalog-reference",
    file: "catalog.md",
    title: "Catalog reference",
    description:
      "Which template to reach for, how templates compose, and the module layering from a minimal API up to a full platform.",
    order: 2,
  },
  {
    slug: "composites",
    file: "composites-guide.md",
    title: "Composites",
    description:
      "What a composite is, how one is assembled, and when to reach for it over a single template.",
    order: 3,
  },
  {
    slug: "production-readiness",
    file: "production-readiness.md",
    title: "Production readiness",
    description: "The cumulative checklist a scaffolded project clears before it is deployed.",
    order: 4,
  },
  {
    slug: "authoring-a-template",
    file: "authoring-guide.md",
    title: "Authoring a template",
    description: "Creating a new template, from empty directory to validated and catalog-ready.",
    order: 5,
  },
  {
    slug: "template-contract",
    file: "spec/template-contract.md",
    title: "Template contract",
    description:
      "The formal specification a template manifest is validated against — every field, every rule.",
    order: 6,
  },
  {
    slug: "composite-contract",
    file: "spec/composite-contract.md",
    title: "Composite contract",
    description:
      "The formal specification for a composite: how it names its templates and threads variables through them.",
    order: 7,
  },
  {
    slug: "consumer-guide",
    file: "spec/consumer-guide.md",
    title: "Building a consumer",
    description:
      "How to build a scaffolding tool that renders nanohype templates — the action doc behind the two contracts.",
    order: 8,
  },
  {
    slug: "reference-pattern",
    file: "platform-reference-pattern.md",
    title: "The Platform Reference pattern",
    description:
      "The structure generalised: how any platform can publish an agent-consumable front door of its own.",
    order: 9,
  },
];

/** Source filename to the route it is published at, for cross-document links. */
const ROUTE_BY_FILE = new Map(GUIDES.map((guide) => [guide.file, `/building/${guide.slug}/`]));

function rootDir(): string {
  return siblingDir("NANOHYPE_CATALOG_DIR", "nanohype");
}

/**
 * Resolves a relative link against the directory of the document that wrote it,
 * collapsing `.` and `..` the way a filesystem would.
 *
 * The guides do not all sit at the same depth — three of them live in
 * `docs/spec/` — so the directory has to come from the document rather than be
 * assumed. A `../..` written from `docs/spec/` reaches the repo root, and the
 * same text written from `docs/` reaches above it, which is a link nobody can
 * follow. Segments that would escape the repo are dropped rather than emitted,
 * because a URL containing `..` resolves to a 404 on GitHub and reads as a real
 * path in the markdown source.
 */
export function resolveRepoPath(fromDir: string, target: string): string {
  const out: string[] = [];
  for (const segment of `${fromDir}/${target}`.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") out.pop();
    else out.push(segment);
  }
  return out.join("/") + (target.endsWith("/") ? "/" : "");
}

/**
 * Repoint a link written for someone standing in the catalog repo.
 *
 * Three cases, and the first is the one that matters. These documents reference
 * each other — the pattern guide opens by pointing at the Platform Reference —
 * and sending a reader to GitHub mid-section to read the next page of the same
 * section would be worse than the broken link it replaces. So a target that is
 * published here becomes an internal route; everything else points back at the
 * repo it was written for, with a trailing slash meaning a directory.
 *
 * `file` is the guide's own path under the catalog's `docs/`, which is what
 * every relative target in it is written against.
 */
export function rewriteGuideLinks(markdown: string, file: string): string {
  const base = "https://github.com/nanohype/nanohype";
  const fromDir = resolveRepoPath("docs", file).split("/").slice(0, -1).join("/");

  return rewriteMarkdownLinks(markdown, (target) => {
    if (/^(https?:|mailto:|#)/.test(target)) return undefined;
    if (target.startsWith("/")) return undefined;

    const [path, hash = ""] = target.split("#");
    const anchor = hash ? `#${hash}` : "";

    const repoPath = resolveRepoPath(fromDir, path);

    // A target that is also published here becomes an internal route. Keyed on
    // the path under docs/, which is how GUIDES names its sources, so a link
    // written as `../catalog.md` from spec/ and one written as `catalog.md`
    // from docs/ both land on the same page.
    const internal = ROUTE_BY_FILE.get(repoPath.replace(/^docs\//, ""));
    if (internal) return `${internal}${anchor}`;

    // A target that collapsed to nothing — `..` from docs/, say — has no path
    // to serve under blob or tree, and emitting one anyway produces exactly the
    // 404 the segment-dropping above exists to avoid. The repo root is the
    // honest answer, and the same one rewriteLinks gives for an empty path.
    //
    // Collapsing has two spellings, because resolveRepoPath re-appends the
    // trailing slash after joining: `..` leaves "" and `../` leaves "/". Only
    // testing the first left the second emitting `/tree/main//`, which is the
    // same dead link wearing a slash.
    if (!repoPath.replace(/\/+$/, "")) return `${base}${anchor}`;

    const kind = repoPath.endsWith("/") ? "tree" : "blob";
    return `${base}/${kind}/main/${repoPath}${anchor}`;
  });
}

export const guideSchema = z.object({
  slug: z.string(),
  title: z.string(),
  description: z.string(),
  order: z.number(),
  file: z.string(),
});

/**
 * Loads every guide, and fails when one is missing.
 *
 * A guide that has been renamed upstream would otherwise vanish from the
 * section silently — the build stays green, the sidebar quietly loses an entry,
 * and the only symptom is a page nobody can find any more.
 */
export function guidesLoader(): Loader {
  return {
    name: "nanohype-guides",
    load: async ({ store, renderMarkdown }) => {
      const dir = rootDir();
      store.clear();

      const missing: string[] = [];
      for (const guide of GUIDES) {
        const path = join(dir, "docs", guide.file);
        let content: string;
        try {
          content = await readFile(path, "utf8");
        } catch {
          missing.push(`${guide.file} (looked at ${path})`);
          continue;
        }

        // Drop the leading H1: the page already carries the title, and a second
        // one would put two first-level headings in the document outline.
        const body = rewriteGuideLinks(content.replace(/^#\s+.*\n+/, ""), guide.file);
        store.set({
          id: guide.slug,
          data: { ...guide },
          body,
          rendered: await renderMarkdown(body),
        });
      }

      if (missing.length > 0) {
        throw new Error(
          [
            `The building section could not be built from ${dir}.`,
            `These guides did not load: ${missing.join(", ")}.`,
            "",
            "They are read from the catalog repo's docs/ directory. Check that repo",
            "out as a sibling of this one, or point NANOHYPE_CATALOG_DIR at it.",
          ].join("\n"),
        );
      }
    },
  };
}
