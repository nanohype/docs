import { afterEach, describe, expect, it } from "vitest";
import { siblingDir } from "./checkouts.ts";
import { rewriteMarkdownLinks } from "./markdown-links.ts";

/**
 * The grammar and the leave-alone contract, which both rewriters depend on.
 * What each of them decides is pinned in contracts.test.ts and guides.test.ts;
 * this covers only what they share.
 */
describe("rewriteMarkdownLinks", () => {
  const upper = (target: string) => target.toUpperCase();

  it("replaces the destination and keeps the rest of the link", () => {
    expect(rewriteMarkdownLinks("see [a](docs/x.md) here", upper)).toBe("see [a](DOCS/X.MD) here");
  });

  it("re-emits the title after the new destination", () => {
    expect(rewriteMarkdownLinks('[a](docs/x.md "A title")', upper)).toBe(
      '[a](DOCS/X.MD "A title")',
    );
  });

  it("passes the title to the rewriter with its leading whitespace intact", () => {
    const seen: string[] = [];
    rewriteMarkdownLinks('[a](x "t")', (_target, title) => {
      seen.push(title);
      return undefined;
    });
    expect(seen).toEqual([' "t"']);
  });

  /**
   * The contract both rewriters lean on for a target that cannot resolve
   * anywhere: the link comes back byte for byte, rather than pointing somewhere
   * invented.
   */
  it("leaves the link exactly as written when the rewriter returns undefined", () => {
    const markdown = '[a](../../x.md "T")';
    expect(rewriteMarkdownLinks(markdown, () => undefined)).toBe(markdown);
  });

  it("rewrites every link in a document, deciding each independently", () => {
    expect(
      rewriteMarkdownLinks("[a](keep) and [b](x)", (target) =>
        target === "keep" ? undefined : "Y",
      ),
    ).toBe("[a](keep) and [b](Y)");
  });

  it("does not treat an image or a reference link as an inline link", () => {
    const markdown = "![alt](img.png) and [ref][label]";
    // `![alt](…)` is an inline link with a `!` in front, so it rewrites; a
    // reference link carries no parenthesised target and must not.
    expect(rewriteMarkdownLinks(markdown, upper)).toBe("![alt](IMG.PNG) and [ref][label]");
  });

  it("returns text with no links unchanged", () => {
    expect(rewriteMarkdownLinks("no links here", upper)).toBe("no links here");
  });
});

describe("siblingDir", () => {
  const ENV = "NANOHYPE_TEST_DIR_FIXTURE";
  afterEach(() => {
    delete process.env[ENV];
  });

  it("prefers the environment override verbatim", () => {
    process.env[ENV] = "/somewhere/else";
    expect(siblingDir(ENV, "nanohype")).toBe("/somewhere/else");
  });

  it("ignores an empty override, which is how an unset CI variable arrives", () => {
    process.env[ENV] = "";
    expect(siblingDir(ENV, "nanohype")).not.toBe("");
  });

  it("resolves a sibling of the project root when unset", () => {
    expect(siblingDir(ENV, "nanohype")).toBe(`${process.cwd().replace(/\/[^/]+$/, "")}/nanohype`);
  });

  it("joins further segments into a path inside that sibling", () => {
    expect(siblingDir(ENV, "eks-fleet", "apis")).toBe(
      `${process.cwd().replace(/\/[^/]+$/, "")}/eks-fleet/apis`,
    );
  });
});
