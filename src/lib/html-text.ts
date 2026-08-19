/**
 * Recovering the text a reader sees from built HTML.
 *
 * The postbuild checks read `dist/`, not source, because that is the only place
 * the authored pages and the generated ones exist together. What they need from
 * a page is the prose a reader actually sees — with the markup gone, but with
 * the *joins* right, because both checks match on tokens that markup can split
 * or fuse.
 *
 * Lives beside the other libs rather than inside the script that uses it so it
 * can be tested. scripts/check-vocabulary.ts is a top-level-await script that
 * walks `dist/` and calls `process.exit` on a violation, so importing it to
 * reach these two functions would run the whole check.
 */

/**
 * Inline tags are removed with nothing in their place; everything else becomes
 * a newline.
 *
 * The two halves matter in opposite directions. A syntax-highlighted code block
 * is one string cut into `<span>`s, so any separator between them corrupts the
 * token — `fleet.nanohype.dev` would arrive as three fragments and the group
 * check would stop seeing it. Block-level tags are the reverse: prose from two
 * adjacent blocks run together would produce a token nobody wrote.
 *
 * The `\b` is load-bearing. Without it the `a` alternative swallows every tag
 * beginning with `a` — `<abbr>`, `<article>`, `<aside>` — removing them with no
 * separator and fusing whatever sat either side.
 */
export const INLINE = /<\/?(?:span|a|code|em|strong|b|i|mark|sup|sub)\b[^>]*>/gi;
const TAG = /<[^>]+>/g;

/**
 * Applies a pattern until the string stops changing.
 *
 * One pass is not enough: removing a match can splice its neighbours into a new
 * match that the same pass already stepped over. `<<span>span>` reduces to
 * `<span>` and would survive, taking whatever it wrapped out of the scan with
 * it. Repeating to a fixed point is what makes "the tags are gone" true rather
 * than usually true, and every pattern here only ever shortens the string, so
 * it terminates.
 */
export function stripToFixedPoint(input: string, pattern: RegExp, replacement: string): string {
  let current = input;
  for (;;) {
    const next = current.replace(pattern, replacement);
    if (next === current) return current;
    current = next;
  }
}

/**
 * The text of a page, with markup removed and entities decoded.
 *
 * Order is deliberate throughout. Script and style bodies go first, so a
 * hostname living in JavaScript never reaches the scans. Entities are decoded
 * last, after every strip pass, so `&lt;`-escaped markup in a code sample
 * survives as literal text instead of being erased as a tag — which is what
 * lets a printed manifest reach the apiVersion check at all.
 *
 * Within the decode chain `&amp;` is last. Decoding it first would turn
 * `&amp;lt;` into `&lt;` and then into `<`, text the page never displayed.
 */
export function textOf(html: string): string {
  const withoutScripts = stripToFixedPoint(html, /<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "\n");
  const withoutInline = stripToFixedPoint(withoutScripts, INLINE, "");
  return stripToFixedPoint(withoutInline, TAG, "\n")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}
