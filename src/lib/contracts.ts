/**
 * The agent-contract data path.
 *
 * Nine repos ship an `AGENTS.md` — the entry point an agent reads to work on
 * that repo — and until now the only way to see one was to open the repo. This
 * loads all nine through `@nanohype/sdk`, which resolves each from the sibling
 * checkout beside the catalog, and renders them through this site's own
 * markdown pipeline so a contract page reads like every other page here.
 *
 * Nothing is copied into this repo. A contract page shows what that repo's
 * `AGENTS.md` says today, which is the only version worth publishing — a stale
 * copy of an agent's instructions is worse than no copy.
 */

import { z } from "astro:content";
import { resolve } from "node:path";
import { KNOWN_CONTRACT_REPOS, LocalSource, loadContract } from "@nanohype/sdk";
import type { Loader } from "astro/loaders";

/**
 * What each repo is for, and the boundary it owns.
 *
 * Authored here rather than parsed out of the contracts: an `AGENTS.md` opens
 * by addressing an agent already working in that repo, so it rarely states the
 * one thing a reader arriving from outside needs first — which layer this is,
 * and what belongs to it rather than to its neighbours.
 */
const ROLES: Record<string, { role: string; owns: string }> = {
  nanohype: {
    role: "The factory's vocabulary",
    owns: "Templates, composites, standards, the SDK and the MCP server. What every other repo is described in terms of.",
  },
  "landing-zone": {
    role: "Cloud substrate",
    owns: "The slow-moving AWS layer — VPC, base IAM, KMS, DNS, cluster vending — as OpenTofu components driven by Terragrunt, plus the generic module that provisions a tenant's datastores from its declaration.",
  },
  "eks-gitops": {
    role: "Cluster addon catalog",
    owns: "What ArgoCD installs on a cluster once it exists: cert-manager, external-secrets, Kyverno, the observability stack. Charts, not cloud resources.",
  },
  "eks-agent-platform": {
    role: "The control plane",
    owns: "The CRDs a tenant is declared in — Platform, AgentFleet, ModelGateway, BudgetPolicy, EvalSuite — and the operator that reconciles them, including the per-tenant AWS identity and access it mints.",
  },
  "eks-fleet": {
    role: "The cluster factory",
    owns: "Vending EKS clusters from a namespaced Cluster resource, via a Crossplane composition that runs the landing-zone modules and writes the result back to status.",
  },
  kx: {
    role: "The local cluster",
    owns: "A kind workspace mirroring the eks-gitops catalog, so the same charts run locally before they run on EKS.",
  },
  cloudgov: {
    role: "Governance CLI",
    owns: "AWS security and cost posture — IAM least-privilege, spend, infrastructure hygiene, drift — plus a conformance auditor for Platform tenants.",
  },
  portal: {
    role: "The operations portal",
    owns: "Running the substrate from one UI with one audit trail: a Go API and a React SPA over the same components the CLI drives.",
  },
  fab: {
    role: "The factory client",
    owns: "Orchestration across the build phases, the agent roster, the merge gate, and the baseline skills. Open source, so the factory can be cloned and run rather than only described.",
  },
};

function rootDir(): string {
  const override = process.env.NANOHYPE_CATALOG_DIR;
  if (override) return override;
  return resolve(process.cwd(), "../nanohype");
}

/**
 * Point a repo-relative link at the repo it came from.
 *
 * Every link in an `AGENTS.md` is written for someone standing in that repo, so
 * `docs/architecture.md` means that repo's file. Served from this origin it
 * would be a 404 — the page would render, the links would be dead, and nothing
 * would report it. A trailing slash means a directory, which GitHub serves
 * under `tree` rather than `blob`.
 *
 * A link that climbs out of the repo means a *sibling checkout*, not a parent
 * directory: the org layout puts every repo side by side, so an `AGENTS.md` in
 * `eks-gitops` writes `../kx/AGENTS.md` to reach kx. Rewriting that against its
 * own repo produces a path with `..` in it, which GitHub resolves to nothing.
 * The first segment after climbing out is the repo name, so the link is
 * repointed at that repo instead.
 */
export function rewriteLinks(markdown: string, repo: string): string {
  return markdown.replace(/\]\(([^)\s]+)(\s+"[^"]*")?\)/g, (whole, target: string, title = "") => {
    if (/^(https?:|mailto:|#|\/)/.test(target)) return whole;

    const trailing = target.endsWith("/") ? "/" : "";
    const segments: string[] = [];
    let climbed = 0;
    for (const segment of target.split("/")) {
      if (segment === "" || segment === ".") continue;
      if (segment !== "..") segments.push(segment);
      else if (segments.length > 0) segments.pop();
      else climbed += 1;
    }

    // Climbing out of the repo lands in the org checkout, where the next
    // segment names a sibling repo and the rest is a path inside it.
    let owner = repo;
    if (climbed > 0) {
      const sibling = segments.shift();
      // Climbing past the org root, or naming nothing after it, is a link that
      // could not resolve anywhere. Left alone so it reads as what it is.
      if (climbed > 1 || !sibling) return whole;
      owner = sibling;
    }

    const path = segments.join("/");
    if (!path) return `](https://github.com/nanohype/${owner}${title})`;
    const kind = trailing ? "tree" : "blob";
    return `](https://github.com/nanohype/${owner}/${kind}/main/${path}${trailing}${title})`;
  });
}

export const contractSchema = z.object({
  repo: z.string(),
  role: z.string(),
  owns: z.string(),
  visibility: z.string().optional(),
});

/**
 * Loads every known contract, and fails when one is missing.
 *
 * Deliberately not `loadAllContracts`, whose contract is best-effort — it skips
 * a repo it cannot resolve and warns. That is right for an MCP server, which
 * should still serve the eight it has, and wrong here: the failure would be a
 * repo quietly absent from the published list, with a green build and a warning
 * nobody reads in a log nobody opens.
 */
export function contractsLoader(): Loader {
  return {
    name: "nanohype-contracts",
    load: async ({ store, renderMarkdown }) => {
      const dir = rootDir();
      const source = new LocalSource({ rootDir: dir });
      store.clear();

      const missing: string[] = [];
      for (const repo of KNOWN_CONTRACT_REPOS) {
        let content: string;
        try {
          content = (await loadContract(source, repo)).content;
        } catch (cause) {
          missing.push(`${repo} (${(cause as Error).message})`);
          continue;
        }

        const body = rewriteLinks(content, repo);
        store.set({
          id: repo,
          data: { repo, ...ROLES[repo] },
          body,
          rendered: await renderMarkdown(body),
        });
      }

      if (missing.length > 0) {
        throw new Error(
          [
            `The repo reference could not be built from ${dir}.`,
            `These repos ship an AGENTS.md that did not load: ${missing.join(", ")}.`,
            "",
            "Each contract is read from a checkout beside the catalog, mirroring the",
            "org layout. Check those repos out as siblings, or point",
            "NANOHYPE_CATALOG_DIR at a directory whose siblings are the org.",
          ].join("\n"),
        );
      }
    },
  };
}
