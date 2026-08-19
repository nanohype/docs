import { describe, expect, it } from "vitest";
import { resolveRepoPath, rewriteGuideLinks } from "./guides.ts";

const REPO = "https://github.com/nanohype/nanohype";

describe("resolveRepoPath", () => {
  it("resolves a target against the directory of the document that wrote it", () => {
    expect(resolveRepoPath("docs/spec", "../catalog.md")).toBe("docs/catalog.md");
  });

  it("collapses '.' and empty segments", () => {
    expect(resolveRepoPath("docs", "./spec//x.md")).toBe("docs/spec/x.md");
  });

  it("preserves a trailing slash, which is what marks a directory", () => {
    expect(resolveRepoPath("docs", "spec/")).toBe("docs/spec/");
  });

  /**
   * The comparison the doc comment draws: the same `../..` reaches the repo
   * root from docs/spec/ and would climb above it from docs/. There is no
   * guard — `out.pop()` on an empty array is a no-op — so the escaping segment
   * is dropped rather than emitted, because a URL containing `..` resolves to
   * nothing on GitHub.
   */
  it("reaches the repo root from a nested guide", () => {
    expect(resolveRepoPath("docs/spec", "../../README.md")).toBe("README.md");
  });

  it("drops segments that would escape the repo rather than emitting '..'", () => {
    expect(resolveRepoPath("docs", "../../README.md")).toBe("README.md");
  });
});

describe("rewriteGuideLinks", () => {
  describe("targets that are already absolute", () => {
    it.each([
      ["https", "[x](https://example.dev/a)"],
      ["a bare fragment", "[x](#section)"],
      ["root-relative", "[x](/catalog/)"],
    ])("leaves %s untouched", (_kind, markdown) => {
      expect(rewriteGuideLinks(markdown, "catalog.md")).toBe(markdown);
    });
  });

  /**
   * The case that matters most. These documents reference each other, and
   * sending a reader to GitHub mid-section to read the next page of the same
   * section would be worse than the broken link it replaces.
   */
  describe("targets this site also publishes become internal routes", () => {
    it("rewrites a sibling reference from docs/", () => {
      expect(rewriteGuideLinks("[c](catalog.md)", "platform-reference.md")).toBe(
        "[c](/building/catalog-reference/)",
      );
    });

    it("rewrites the same document referenced from docs/spec/, one level down", () => {
      expect(rewriteGuideLinks("[c](../catalog.md)", "spec/template-contract.md")).toBe(
        "[c](/building/catalog-reference/)",
      );
    });

    it("keeps a fragment on an internal route", () => {
      expect(rewriteGuideLinks("[c](catalog.md#modules)", "platform-reference.md")).toBe(
        "[c](/building/catalog-reference/#modules)",
      );
    });
  });

  describe("everything else points back at the catalog repo", () => {
    it("rewrites an unpublished file to blob/main", () => {
      expect(rewriteGuideLinks("[r](../README.md)", "catalog.md")).toBe(
        `[r](${REPO}/blob/main/README.md)`,
      );
    });

    it("serves a trailing slash under tree", () => {
      expect(rewriteGuideLinks("[t](../templates/)", "catalog.md")).toBe(
        `[t](${REPO}/tree/main/templates/)`,
      );
    });

    it("keeps a fragment on an external link", () => {
      expect(rewriteGuideLinks("[r](../README.md#usage)", "catalog.md")).toBe(
        `[r](${REPO}/blob/main/README.md#usage)`,
      );
    });

    /**
     * A target that collapses to nothing has no path to serve under blob or
     * tree. Emitting one anyway produced `/blob/main/`, which is the 404 the
     * segment-dropping in resolveRepoPath exists to avoid.
     */
    it("gives the repo root when the target collapses to nothing", () => {
      expect(rewriteGuideLinks("[up](..)", "catalog.md")).toBe(`[up](${REPO})`);
    });
  });
});
