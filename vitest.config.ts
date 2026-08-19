import { defineConfig } from "vitest/config";

/**
 * The unit tier, over the pure functions in src/lib/.
 *
 * Deliberately narrow. The site's real assurance is the four postbuild gates,
 * which read the built `dist/` and check the error page, the share card's
 * freshness, every apiVersion the site prints, and every link, anchor and
 * llms.txt route it publishes — that is the integration tier and it is where a
 * broken page is actually caught. What those gates cannot do is tell you
 * *which* rule broke when a rewriter changes: they report a dead link, not the
 * `..` case that produced it. These tests pin the rules themselves, so a
 * regression names itself.
 *
 * Only functions that are pure are in scope. Anything that reads the catalog,
 * the atlas or `dist/` belongs to the gates, which already run against the real
 * thing rather than a fixture of it.
 */
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
