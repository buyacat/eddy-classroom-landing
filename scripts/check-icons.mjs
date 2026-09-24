import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RASTER = 'public/assets/icons';
const SOURCE = 'src/components';
const ICON_SOURCE = 'src/assets/icon-src';

const PACK = ['document', 'check', 'lightbulb', 'megaphone', 'clock', 'trophy'];

const MIN_OPACITY = 0.40;
const MAX_GLARE = 250;
const MIN_H = 205;

function attr(tag, name) {
  for (const match of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) {
    if (match[1] === name) return match[2];
  }
  return null;
}

function paintArea(tag, name) {
  const strokeWidth = +(attr(tag, 'stroke-width') || 0);
  const stroked = attr(tag, 'fill') === 'none' && strokeWidth > 0;

  if (name === 'circle') {
    const r = +attr(tag, 'r');
    return stroked ? 2 * Math.PI * r * strokeWidth : Math.PI * r * r;
  }
  if (name === 'ellipse') {
    const a = +attr(tag, 'rx');
    const b = +attr(tag, 'ry');
    const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
    return stroked ? perimeter * strokeWidth : Math.PI * a * b;
  }
  if (name === 'rect') {
    const w = +attr(tag, 'width');
    const h = +attr(tag, 'height');
    return stroked ? 2 * (w + h) * strokeWidth : w * h;
  }

  const d = attr(tag, 'd') ?? attr(tag, 'points');
  if (!d) return 0;
  const nums = [...String(d).matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  const xs = nums.filter((_, i) => i % 2 === 0);
  const ys = nums.filter((_, i) => i % 2 === 1);
  if (!xs.length) return 0;
  const w = Math.max(...xs) - Math.min(...xs);
  const h = Math.max(...ys) - Math.min(...ys);
  return stroked ? Math.hypot(w, h) * strokeWidth * 1.15 : w * h * 0.5;
}

function isWhite(value) {
  if (!value) return false;
  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(value.trim());
  if (!hex) return value.trim().toLowerCase() === 'white';
  const full = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)).every((c) => c >= 240);
}

function scan(svg) {
  const blur = new Map();
  for (const filter of svg.matchAll(/<filter\b[^>]*\bid="([^"]+)"[\s\S]*?<\/filter>/g)) {
    const sd = /stdDeviation="([\d.]+)"/.exec(filter[0]);
    blur.set(filter[1], sd ? parseFloat(sd[1]) : 0);
  }

  const defs = [...svg.matchAll(/<defs\b[\s\S]*?<\/defs>/g)]
    .map((d) => [d.index, d.index + d[0].length]);

  const groups = [];
  const found = [];

  for (const el of svg.matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g)) {
    const [, closing, name, tag, selfClosing] = el;
    if (defs.some(([from, to]) => el.index >= from && el.index < to)) continue;
    if (closing) {
      if (name === 'g') groups.pop();
      continue;
    }

    const own = { fill: attr(tag, 'fill'), stroke: attr(tag, 'stroke'), filter: attr(tag, 'filter') };
    const inherited = (key) => own[key] ?? groups.findLast((g) => g[key] != null)?.[key] ?? null;

    if (name === 'g') {
      if (!selfClosing) groups.push(own);
      continue;
    }
    if (!/^(path|rect|ellipse|circle|polygon)$/.test(name)) continue;

    const paint = isWhite(inherited('fill')) ? 'fill' : isWhite(inherited('stroke')) ? 'stroke' : null;
    if (!paint) continue;

    const rawOpacity = attr(tag, 'opacity') ?? attr(tag, `${paint}-opacity`);
    if (rawOpacity === null) continue;
    const opacity = parseFloat(rawOpacity);
    if (!(opacity < 1)) continue;

    const filterId = /url\(#([^)]+)\)/.exec(inherited('filter') || '');
    const blurRadius = filterId ? (blur.get(filterId[1]) ?? 0) : 0;
    const area = paintArea(tag, name);

    found.push({
      opacity,
      blur: blurRadius,
      area,
      glare: (opacity * area) / Math.pow(1 + blurRadius, 2),
      line: svg.slice(0, el.index).split('\n').length
    });
  }

  return found;
}

export function glass(svg) {
  return scan(svg).filter((o) => o.opacity > MIN_OPACITY && o.glare > MAX_GLARE);
}

const INTENT = /data-glass-ok="([^"]+)"/;
export const glassOk = (svg) =>
  (INTENT.exec(svg) || [])[1]?.trim() ?? null;

export function inlineSvgs(src) {
  return [...src.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0]);
}

async function drawnBox(file) {
  const { data, info } = await sharp(`${RASTER}/${file}`).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels } = info;

  let minY = H, maxY = -1, minX = W, maxX = -1;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * channels + 3] <= 24) continue;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
    }
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

async function requestedPngs() {
  const { existsSync } = await import('node:fs');
  if (!existsSync('dist')) return null;

  const pages = [];
  for (const dir of ['dist', 'dist/en']) {
    if (!existsSync(dir)) continue;
    for (const file of await readdir(dir)) {
      if (file.endsWith('.html')) pages.push(await readFile(`${dir}/${file}`, 'utf8'));
    }
  }

  const requested = new Set();
  for (const html of pages) {
    for (const m of html.matchAll(/assets\/icons\/([a-z0-9-]+)\.png/g)) requested.add(m[1]);
  }
  return requested;
}

const layerLine = (o) =>
  `${o.opacity} at ${o.blur}px over ${((100 * o.area) / 65536).toFixed(2)}%, line ${o.line}`;

function tightLayers(svg, name) {
  const overBudget = glass(svg);
  return scan(svg)
    .filter((o) => o.opacity > 0.55 && o.blur < 4 && !overBudget.some((g) => g.line === o.line))
    .map((o) => ({ name, line: layerLine(o) }));
}

async function report() {
  const pngs = (await readdir(RASTER)).filter((f) => f.endsWith('.png'));
  const drawn = (await readdir(ICON_SOURCE)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
  const onPage = await requestedPngs();

  console.log('── licensed pack (height reference) ──');
  let shortest = 256;
  for (const name of PACK) {
    if (!pngs.includes(`${name}.png`)) continue;
    const { w, h } = await drawnBox(`${name}.png`);
    shortest = Math.min(shortest, h);
    console.log(`  · ${`${name}.png`.padEnd(15)}${String(w).padStart(3)}×${String(h).padStart(3)}`);
  }
  console.log(`  shortest pack object ${shortest}`);

  console.log(`\n── drawn here (glare ≤ ${MAX_GLARE}; height ≥ ${MIN_H}) ──`);
  let bad = 0;
  const tight = [];

  for (const name of drawn) {
    const svg = await readFile(`${ICON_SOURCE}/${name}.svg`, 'utf8');
    const errors = [];
    const notes = [];
    const rendered = pngs.includes(`${name}.png`);
    const used = onPage ? onPage.has(name) : rendered;
    const { w, h } = rendered ? await drawnBox(`${name}.png`) : { w: 0, h: 0 };

    if (used && h < MIN_H) errors.push(`${MIN_H - h}px too short`);
    if (!used) notes.push(rendered ? 'rendered but no page asks for it' : 'not rendered');

    const intent = glassOk(svg);
    for (const layer of glass(svg)) {
      if (intent) tight.push({ name: `${name}.svg`, line: layerLine(layer), why: intent });
      else errors.push(`glare ${Math.round(layer.glare)}: ${layerLine(layer)}`);
    }
    tight.push(...tightLayers(svg, `${name}.svg`));

    if (errors.length) bad++;
    console.log(`  ${errors.length ? '✗' : '·'} ${`${name}.svg`.padEnd(15)}` +
      (rendered ? `${String(w).padStart(3)}×${String(h).padStart(3)}` : '       ') +
      (notes.length ? `  ${notes.join(', ')}` : '') +
      (errors.length ? `   ← ${errors.join('; ')}` : ''));
  }

  const components = (await readdir(SOURCE)).filter((f) => f.endsWith('.astro'));
  const inline = [];
  for (const file of components) {
    const src = await readFile(`${SOURCE}/${file}`, 'utf8');
    const intent = glassOk(src);
    for (const svg of inlineSvgs(src)) {
      for (const layer of glass(svg)) inline.push({ file, layer, intent });
      tight.push(...tightLayers(svg, file));
    }
  }

  if (inline.length) {
    console.log('\n── inline <svg> in components ──');
    for (const { file, layer, intent } of inline) {
      if (!intent) bad++;
      console.log(`  ${intent ? '·' : '✗'} ${file.padEnd(20)}glare ${Math.round(layer.glare)}: ` +
        layerLine(layer) + (intent ? `   ← intended: ${intent}` : ''));
    }
  }

  if (tight.length) {
    console.log('\n── tight bright layers: not failures, but look at them ──');
    for (const layer of tight) {
      console.log(`  ${String(layer.name).padEnd(20)}${layer.line}` +
        (layer.why ? `   ← intended: ${layer.why}` : ''));
    }
    console.log('  white on glass is intended (rocket porthole, cornea); white on clay is not');
  }

  console.log(bad ? `\n${bad} over budget` : '\nwhole set in one material language');
  return bad;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit((await report()) ? 1 : 0);
}
