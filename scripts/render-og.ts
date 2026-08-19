/**
 * Renders src/assets/og.svg to public/og.png.
 *
 * Run by hand, and the PNG is committed. This is the one published asset that
 * is deliberately not generated during the build, because rasterising text
 * needs fonts and a CI runner does not have the ones this site uses — the same
 * source would produce a different image in CI than it does here, silently.
 * Committing the render makes the shared artifact the reviewed one.
 *
 * Regenerate after editing the SVG:
 *
 *   node scripts/render-og.ts
 *
 * Usage note: 1200x630 is the Open Graph size, and the `og:image:width` and
 * `og:image:height` in src/components/Head.astro state it. Changing the canvas
 * means changing those too.
 */
import { readFile, writeFile } from "node:fs/promises";
import sharp from "sharp";

const SOURCE = "src/assets/og.svg";
const TARGET = "public/og.png";
const WIDTH = 1200;
const HEIGHT = 630;

const svg = await readFile(SOURCE);
const png = await sharp(svg, { density: 144 })
  .resize(WIDTH, HEIGHT)
  .png({ compressionLevel: 9 })
  .toBuffer();

const { width, height } = await sharp(png).metadata();
if (width !== WIDTH || height !== HEIGHT) {
  throw new Error(`${SOURCE} rendered at ${width}x${height}; Open Graph needs ${WIDTH}x${HEIGHT}.`);
}

await writeFile(TARGET, png);
console.log(`og: ${TARGET} ${width}x${height}, ${(png.length / 1024).toFixed(1)} KB`);
