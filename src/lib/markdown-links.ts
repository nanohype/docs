/**
 * Rewriting the links in markdown this repo did not author.
 *
 * Two sections render markdown written for someone standing in another repo:
 * each repo's `AGENTS.md`, and the reference guides the catalog carries. A
 * relative target in either means a file in the repo that wrote it, so served
 * from this origin it is a 404 — the page renders, the links are dead, and
 * nothing reports it.
 *
 * Where those two sections differ is entirely in where a target should point.
 * The grammar they parse is the same, and the cost of a second copy of it is
 * not duplication but divergence: a link form handled by one and missed by the
 * other produces a broken link in exactly one section, which is the shape that
 * survives review.
 */

/**
 * Decides where one link points.
 *
 * `target` is the link's destination as written, `title` the optional quoted
 * title with its leading whitespace intact. Returning a string replaces the
 * destination and keeps the title; returning `undefined` leaves the link
 * exactly as written, which is what a target that cannot be resolved anywhere
 * should get — it then reads as what it is rather than pointing somewhere
 * invented.
 */
export type LinkRewriter = (target: string, title: string) => string | undefined;

/**
 * The inline-link form: `](target)` and `](target "title")`.
 *
 * Targets are matched as non-whitespace so a title cannot be absorbed into
 * one, and the title is captured with its leading space so it can be re-emitted
 * byte for byte.
 */
const INLINE_LINK = /\]\(([^)\s]+)(\s+"[^"]*")?\)/g;

/** Applies a rewriter to every inline link in a markdown document. */
export function rewriteMarkdownLinks(markdown: string, rewrite: LinkRewriter): string {
  return markdown.replace(INLINE_LINK, (whole, target: string, title = "") => {
    const rewritten = rewrite(target, title);
    return rewritten === undefined ? whole : `](${rewritten}${title})`;
  });
}
