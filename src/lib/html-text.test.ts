import { describe, expect, it } from "vitest";
import { INLINE, stripToFixedPoint, textOf } from "./html-text.ts";

describe("stripToFixedPoint", () => {
  /**
   * The failure a single pass has. Removing the inner `<span>` splices its
   * neighbours into a new `<span>` that the same pass has already stepped over,
   * so it survives — taking whatever it wrapped out of the scan with it.
   */
  it("removes a tag that only exists because an earlier removal spliced its neighbours", () => {
    expect(stripToFixedPoint("<<span>span>", INLINE, "")).toBe("");
  });

  it("returns the input unchanged when the pattern never matches", () => {
    expect(stripToFixedPoint("plain text", INLINE, "")).toBe("plain text");
  });
});

describe("textOf", () => {
  /**
   * A highlighted code block is one string cut into spans. Any separator
   * between them turns the token into fragments, and the checks that match on
   * `<label>.nanohype.dev` stop seeing it.
   */
  it("removes inline markup with no separator, so a highlighted token stays one string", () => {
    const html = '<span class="line"><span>fleet</span><span>.nanohype.dev</span></span>';
    expect(textOf(html)).toBe("fleet.nanohype.dev");
  });

  it("turns block tags into newlines, so adjacent blocks cannot fuse into a token nobody wrote", () => {
    expect(textOf("<p>fleet</p><p>.nanohype.dev</p>")).toBe("\nfleet\n\n.nanohype.dev\n");
  });

  /**
   * The `\b` in INLINE is what stops the `a` alternative swallowing every tag
   * that begins with `a`. Without it `<abbr>` would be removed with no
   * separator and could fuse its neighbours into a name that was never written.
   */
  it("treats <abbr> as a block tag rather than as <a>", () => {
    expect(textOf("<abbr>WAF</abbr>")).toBe("\nWAF\n");
  });

  it("drops script bodies entirely, leaving a separator", () => {
    expect(textOf('a<script>const g = "wat.nanohype.dev";</script>b')).toBe("a\nb");
  });

  it("closes a style block case-insensitively and absorbs its attributes", () => {
    expect(textOf('<style type="text/css">.x{content:"&lt;"}</STYLE>')).toBe("\n");
  });

  /**
   * Entities are decoded after every strip pass, so `&lt;`-escaped markup in a
   * printed code sample survives as literal text instead of being erased as a
   * tag. That is what lets a manifest the site prints reach the apiVersion
   * check at all.
   */
  it("decodes entities after stripping, so escaped markup survives as text", () => {
    expect(textOf("&lt;script&gt;alert(1)&lt;/script&gt;")).toBe("<script>alert(1)</script>");
  });

  /**
   * `&amp;` is decoded last. Moving it earlier makes `&amp;lt;` become `&lt;`
   * and then `<` — text the page never displayed.
   */
  it("decodes &amp; last, so &amp;lt; stays the literal text &lt;", () => {
    expect(textOf("&amp;lt;")).toBe("&lt;");
  });

  it("decodes in a single pass, so &amp;amp; unwraps exactly one level", () => {
    expect(textOf("&amp;amp;")).toBe("&amp;");
  });

  it("decodes hex entities case-insensitively, including astral code points", () => {
    expect(textOf("&#X2014;&#x1F680;")).toBe("—\u{1F680}");
  });

  it("decodes zero-padded decimal entities", () => {
    expect(textOf("&#039;")).toBe("'");
  });

  it("decodes the named table, with &nbsp; becoming an ASCII space", () => {
    expect(textOf("a&nbsp;b&quot;c&apos;d&amp;e")).toBe("a b\"c'd&e");
  });
});
