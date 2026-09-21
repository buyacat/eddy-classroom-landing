/*
 * SVG → PNG for the objects drawn for this site (src/assets/icon-src/).
 *
 * The bought objects arrive as PNGs and are never touched. The drawn ones
 * have to be rasterised, and until now that happened by hand, which is why
 * three of them drifted out of the pack's material language without anyone
 * being able to diff it. Render is one command; `npm run check:icons`
 * measures the result against the bought objects.
 *
 *   npm run icons            all of them
 *   npm run icons -- cube3d  just one
 */
import sharp from 'sharp';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = 'src/assets/icon-src';
const OUT = 'public/assets/icons';
const only = process.argv.slice(2);

const names = (await readdir(SRC))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .filter((n) => !only.length || only.includes(n));

if (!names.length) {
  console.error(only.length ? `no such icon: ${only.join(', ')}` : 'nothing to render');
  process.exit(1);
}

for (const n of names) {
  await sharp(join(SRC, `${n}.svg`))
    .resize(256, 256, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `${n}.png`));
  console.log(`rendered ${n}.png`);
}
