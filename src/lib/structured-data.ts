/**
 * The schema.org description of a page, for readers that parse rather than read.
 *
 * Built from the values the head already carries — `og:site_name`, `og:title`,
 * `og:description`, `og:url` — rather than from the route. Those tags are what
 * a share crawler reads, and a machine-readable block that disagreed with them
 * would describe a different page than the one being shared. Deriving from one
 * source is what makes disagreement impossible rather than unlikely.
 */

export interface PageIdentity {
  /** `og:site_name`. */
  siteName: string | undefined;
  /** `og:title`. */
  title: string | undefined;
  /** `og:description`. */
  description: string | undefined;
  /** `og:url` — this page's absolute URL. */
  url: string | undefined;
  /** The site's origin, with a trailing slash. */
  origin: string;
  /** Absolute URL of the share image. */
  image: string;
}

/**
 * The graph, or nothing when the head did not carry what it is built from.
 *
 * A partial graph is worse than none: a consumer cannot tell an absent field
 * from an absent page, so a page missing its description would be published as
 * one that has none. Emitting nothing leaves the Open Graph tags as the only
 * description, which is the same information a page had before this existed.
 */
export function structuredData(page: PageIdentity): Record<string, unknown> | undefined {
  const { siteName, title, description, url, origin, image } = page;
  if (!siteName || !title || !description || !url) return undefined;

  const organization = `${origin}#organization`;
  const website = `${origin}#website`;

  /**
   * Both nodes appear on every page, not only the home page. A crawler that
   * reaches one page reaches one graph, so a reference to a node defined
   * somewhere else resolves to nothing.
   */
  const graph: Record<string, unknown>[] = [
    {
      "@type": "Organization",
      "@id": organization,
      name: siteName,
      url: origin,
      logo: image,
    },
    {
      "@type": "WebSite",
      "@id": website,
      name: siteName,
      url: origin,
      publisher: { "@id": organization },
    },
  ];

  // The home page *is* the site, so it carries no separate article node —
  // describing it as an article about itself would put two things in the graph
  // where the page has one.
  if (url !== origin) {
    graph.push({
      "@type": "TechArticle",
      "@id": `${url}#article`,
      headline: title,
      description,
      url,
      image,
      isPartOf: { "@id": website },
      publisher: { "@id": organization },
      inLanguage: "en",
    });
  } else {
    graph[1].description = description;
  }

  return { "@context": "https://schema.org", "@graph": graph };
}
