import { describe, expect, it } from "vitest";
import { byCategory, compositesUsing, fileTree, tagCounts } from "./catalog.ts";

/**
 * Fixtures carry only the fields these functions read. The cast goes through
 * each function's own parameter type rather than importing the SDK's, so a
 * fixture cannot drift from the signature it is passed to.
 */
type Templates = Parameters<typeof byCategory>[0];
type Files = Parameters<typeof fileTree>[0];
type Composites = Parameters<typeof compositesUsing>[1];

const tpl = (entry: Record<string, unknown>) => ({ entry }) as unknown as Templates[number];
const file = (path: string) => ({ path }) as unknown as Files[number];
const composite = (name: string, templates: unknown) =>
  ({ entry: { name }, manifest: { templates } }) as unknown as Composites[number];

describe("byCategory", () => {
  it("groups by category and sorts templates by name within each", () => {
    const groups = byCategory([
      tpl({ name: "zebra", category: "app" }),
      tpl({ name: "alpha", category: "app" }),
    ]);
    expect(groups.get("app")?.map((t) => t.entry.name)).toEqual(["alpha", "zebra"]);
  });

  it("orders the categories themselves alphabetically", () => {
    const groups = byCategory([
      tpl({ name: "a", category: "zeta" }),
      tpl({ name: "b", category: "app" }),
    ]);
    expect([...groups.keys()]).toEqual(["app", "zeta"]);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("falls back to 'uncategorised' when the category is %s", (_kind, category) => {
    const groups = byCategory([tpl({ name: "a", category })]);
    expect([...groups.keys()]).toEqual(["uncategorised"]);
  });

  it("returns an empty map for no templates", () => {
    expect(byCategory([]).size).toBe(0);
  });
});

describe("tagCounts", () => {
  it("counts each tag across templates, most-used first", () => {
    expect(
      tagCounts([tpl({ name: "a", tags: ["k8s", "ts"] }), tpl({ name: "b", tags: ["k8s"] })]),
    ).toEqual([
      ["k8s", 2],
      ["ts", 1],
    ]);
  });

  it("breaks a tie on count by tag name, ascending", () => {
    expect(tagCounts([tpl({ name: "a", tags: ["zeta", "alpha"] })])).toEqual([
      ["alpha", 1],
      ["zeta", 1],
    ]);
  });

  /**
   * The `?? []` guard only ever fires on real catalog data, where the field is
   * optional — the type says it is always there.
   */
  it.each([
    ["absent", undefined],
    ["null", null],
  ])("contributes nothing for a template whose tags are %s", (_kind, tags) => {
    expect(tagCounts([tpl({ name: "a", tags })])).toEqual([]);
  });

  it("sorts by name lexically, not numerically", () => {
    expect(tagCounts([tpl({ name: "a", tags: ["v2", "v10"] })])).toEqual([
      ["v10", 1],
      ["v2", 1],
    ]);
  });
});

describe("fileTree", () => {
  it("returns the paths sorted", () => {
    expect(fileTree([file("src/b.ts"), file("README.md"), file("src/a.ts")])).toEqual([
      "README.md",
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  /**
   * Templates ship placeholder-named files, which is what the reader should
   * see. `localeCompare` puts `__APP_NAME__/` before `README.md`; a codepoint
   * sort would not.
   */
  it("sorts placeholder-named files where a reader expects them", () => {
    expect(fileTree([file("README.md"), file("__APP_NAME__/main.ts")])).toEqual([
      "__APP_NAME__/main.ts",
      "README.md",
    ]);
  });

  it("returns an empty list for a skeleton with no files", () => {
    expect(fileTree([])).toEqual([]);
  });
});

describe("compositesUsing", () => {
  const composites = [
    composite("platform", [{ template: "api-ts" }, { template: "worker-ts" }]),
    composite("edge", [{ template: "api-ts" }]),
    composite("empty", undefined),
  ];

  it("returns every composite that draws the template in, in input order", () => {
    expect(compositesUsing("api-ts", composites).map((c) => c.entry.name)).toEqual([
      "platform",
      "edge",
    ]);
  });

  it("returns nothing for a template no composite references", () => {
    expect(compositesUsing("unused", composites)).toEqual([]);
  });

  it("matches the template name exactly rather than by prefix", () => {
    expect(compositesUsing("api", composites)).toEqual([]);
  });

  /** Same optional-field guard as tagCounts: real manifests may omit it. */
  it("skips a composite whose templates list is absent rather than throwing", () => {
    expect(() => compositesUsing("api-ts", composites)).not.toThrow();
  });
});
