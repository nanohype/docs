/**
 * The org's Kubernetes API surface, read from the definitions its control planes
 * ship.
 *
 * Two repos define custom resources. `eks-agent-platform` publishes CRDs in
 * `charts/operator/crds/` — the same files a cluster installs. `eks-fleet`
 * publishes a Crossplane CompositeResourceDefinition under `apis/`. The two
 * kinds of document are near-identical where it matters: group, names, scope,
 * and a versioned OpenAPI schema whose descriptions were written once, at the
 * source, by whoever owns the field.
 *
 * That is the whole reference, and it is already written; restating any of it
 * here would only create a second copy to keep true. So this module reads the
 * shipped definitions and the pages under /platform/resources/ render them. A
 * field added upstream appears here on the next build. A field removed
 * disappears. There is no version of this site that describes a resource no
 * control plane reconciles, because the site holds no independent record of what
 * the resources are.
 */
import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse } from "yaml";

/** One property of a resource's schema, flattened for rendering. */
export interface SchemaField {
  name: string;
  /** Dotted path from the top of `spec`, e.g. `identity.allowedModels`. */
  path: string;
  type: string;
  required: boolean;
  description?: string;
  enum?: string[];
  default?: unknown;
  /** Nested object properties, or the properties of an array's item schema. */
  children: SchemaField[];
}

export interface PlatformResource {
  kind: string;
  plural: string;
  group: string;
  /** The repo whose control plane reconciles this resource. */
  repo: string;
  /** Every served version, in the order the CRD declares them. */
  versions: string[];
  scope: "Namespaced" | "Cluster";
  shortNames: string[];
  /** The CRD's own top-level description — what this resource is. */
  description: string;
  /** Its first sentence, for the index table. */
  summary: string;
  /** The spec schema's description — what the spec declares. */
  specDescription: string;
  /** `kubectl get` columns, so the page shows what the CLI shows. */
  printerColumns: { name: string; type: string; description?: string }[];
  spec: SchemaField[];
}

export interface ResourceGroup {
  group: string;
  resources: PlatformResource[];
}

/** One repo's published API definitions. */
interface DefinitionSource {
  repo: string;
  /** Path within the repo, and the env var CI uses to relocate it. */
  path: string;
  env: string;
}

/**
 * The control planes whose resources this site documents.
 *
 * Both repos are sibling checkouts like every other org repo, so the defaults
 * point into them; CI overrides each with its own variable.
 */
const SOURCES: DefinitionSource[] = [
  {
    repo: "eks-agent-platform",
    path: "../eks-agent-platform/charts/operator/crds",
    env: "NANOHYPE_CRDS_DIR",
  },
  { repo: "eks-fleet", path: "../eks-fleet/apis", env: "NANOHYPE_XRDS_DIR" },
];

/**
 * Resolved against the project root rather than `import.meta.url`, which is
 * bundled into `dist/.prerender/chunks/` before it runs.
 */
function resolveDir(source: DefinitionSource): string {
  const override = process.env[source.env];
  if (override) return override;
  return resolve(process.cwd(), source.path);
}

function fail(source: DefinitionSource, dir: string, detail: string): never {
  throw new Error(
    [
      `The platform resource reference could not be built from ${dir}.`,
      detail,
      "",
      "The pages under /platform/resources/ are generated from the API definitions",
      `${source.repo} ships in ${source.path.replace("../", "")}. Check that repo out`,
      `as a sibling of this one, or point ${source.env} at its definitions.`,
    ].join("\n"),
  );
}

/** The subset of the OpenAPI v3 schema this reference reads. */
interface RawSchema {
  type?: string;
  description?: string;
  properties?: Record<string, RawSchema>;
  required?: string[];
  items?: RawSchema;
  enum?: unknown[];
  default?: unknown;
  format?: string;
}

/**
 * Renders a schema node's type the way the CRD means it, not the way OpenAPI
 * spells it: an array of objects reads as `[]object`, and a field with an
 * `x-kubernetes` union type falls back to the plain kind rather than blank.
 */
function typeOf(schema: RawSchema): string {
  if (schema.type === "array") {
    const item = schema.items;
    if (!item) return "[]";
    return `[]${typeOf(item)}`;
  }
  if (schema.format) return `${schema.type ?? "string"} (${schema.format})`;
  return schema.type ?? "object";
}

/**
 * Walks a schema into a flat-per-level field tree.
 *
 * An array's item properties are lifted onto the array field itself: in a CRD
 * `agents[]` is where the interesting shape lives, and a reader looking for
 * `agents[].image` should not have to descend through an anonymous item node
 * that has no name in any manifest they will ever write.
 */
function fieldsOf(schema: RawSchema, prefix: string): SchemaField[] {
  const container = schema.type === "array" ? (schema.items ?? {}) : schema;
  const properties = container.properties;
  if (!properties) return [];
  const required = new Set(container.required ?? []);

  return Object.entries(properties)
    .filter(([name]) => name !== "status")
    .sort(([a], [b]) => {
      // Required first, then alphabetical — the order someone writes a manifest
      // in, rather than the order a serializer happened to emit.
      const ra = required.has(a);
      const rb = required.has(b);
      if (ra !== rb) return ra ? -1 : 1;
      return a.localeCompare(b);
    })
    .map(([name, property]) => ({
      name,
      path: prefix ? `${prefix}.${name}` : name,
      type: typeOf(property),
      required: required.has(name),
      description: property.description,
      enum: property.enum?.map(String),
      default: property.default,
      children: fieldsOf(property, prefix ? `${prefix}.${name}` : name),
    }));
}

interface RawDefinition {
  kind?: string;
  spec?: {
    group?: string;
    scope?: string;
    names?: { kind?: string; plural?: string; shortNames?: string[] };
    versions?: {
      name: string;
      served?: boolean;
      schema?: { openAPIV3Schema?: RawSchema };
      additionalPrinterColumns?: { name: string; type: string; description?: string }[];
    }[];
  };
}

/**
 * A CRD and a Crossplane XRD are the same document where this reference reads
 * them. Both are accepted by kind rather than by directory, so a file that is
 * neither fails loudly instead of being skipped into an incomplete reference.
 */
const DEFINITION_KINDS = new Set(["CustomResourceDefinition", "CompositeResourceDefinition"]);

/**
 * The first sentence of a description.
 *
 * A CRD description is a Go doc comment, written for whoever maintains the
 * controller, so it often runs on into why a subresource was left off or how a
 * field interacts with another. That belongs on the resource's own page and
 * reads as noise in an index row, where every neighbour is one line. The whole
 * text is never discarded — only the index shows the short form.
 */
function firstSentence(description: string): string {
  const collapsed = description.replace(/\s+/g, " ").trim();
  const end = collapsed.match(/^.*?[.](?=\s|$)/)?.[0];
  return end && end.length >= 40 ? end : collapsed;
}

function readDefinition(
  source: DefinitionSource,
  dir: string,
  file: string,
  contents: string,
): PlatformResource {
  let raw: RawDefinition;
  try {
    raw = parse(contents) as RawDefinition;
  } catch (cause) {
    return fail(source, dir, `${file} is not parseable YAML: ${(cause as Error).message}`);
  }

  if (!raw?.kind || !DEFINITION_KINDS.has(raw.kind)) {
    fail(
      source,
      dir,
      `${file} is a ${raw?.kind ?? "document with no kind"}, not a resource definition.`,
    );
  }

  const spec = raw.spec;
  const group = spec?.group;
  const kind = spec?.names?.kind;
  const versions = spec?.versions ?? [];
  if (!group || !kind || versions.length === 0) {
    fail(source, dir, `${file} is missing spec.group, spec.names.kind, or spec.versions.`);
  }

  // The served versions are what a cluster will accept. An unserved version is
  // in the file but not in the API, and publishing it would document something
  // no manifest can use.
  const served = versions.filter((version) => version.served !== false);
  if (served.length === 0) {
    fail(source, dir, `${file} declares no served version.`);
  }

  const primary = served[0];
  const root = primary.schema?.openAPIV3Schema;
  if (!root?.properties?.spec) {
    fail(source, dir, `${file} version ${primary.name} has no spec schema.`);
  }

  // A resource with no description of itself would publish a row saying only
  // its own name. The description belongs upstream, next to the schema it
  // describes, so this fails rather than inventing one here.
  const description = root.description ?? "";
  if (!description) {
    fail(
      source,
      dir,
      `${file} declares ${kind} with no description on its schema. Describe it in ${source.repo}.`,
    );
  }

  return {
    kind,
    plural: spec?.names?.plural ?? `${kind.toLowerCase()}s`,
    group,
    repo: source.repo,
    versions: served.map((version) => version.name),
    scope: spec?.scope === "Cluster" ? "Cluster" : "Namespaced",
    shortNames: spec?.names?.shortNames ?? [],
    description,
    summary: firstSentence(description),
    specDescription: root.properties.spec.description ?? "",
    printerColumns: primary.additionalPrinterColumns ?? [],
    spec: fieldsOf(root.properties.spec, ""),
  };
}

/** Every .yaml under a directory, recursively — eks-fleet nests one per API. */
async function yamlFiles(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await yamlFiles(join(dir, entry.name), relative)));
    else if (entry.name.endsWith(".yaml")) found.push(relative);
  }
  return found;
}

async function readSource(source: DefinitionSource): Promise<PlatformResource[]> {
  const dir = resolveDir(source);
  let files: string[];
  try {
    files = await yamlFiles(dir);
  } catch (cause) {
    fail(source, dir, `The directory could not be read: ${(cause as Error).message}`);
  }
  if (files.length === 0) {
    fail(source, dir, "The directory holds no .yaml files.");
  }

  return Promise.all(
    files.map(async (file) =>
      readDefinition(source, dir, file, await readFile(join(dir, file), "utf8")),
    ),
  );
}

let cached: ResourceGroup[] | undefined;

/**
 * Every custom resource the org's control planes ship, grouped by API group.
 *
 * An empty or missing directory is a build failure rather than an empty page.
 * A reference that silently publishes nothing is worse than one that does not
 * publish: the first reads as "the platform has no resources", which is a
 * claim, and a wrong one.
 */
export async function loadPlatformResources(): Promise<ResourceGroup[]> {
  if (cached) return cached;

  const resources = (await Promise.all(SOURCES.map(readSource))).flat();

  const byGroup = new Map<string, PlatformResource[]>();
  for (const resource of resources) {
    const existing = byGroup.get(resource.group);
    if (existing) existing.push(resource);
    else byGroup.set(resource.group, [resource]);
  }

  cached = [...byGroup.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, list]) => ({
      group,
      resources: list.sort((a, b) => a.kind.localeCompare(b.kind)),
    }));
  return cached;
}

/** Flat list, for the routes that page over every kind. */
export async function listPlatformResources(): Promise<PlatformResource[]> {
  return (await loadPlatformResources()).flatMap((group) => group.resources);
}

/** The route segment for a kind — `agentfleet`, `slopolicy`. */
export function resourceSlug(resource: PlatformResource): string {
  return resource.kind.toLowerCase();
}
