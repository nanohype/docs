import { describe, expect, it } from "vitest";
import { entryFaults } from "./atlas.ts";

/** A whole entry, in the shape the atlas emit produces. */
const whole = () => ({
  index: 0,
  id: "legend",
  name: "How to read this",
  blurb: "Ten views of one system.",
  svg: "00-legend-light.svg",
});

describe("entryFaults", () => {
  it("finds nothing wrong with a whole entry", () => {
    expect(entryFaults(whole())).toEqual([]);
  });

  it("ignores fields the site does not consume", () => {
    expect(entryFaults({ ...whole(), addedUpstream: { anything: true } })).toEqual([]);
  });

  /**
   * Each of the five is checked because each reaches a page. `name` and `blurb`
   * are the ones that reach it as prose — a title, an alt text and a meta
   * description — where neither postbuild gate looks.
   */
  describe("a field the site consumes", () => {
    it.each(["id", "name", "blurb", "svg"])("cannot be missing: %s", (field) => {
      const entry = whole() as Record<string, unknown>;
      delete entry[field];
      expect(entryFaults(entry)).toEqual([`${field} is missing`]);
    });

    it.each(["id", "name", "blurb", "svg"])("cannot be the wrong type: %s", (field) => {
      expect(entryFaults({ ...whole(), [field]: 7 })).toEqual([
        `${field} is not a non-empty string`,
      ]);
    });

    /** An empty string renders as nothing at all, which reads as a whole page. */
    it.each(["id", "name", "blurb", "svg"])("cannot be empty: %s", (field) => {
      expect(entryFaults({ ...whole(), [field]: "" })).toEqual([
        `${field} is not a non-empty string`,
      ]);
    });
  });

  describe("index", () => {
    it("must be present", () => {
      const entry = whole() as Record<string, unknown>;
      delete entry.index;
      expect(entryFaults(entry)).toEqual(["index is missing"]);
    });

    /** The source link pads it to two digits, so a string or a float names no file. */
    it.each([["a string", "0"] as const, ["a float", 1.5] as const])(
      "must be an integer, not %s",
      (_kind, value) => {
        expect(entryFaults({ ...whole(), index: value })).toEqual(["index is not an integer"]);
      },
    );

    it("accepts zero, which is the first perspective", () => {
      expect(entryFaults({ ...whole(), index: 0 })).toEqual([]);
    });
  });

  it("reports every fault in one entry rather than the first", () => {
    expect(entryFaults({ id: "legend" })).toEqual([
      "name is missing",
      "blurb is missing",
      "svg is missing",
      "index is missing",
    ]);
  });

  it.each([
    ["null", null],
    ["a string", "legend"],
    ["an array", []],
  ])("rejects %s, which is not an entry at all", (_kind, value) => {
    expect(entryFaults(value)).toEqual(["is not an object"]);
  });
});
