// @ts-check

import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";

// https://astro.build/config
export default defineConfig({
  site: "https://docs.nanohype.dev",
  integrations: [
    starlight({
      title: "nanohype",
      description:
        "The k8s-native software factory — the template + composite catalog, the factory client, and the substrate it ships onto.",
      logo: { src: "./src/assets/mark.svg", alt: "nanohype", replacesTitle: false },
      favicon: "/favicon.svg",
      // The shared shuttering theme: void ground + beam palette (matches
      // nanohype.dev), then the site's own fonts. See @shuttering/starlight.
      customCss: [
        "@shuttering/starlight/grounds/void.css",
        "@shuttering/starlight/palettes/beam.css",
        "@shuttering/starlight",
        "./src/styles/site.css",
      ],
      components: {
        Hero: "./src/components/Hero.astro",
        // Icon theme toggle + view transitions (with the TOC scroll-spy fix).
        ThemeSelect: "@shuttering/starlight/ThemeSelect.astro",
        Head: "@shuttering/starlight/Head.astro",
      },
      social: [{ icon: "github", label: "GitHub", href: "https://github.com/nanohype" }],
      editLink: { baseUrl: "https://github.com/nanohype/docs/edit/main/" },
      lastUpdated: true,
      sidebar: [
        {
          label: "Start here",
          items: [
            { label: "Overview", link: "/" },
            { label: "Quickstart", link: "/quickstart/" },
          ],
        },
        {
          label: "The factory",
          items: [
            { label: "How it works", link: "/factory/" },
            { label: "Templates & catalog", link: "/catalog/" },
          ],
        },
        {
          // Pulled from the catalog repo's docs/ at build time — see src/lib/guides.ts.
          label: "Building against it",
          items: [
            { label: "Start here", link: "/building/" },
            { label: "Platform Reference", link: "/building/platform-reference/" },
            { label: "Catalog reference", link: "/building/catalog-reference/" },
            { label: "Composites", link: "/building/composites/" },
            { label: "Production readiness", link: "/building/production-readiness/" },
            { label: "Authoring a template", link: "/building/authoring-a-template/" },
            { label: "Template contract", link: "/building/template-contract/" },
            { label: "Composite contract", link: "/building/composite-contract/" },
            { label: "Building a consumer", link: "/building/consumer-guide/" },
            { label: "The pattern", link: "/building/reference-pattern/" },
          ],
        },
        {
          // Generated from nanohype/nanohype at build time — see src/lib/catalog.ts.
          // Index pages only: the ~130 detail pages hang off them and are reached by
          // search and by link, not by a sidebar nobody could scan.
          label: "Reference: the catalog",
          items: [
            { label: "Templates", link: "/catalog/templates/" },
            { label: "Composites", link: "/catalog/composites/" },
            { label: "Standards", link: "/catalog/standards/" },
          ],
        },
        {
          label: "The platform",
          items: [
            { label: "Platform tenants", link: "/platform/" },
            // Generated from the CRDs eks-agent-platform ships — see
            // src/lib/resources.ts. Index only; the per-kind pages hang off it.
            { label: "Resource reference", link: "/platform/resources/" },
            { label: "The substrate", link: "/substrate/" },
            { label: "The atlas", link: "/atlas/" },
          ],
        },
        {
          // Authored, not generated — the reasoning behind the shapes the rest
          // of this site describes. Every other section renders something the
          // org already ships; this is the part no generator can write.
          label: "Decisions",
          items: [
            { label: "Overview", link: "/decisions/" },
            { label: "Identity is bound, not annotated", link: "/decisions/identity-binding/" },
            { label: "The kill switch changes AWS", link: "/decisions/kill-switch/" },
            {
              label: "A tenant's substrate is a declaration",
              link: "/decisions/tenant-substrate/",
            },
            { label: "Layers are drawn by rate of change", link: "/decisions/layer-boundaries/" },
            { label: "Crossplane orders the IaC", link: "/decisions/crossplane-ordering/" },
            { label: "One account holds a product", link: "/decisions/one-account/" },
          ],
        },
        {
          // Authored. The failure class a platform actually has, and the
          // per-repo runbooks for the failures that have a procedure rather
          // than a shape.
          label: "Operating it",
          items: [{ label: "How this fails", link: "/failure-modes/" }],
        },
        {
          label: "Reference",
          items: [{ label: "Repos", link: "/repos/" }],
        },
      ],
    }),
  ],
});
