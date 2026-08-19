/**
 * The catalog data path for the browsable reference.
 *
 * Everything under /catalog/ is generated from `nanohype/nanohype` at build
 * time — the same catalog, manifests and standards the SDK serves to agents.
 * Nothing here is a second copy: this module reads the source of truth through
 * `@nanohype/sdk`, so the site cannot describe a template the catalog does not
 * have, and a build is one more consumer proving the SDK's discovery path works.
 *
 * The catalog is resolved from a sibling checkout. `LocalSource` is deliberately
 * forgiving — `listTemplates()` skips a directory whose manifest will not parse
 * and returns an empty array when the whole tree is missing — which is the right
 * call for a renderer and the wrong one for a docs build, where the failure mode
 * would be a site that silently ships an empty catalog. Everything below exists
 * to convert that quiet emptiness into a loud build failure.
 */
import {
  type Catalog,
  type CatalogComposite,
  type CatalogTemplate,
  type CompositeManifest,
  LocalSource,
  loadStandards,
  type SkeletonFile,
  type Standard,
  type StandardName,
  type Standards,
  type TemplateManifest,
} from "@nanohype/sdk";
import { siblingDir } from "./checkouts.ts";

/** A template's catalog entry joined to its manifest and its rendered output shape. */
export interface TemplateDetail {
  entry: CatalogTemplate;
  manifest: TemplateManifest;
  files: SkeletonFile[];
}

/** A composite's catalog entry joined to its manifest. */
export interface CompositeDetail {
  entry: CatalogComposite;
  manifest: CompositeManifest;
}

export interface CatalogData {
  catalog: Catalog;
  templates: TemplateDetail[];
  composites: CompositeDetail[];
  standards: Standards;
  /** Absolute path the catalog was read from — surfaced in build errors. */
  rootDir: string;
}

/** Where the catalog lives. */
function resolveRootDir(): string {
  return siblingDir("NANOHYPE_CATALOG_DIR", "nanohype");
}

function fail(rootDir: string, detail: string): never {
  throw new Error(
    [
      `The catalog reference could not be built from ${rootDir}.`,
      detail,
      "",
      "The pages under /catalog/ are generated from nanohype/nanohype. Check that",
      "repo out as a sibling of this one, or point NANOHYPE_CATALOG_DIR at it.",
    ].join("\n"),
  );
}

let cached: Promise<CatalogData> | undefined;

/**
 * Load the catalog once per build. Every page under /catalog/ awaits this, so
 * memoising keeps the manifest walk to a single pass.
 */
export function loadCatalogData(): Promise<CatalogData> {
  cached ??= load();
  return cached;
}

async function load(): Promise<CatalogData> {
  const rootDir = resolveRootDir();
  const source = new LocalSource({ rootDir });

  let catalog: Catalog;
  try {
    catalog = await source.fetchCatalogManifest();
  } catch (cause) {
    fail(rootDir, `Reading catalog.json failed: ${(cause as Error).message}`);
  }

  if (catalog.templates.length === 0 || catalog.composites.length === 0) {
    fail(rootDir, "catalog.json parsed but lists no templates or no composites.");
  }

  // The cross-check that makes a silent skip loud. `listTemplates()` walks the
  // template directories and drops any whose manifest will not parse; the
  // catalog manifest is generated from the same directories. A disagreement
  // means a template's manifest is broken, not that the catalog is smaller.
  const walked = await source.listTemplates();
  const walkedNames = new Set(walked.map((entry) => entry.name));
  const unparseable = catalog.templates
    .map((entry) => entry.name)
    .filter((name) => !walkedNames.has(name));
  if (unparseable.length > 0) {
    fail(
      rootDir,
      `catalog.json lists ${catalog.templates.length} templates but ${unparseable.length} have a manifest that will not parse: ${unparseable.join(", ")}.`,
    );
  }

  const templates: TemplateDetail[] = [];
  for (const entry of catalog.templates) {
    try {
      const { manifest, files } = await source.fetchTemplate(entry.name);
      templates.push({ entry, manifest, files });
    } catch (cause) {
      fail(
        rootDir,
        `Template '${entry.name}' is in catalog.json but did not load: ${(cause as Error).message}`,
      );
    }
  }

  const composites: CompositeDetail[] = [];
  for (const entry of catalog.composites) {
    try {
      composites.push({ entry, manifest: await source.fetchComposite(entry.name) });
    } catch (cause) {
      fail(
        rootDir,
        `Composite '${entry.name}' is in catalog.json but did not load: ${(cause as Error).message}`,
      );
    }
  }

  let standards: Standards;
  try {
    standards = await loadStandards(source);
  } catch (cause) {
    fail(rootDir, `Loading standards/ failed: ${(cause as Error).message}`);
  }

  return { catalog, templates, composites, standards, rootDir };
}

/** Templates grouped by their catalog category, categories in alphabetical order. */
export function byCategory(templates: TemplateDetail[]): Map<string, TemplateDetail[]> {
  const groups = new Map<string, TemplateDetail[]>();
  for (const template of templates) {
    const key = template.entry.category || "uncategorised";
    const bucket = groups.get(key);
    if (bucket) bucket.push(template);
    else groups.set(key, [template]);
  }
  for (const bucket of groups.values()) {
    bucket.sort((a, b) => a.entry.name.localeCompare(b.entry.name));
  }
  return new Map([...groups].sort(([a], [b]) => a.localeCompare(b)));
}

/** Every tag in the catalog with how many templates carry it, most-used first. */
export function tagCounts(templates: TemplateDetail[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const template of templates) {
    for (const tag of template.entry.tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/** The composites that draw a given template in. */
export function compositesUsing(name: string, composites: CompositeDetail[]): CompositeDetail[] {
  return composites.filter((composite) =>
    (composite.manifest.templates ?? []).some((entry) => entry.template === name),
  );
}

/**
 * A skeleton's file list as a sorted tree of display paths. Templates ship
 * placeholder-named files (`__APP_NAME__/`), which is what the reader should
 * see — it is what the renderer substitutes into.
 */
export function fileTree(files: SkeletonFile[]): string[] {
  return files.map((file) => file.path).sort((a, b) => a.localeCompare(b));
}

export type { Standard, StandardName, Standards };
