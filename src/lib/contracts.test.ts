import { describe, expect, it } from "vitest";
import { rewriteLinks } from "./contracts.ts";

/**
 * Every link in a repo's AGENTS.md is written for someone standing in that
 * repo. Served from this origin it would 404, so rewriteLinks repoints it at
 * GitHub. The rules are stated in the doc comment above the function; these pin
 * them.
 */
describe("rewriteLinks", () => {
  describe("targets that are already absolute", () => {
    it.each([
      ["https", "[docs](https://docs.nanohype.dev/guides/)"],
      ["http", "[api](http://example.dev/x)"],
      ["mailto", "[mail](mailto:hi@nanohype.dev)"],
      ["a bare fragment", "[top](#overview)"],
      ["root-relative", "[root](/standards/llm.json)"],
    ])("leaves %s untouched", (_kind, markdown) => {
      expect(rewriteLinks(markdown, "kx")).toBe(markdown);
    });
  });

  describe("paths inside the repo that wrote them", () => {
    it("rewrites a relative path to blob/main in its own repo", () => {
      expect(rewriteLinks("[arch](docs/architecture.md)", "kx")).toBe(
        "[arch](https://github.com/nanohype/kx/blob/main/docs/architecture.md)",
      );
    });

    it("serves a trailing slash under tree rather than blob, and keeps the slash", () => {
      expect(rewriteLinks("[dir](docs/)", "kx")).toBe(
        "[dir](https://github.com/nanohype/kx/tree/main/docs/)",
      );
    });

    it("collapses '.' and empty segments", () => {
      expect(rewriteLinks("[c](./docs//x.md)", "portal")).toBe(
        "[c](https://github.com/nanohype/portal/blob/main/docs/x.md)",
      );
    });

    it("pops the previous segment for an interior '..' rather than counting it as climbing", () => {
      expect(rewriteLinks("[pop](docs/../README.md)", "fab")).toBe(
        "[pop](https://github.com/nanohype/fab/blob/main/README.md)",
      );
    });

    it("yields the bare repo URL when the path resolves to the repo root", () => {
      expect(rewriteLinks("[c](./)", "kx")).toBe("[c](https://github.com/nanohype/kx)");
    });
  });

  describe("titles", () => {
    it("keeps a title on a blob rewrite", () => {
      expect(rewriteLinks('[t](docs/architecture.md "Architecture")', "kx")).toBe(
        '[t](https://github.com/nanohype/kx/blob/main/docs/architecture.md "Architecture")',
      );
    });

    it("orders the trailing slash before the title, not after it", () => {
      expect(rewriteLinks('[t](docs/ "The docs dir")', "kx")).toBe(
        '[t](https://github.com/nanohype/kx/tree/main/docs/ "The docs dir")',
      );
    });
  });

  /**
   * The org layout puts every repo side by side, so climbing out of one lands
   * in the org checkout and the next segment names a sibling repo.
   */
  describe("climbing out to a sibling repo", () => {
    it("repoints at the sibling named by the next segment", () => {
      expect(rewriteLinks("[sib](../kx/AGENTS.md)", "eks-gitops")).toBe(
        "[sib](https://github.com/nanohype/kx/blob/main/AGENTS.md)",
      );
    });

    it("still applies the tree/blob choice inside the sibling", () => {
      expect(rewriteLinks("[sib](../kx/charts/)", "eks-gitops")).toBe(
        "[sib](https://github.com/nanohype/kx/tree/main/charts/)",
      );
    });

    it("yields the sibling's bare URL when nothing follows the repo name", () => {
      expect(rewriteLinks("[sib](../kx)", "eks-gitops")).toBe(
        "[sib](https://github.com/nanohype/kx)",
      );
    });
  });

  /**
   * A link that cannot resolve anywhere is left exactly as written, so it reads
   * as what it is rather than being pointed at something invented.
   */
  describe("links that resolve nowhere", () => {
    it("leaves a climb past the org root alone", () => {
      const markdown = "[up2](../../nanohype/templates/README.md)";
      expect(rewriteLinks(markdown, "eks-gitops")).toBe(markdown);
    });

    it("leaves a climb with nothing after it alone", () => {
      expect(rewriteLinks("[up](..)", "eks-gitops")).toBe("[up](..)");
    });

    /**
     * The case this guard was added for. `../README.md` reads as "the file one
     * level up", but the climb means the next segment is taken as a repo name —
     * so without the check it became https://github.com/nanohype/README.md, a
     * repo that does not exist. Nothing downstream caught it either: that URL
     * carries no /blob/ or /tree/ segment, so check-links.ts recorded no path
     * to verify and passed it.
     */
    it.each([
      ["a file one level up", "[x](../README.md)"],
      ["an extensionless file one level up", "[x](../LICENSE)"],
      ["a repo whose contract this site does not publish", "[x](../nanohype.dev/x.md)"],
    ])("leaves %s alone rather than inventing a repo", (_kind, markdown) => {
      expect(rewriteLinks(markdown, "kx")).toBe(markdown);
    });

    it("leaves a popped-past-the-start path alone", () => {
      expect(rewriteLinks("[deep](a/../../c.md)", "fab")).toBe("[deep](a/../../c.md)");
    });
  });

  it("rewrites every link in a document, not just the first", () => {
    expect(rewriteLinks("see [a](docs/a.md) and [b](../kx/b.md)", "fab")).toBe(
      "see [a](https://github.com/nanohype/fab/blob/main/docs/a.md)" +
        " and [b](https://github.com/nanohype/kx/blob/main/b.md)",
    );
  });
});
