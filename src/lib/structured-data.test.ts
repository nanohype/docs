import { describe, expect, it } from "vitest";
import { structuredData } from "./structured-data.ts";

const ORIGIN = "https://docs.nanohype.dev/";

const page = (over: Record<string, unknown> = {}) => ({
  siteName: "nanohype",
  title: "Quickstart",
  description: "Scaffold your first artifact from the catalog.",
  url: `${ORIGIN}quickstart/`,
  origin: ORIGIN,
  image: `${ORIGIN}og.png`,
  ...over,
});

type Node = Record<string, unknown>;

/**
 * The nodes of a graph. Throws rather than returning nothing when the result is
 * absent, so a case that produced no graph fails as a missing graph instead of
 * as an empty one.
 */
function graphOf(result: Node | undefined): Node[] {
  if (!result) throw new Error("expected a graph, and there was none");
  return result["@graph"] as Node[];
}

/** The nodes of a graph, by `@type`. */
function nodes(result: Node | undefined) {
  return graphOf(result).map((n) => n["@type"]);
}

/** Every `@id` a node points at, anywhere in the graph. */
function references(result: Node | undefined): string[] {
  return graphOf(result).flatMap((node) =>
    Object.values(node).flatMap((value) =>
      typeof value === "object" && value !== null && "@id" in value
        ? [(value as { "@id": string })["@id"]]
        : [],
    ),
  );
}

describe("structuredData", () => {
  /**
   * A consumer cannot tell an absent field from an absent page, so a partial
   * graph publishes a page as one that has no description rather than one whose
   * description did not reach here.
   */
  describe("emits nothing rather than a partial graph", () => {
    it.each(["siteName", "title", "description", "url"])("when %s is missing", (field) => {
      expect(structuredData(page({ [field]: undefined }))).toBeUndefined();
    });

    it.each(["siteName", "title", "description", "url"])("when %s is empty", (field) => {
      expect(structuredData(page({ [field]: "" }))).toBeUndefined();
    });
  });

  describe("a page below the root", () => {
    const result = structuredData(page());

    it("describes the organization, the site and the page", () => {
      expect(nodes(result)).toEqual(["Organization", "WebSite", "TechArticle"]);
    });

    it("carries the article's own values", () => {
      const article = graphOf(result)[2];
      expect(article).toMatchObject({
        "@id": `${ORIGIN}quickstart/#article`,
        headline: "Quickstart",
        url: `${ORIGIN}quickstart/`,
      });
    });
  });

  /**
   * The home page *is* the site. An article node there would describe it twice.
   */
  describe("the home page", () => {
    const result = structuredData(page({ url: ORIGIN, title: "nanohype" }));

    it("describes the organization and the site, and no article", () => {
      expect(nodes(result)).toEqual(["Organization", "WebSite"]);
    });

    it("gives the site the description the article node would have carried", () => {
      const site = graphOf(result)[1];
      expect(site.description).toBe(page().description);
    });
  });

  /**
   * The property that makes the graph readable at all: a crawler reaching one
   * page reaches one graph, so a reference out of it resolves to nothing.
   */
  describe("every reference resolves inside its own graph", () => {
    it.each([
      ["a page below the root", page()],
      ["the home page", page({ url: ORIGIN })],
    ])("%s", (_name, identity) => {
      const result = structuredData(identity);
      const defined = new Set(graphOf(result).map((n) => n["@id"] as string));
      for (const reference of references(result)) {
        expect(defined).toContain(reference);
      }
    });
  });

  it("names the schema.org context, without which the types mean nothing", () => {
    expect(structuredData(page())).toMatchObject({ "@context": "https://schema.org" });
  });
});
