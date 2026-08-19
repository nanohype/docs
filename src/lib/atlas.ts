/**
 * The atlas data path.
 *
 * The eleven perspectives are authored in `nanohype/.github` and emitted there
 * as SVG plus an `atlas.json` manifest carrying each one's id, name and blurb.
 * This module reads that manifest; `scripts/sync-atlas.ts` copies the diagrams
 * into `public/atlas/` during prebuild. Nothing about a perspective is restated
 * here — a caption and its diagram come from the same emit, so they cannot
 * drift apart.
 *
 * What *is* authored here is the prose under each diagram: what the reader is
 * looking at, and where to go next. That is documentation rather than model
 * data, so it lives with the documentation — and a perspective added upstream
 * with no entry below fails this build rather than publishing a bare picture.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { siblingDir } from "./checkouts.ts";

export interface AtlasEntry {
  index: number;
  id: string;
  name: string;
  blurb: string;
  svg: string;
}

/**
 * A manifest entry joined to the intrinsic size of the diagram it names.
 *
 * The size is not in `atlas.json` — it is read from the diagram itself, so it
 * cannot disagree with the picture it describes.
 */
export interface AtlasDiagram extends AtlasEntry {
  width: number;
  height: number;
}

export interface AtlasPerspective extends AtlasDiagram {
  /** The authored reading notes for this view. */
  notes: string[];
}

/** Where the emitted atlas lives. */
export function resolveAtlasDir(): string {
  return siblingDir("NANOHYPE_ATLAS_DIR", ".github", "profile", "assets", "atlas");
}

export function atlasFailure(dir: string, detail: string): Error {
  return new Error(
    [
      `The atlas section could not be built from ${dir}.`,
      detail,
      "",
      "The pages under /atlas/ are generated from the diagrams emitted by",
      "nanohype/.github. Check that repo out as a sibling of this one, or point",
      "NANOHYPE_ATLAS_DIR at its profile/assets/atlas directory.",
    ].join("\n"),
  );
}

/**
 * The intrinsic size of a diagram, read from its own root element.
 *
 * An `<img>` carrying no width and height reserves no space until the file
 * arrives, so everything below it moves once it does. These diagrams are
 * 135-149 KB each and they *are* the content of the page they sit on, which
 * makes that the whole view jumping rather than a detail settling.
 *
 * One CSS `aspect-ratio` would not fix it, because the perspectives do not
 * share a shape: across the eleven they run from 2172x1160 to 1504x1920, nine
 * distinct ratios. A single constant would reserve the wrong box on nearly all
 * of them — a different wrong answer, plus letterboxing. So the size is read
 * per diagram, from the same emit as the picture and the caption, and cannot
 * drift when a perspective is re-laid-out.
 *
 * `viewBox` is preferred over the width and height attributes: it is the
 * coordinate system the diagram is drawn in, and the one a renderer falls back
 * to when the attributes are absent.
 */
function readDimensions(svg: string): { width: number; height: number } | undefined {
  // The root element is the first tag in the file; a slice keeps this off the
  // ~140 KB of path data behind it.
  const root = svg.slice(0, 1024);

  const viewBox = root.match(/viewBox="\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)/);
  if (viewBox) {
    const width = Number(viewBox[1]);
    const height = Number(viewBox[2]);
    if (width > 0 && height > 0) return { width, height };
  }

  const attrs = root.match(/\bwidth="([\d.]+)"[^>]*\bheight="([\d.]+)"/);
  if (attrs) {
    const width = Number(attrs[1]);
    const height = Number(attrs[2]);
    if (width > 0 && height > 0) return { width, height };
  }

  return undefined;
}

/** Reads and validates the emitted manifest. Shared by the sync script and the pages. */
export async function readAtlasManifest(dir: string): Promise<AtlasDiagram[]> {
  const manifestPath = join(dir, "atlas.json");
  if (!existsSync(manifestPath)) {
    throw atlasFailure(dir, "atlas.json is not there. Run `pnpm emit` in the atlas project.");
  }

  let entries: AtlasEntry[];
  try {
    entries = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch (cause) {
    throw atlasFailure(dir, `atlas.json did not parse: ${(cause as Error).message}`);
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw atlasFailure(dir, "atlas.json parsed but lists no perspectives.");
  }

  // The manifest is emitted in the same pass that writes the SVGs, so a missing
  // file means the directory was assembled by something other than that emit.
  const missing = entries.filter((entry) => !existsSync(join(dir, entry.svg)));
  if (missing.length > 0) {
    throw atlasFailure(
      dir,
      `atlas.json names ${missing.length} diagram(s) that are not in the directory: ${missing
        .map((entry) => entry.svg)
        .join(", ")}.`,
    );
  }

  // Read each diagram for its own dimensions. A diagram whose root element
  // declares neither a viewBox nor a width and height cannot have its space
  // reserved, and a page that silently stops reserving is the defect this
  // exists to prevent — so it fails the build like any other missing input.
  const diagrams: AtlasDiagram[] = [];
  const unsized: string[] = [];
  for (const entry of entries) {
    const size = readDimensions(await readFile(join(dir, entry.svg), "utf8"));
    if (size) diagrams.push({ ...entry, ...size });
    else unsized.push(entry.svg);
  }

  if (unsized.length > 0) {
    throw atlasFailure(
      dir,
      `${unsized.length} diagram(s) declare no viewBox and no width/height on their root element, so a page cannot reserve their space before they load: ${unsized.join(", ")}.`,
    );
  }

  return diagrams;
}

/**
 * The reading notes, keyed by perspective id.
 *
 * Each entry answers the two questions a diagram cannot: what claim is this
 * view making, and what should I read next. Kept short — the picture is the
 * content, and prose that re-describes the boxes earns nothing.
 */
const NOTES: Record<string, string[]> = {
  legend: [
    "Read this one first. Colour carries the same meaning on every other page, position carries ownership, and an arrow is spent only where position cannot say the thing — so a page with few arrows is a page where containment already did the work.",
    "The consequence worth knowing: if a box sits inside a zone, that zone owns it. Ownership is never implied by an arrow.",
  ],
  org: [
    "Every repo in the org plays exactly one of three roles — what the factory consumes, what it produces, or the factory itself — and the deploy substrate sits between the second and third.",
    "The claim being made is that the roles do not overlap. A repo that both defines the vocabulary and ships an application would be a category error, which is why the tenant applications are separate repos rather than directories inside the catalog.",
  ],
  substrate: [
    "landing-zone by layer. Organization components run once against the management account; everything beneath them is per-environment and installs from within its own account.",
    "The boundary this page draws is the one most often crossed by mistake: slow-moving cloud infrastructure belongs here, and anything per-tenant and fast-moving belongs to the operator. Adding a cloud resource inside a chart is the symptom of getting it wrong.",
  ],
  network: [
    "The VPC and its subnet tiers, and the two modes every network component supports — create one, or adopt one that already exists.",
    "Create and adopt are a single contract rather than two code paths, which is what lets the same component serve a greenfield account and an existing enterprise network. The validations that reject an adopt-only input in create mode are the enforcement.",
  ],
  addons: [
    "The eks-gitops catalog: what ArgoCD installs on a cluster once it exists, and in what order.",
    "Everything here is a chart in a catalog rather than a resource in an IaC module, which is the layer boundary from the substrate page seen from the other side. An addon that needed a cloud resource would be split across both layers rather than reaching across from this one.",
  ],
  "control-plane": [
    "The eks-agent-platform operator and its CRDs — Platform, AgentFleet, ModelGateway, BudgetPolicy, EvalSuite — and what each one reconciles.",
    "A tenant is a declaration. `Platform.spec.datastores` names the databases, buckets, queues and caches it wants, and the substrate provisions them from that declaration rather than from a component written per application. Adding a tenant is an act of writing YAML.",
  ],
  "request-path": [
    "One request, end to end: from the caller, through the gateway, to a model, and back — with the points where it can be shaped, capped, or refused marked along the way.",
    "The gateway is the egress path rather than a proxy in front of one, which is what makes capture and attribution properties of the route instead of things each application has to remember to do.",
  ],
  identity: [
    "How a tenant gets an identity and what stops it reaching another tenant's things. Pod Identity binds a ServiceAccount to a role; the role's policies are generated from the tenant's own declaration.",
    "The isolation claim rests on generated policy rather than reviewed policy. A scoped datastore policy is derived from `spec.datastores`, so a tenant cannot be granted something it did not declare — and where a resource cannot be resolved exactly, the operator emits no grant at all rather than a broad one.",
  ],
  observability: [
    "The OTLP waist. Every workload emits through one pipeline, and the tier it lands in is a property of the cluster rather than of the application.",
    "Two tiers exist — floor and full — and the choice is a single knob rather than a set of independently-wired addons. That is what keeps a cluster from claiming a tier it has no backing for.",
  ],
  governance: [
    "Three control loops that can each stop a tenant: budget, SLO, and eval. The budget one is worth reading closely.",
    "EventBridge cannot call a Kubernetes API, so the kill switch changes AWS state and lets the operator's existing reconcile loop find the change as drift. Nothing new is coupled to the cluster; the price is one reconcile interval of lag. Recovery is deliberately human — there is no API path back.",
  ],
  lifecycle: [
    "A cluster and a tenant from vend to teardown, and which system owns each step.",
    "Clusters are vended from a namespaced `Cluster` resource the same way tenants are vended from a `Platform` — a Crossplane composition renders an OpenTofu workspace and writes the result back to status. The IaC stays the source of truth and Crossplane is the ordering API over it, not a replacement for it.",
  ],
};

/** The manifest joined to its reading notes, in emit order. */
export async function loadAtlas(): Promise<AtlasPerspective[]> {
  const dir = resolveAtlasDir();
  const entries = await readAtlasManifest(dir);

  const unwritten = entries.filter((entry) => !NOTES[entry.id]);
  if (unwritten.length > 0) {
    throw atlasFailure(
      dir,
      `These perspectives have no reading notes in src/lib/atlas.ts: ${unwritten
        .map((entry) => entry.id)
        .join(", ")}. A diagram published with no prose is a picture with no page.`,
    );
  }

  return entries.map((entry) => ({ ...entry, notes: NOTES[entry.id] }));
}
