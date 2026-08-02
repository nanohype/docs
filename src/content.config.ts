import { defineCollection } from "astro:content";
import { docsLoader } from "@astrojs/starlight/loaders";
import { docsSchema } from "@astrojs/starlight/schema";
import { contractSchema, contractsLoader } from "./lib/contracts.ts";

export const collections = {
  docs: defineCollection({ loader: docsLoader(), schema: docsSchema() }),
  // Each repo's AGENTS.md, pulled from its sibling checkout at build time and
  // rendered through this site's own markdown pipeline. See src/lib/contracts.ts.
  contracts: defineCollection({ loader: contractsLoader(), schema: contractSchema }),
};
