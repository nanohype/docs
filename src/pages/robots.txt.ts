import type { APIRoute } from "astro";

/**
 * `/robots.txt`, emitted at build time.
 *
 * A route rather than a file in `public/` so the sitemap URL comes from
 * `astro.config.mjs`'s `site` — the same value the canonical tags and the
 * sitemap itself are built from. A hand-written copy in `public/` would be a
 * second place the origin is spelled, and the two would agree right up until
 * the day they did not.
 *
 * Allow-all is deliberate and is the whole point of the file for this site.
 * Everything here is public documentation written to be read, by people and by
 * agents, and the sitemap reference is how a crawler finds the 187 pages
 * without walking links.
 */
export const GET: APIRoute = ({ site }) => {
  if (!site) {
    // `site` comes from astro.config.mjs and is what every absolute URL on this
    // site is built from. Failing here rather than emitting a relative or
    // guessed sitemap line keeps a misconfiguration from shipping as a
    // robots.txt that quietly points at nothing.
    throw new Error(
      "robots.txt needs `site` set in astro.config.mjs to write an absolute sitemap URL.",
    );
  }

  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    `Sitemap: ${new URL("sitemap-index.xml", site).href}`,
    "",
  ].join("\n");

  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
