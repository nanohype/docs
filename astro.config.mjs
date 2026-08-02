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
            { label: "The substrate", link: "/substrate/" },
            { label: "The atlas", link: "/atlas/" },
          ],
        },
        {
          label: "Reference",
          items: [{ label: "Repos", link: "/repos/" }],
        },
      ],
    }),
  ],
});
