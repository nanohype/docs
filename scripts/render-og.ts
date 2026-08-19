/**
 * Renders src/assets/og.svg to public/og.png, and checks the two stay together.
 *
 *   node scripts/render-og.ts          render, and record the source hash
 *   node scripts/render-og.ts --check  assert the render is current
 *
 * The PNG is committed rather than built. Rasterising text needs fonts, and a
 * CI runner does not have the ones this site uses, so a build-time render would
 * produce a different image there than here — silently, on an artifact nobody
 * looks at until it is already being shared. Committing it makes the artifact
 * everyone sees the one that was reviewed.
 *
 * That trade buys determinism and owes a freshness check in return, because a
 * committed render is a copy and every other copy in this repo is gated. The
 * check hashes the SVG rather than re-rendering it: hashing needs no fonts, so
 * it means the same thing on a runner as it does here. Editing og.svg without
 * re-rendering fails the build.
 *
 * The stamp sits beside the SVG it hashes rather than beside the render it
 * guards. public/ is served verbatim, so a stamp kept there is an internal
 * build artifact published at a public URL.
 */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "src/assets/og.svg";
const TARGET = "public/og.png";
const STAMP = "src/assets/og.svg.sha256";
const WIDTH = 1200;
const HEIGHT = 630;

const svg = await readFile(SOURCE);
const hash = createHash("sha256").update(svg).digest("hex");

/**
 * The canvas the SVG declares, read off its root element.
 *
 * Asserted on the source rather than the output: `resize` uses sharp's default
 * `fit: "cover"`, so the rendered PNG is 1200x630 whatever the source says —
 * an assertion on the output can never fail, and a changed canvas would be
 * silently cropped to fit instead of reported. The head slice is the same
 * technique src/lib/atlas.ts uses on the diagrams.
 */
const root = svg.toString("utf8").slice(0, 1024);
const declared = root.match(/\bwidth="(\d+)"[^>]*\bheight="(\d+)"/);
if (!declared || Number(declared[1]) !== WIDTH || Number(declared[2]) !== HEIGHT) {
  throw new Error(
    `${SOURCE} declares ${declared ? `${declared[1]}x${declared[2]}` : "no width/height"}; ` +
      `Open Graph needs ${WIDTH}x${HEIGHT}, and src/components/Head.astro states those values.`,
  );
}

if (process.argv.includes("--check")) {
  const recorded = await readFile(STAMP, "utf8").catch(() => "");
  if (recorded.trim() !== hash) {
    throw new Error(
      [
        `${TARGET} was rendered from a different ${SOURCE} than the one committed.`,
        `  recorded ${recorded.trim() || "(nothing)"}`,
        `  current  ${hash}`,
        "",
        "Run `node scripts/render-og.ts` and commit both the PNG and the stamp.",
      ].join("\n"),
    );
  }
  console.log(`og: ${TARGET} is current with ${SOURCE}`);
} else {
  // Rendered at 2x and downsampled, which is what keeps the text crisp — sharp
  // rasterises SVG at `density` DPI, and 72 leaves it soft at this size.
  const png = await sharp(svg, { density: 144 })
    .resize(WIDTH, HEIGHT)
    .png({ compressionLevel: 9 })
    .toBuffer();

  await writeFile(TARGET, png);
  await writeFile(STAMP, `${hash}\n`);
  console.log(`og: ${TARGET} ${WIDTH}x${HEIGHT}, ${(png.length / 1024).toFixed(1)} KB`);
}
