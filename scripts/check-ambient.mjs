const PORT = 9333;
const PAGE = process.env.AMB_URL || 'http://localhost:5178/';
const WIDTHS = (process.env.AMB_W || '1440,1920,2560,1280,900,700').split(',').map(Number);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const target = list.find((t) => t.type === 'page');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
};
const send = (method, params = {}) =>
  new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

const MEASURE = `(() => {
  const OVERHANG = 0.34;
  const out = [];
  for (const el of document.querySelectorAll('.band, .cta-band')) {
    const bg = getComputedStyle(el, '::before').backgroundImage;
    if (!bg || bg === 'none') continue;
    const pools = [];
    let depth = 0, cur = '';
    for (const ch of bg) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { pools.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    if (cur.trim()) pools.push(cur.trim());
    out.push({ cls: el.className, h: el.offsetHeight, boxH: el.offsetHeight * (1 + 2 * OVERHANG), pools });
  }
  return JSON.stringify(out);
})()`;

await send('Page.enable');
let bad = 0;

for (const w of WIDTHS) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: 1000, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: PAGE });
  await new Promise((r) => setTimeout(r, 2500));
  const r = await send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
  console.log(`\n──────── ${w}px ────────`);
  for (const b of JSON.parse(r.result.result.value)) {
    const name = '.' + b.cls.split(' ').join('.');
    for (const p of b.pools) {
      const m = p.match(/radial-gradient\(([\d.]+)px\s+([\d.]+)px(?: at ([\d.]+)% ([\d.]+)%)?/);
      if (!m) { console.log(`  ${name}  ? ${p.slice(0, 70)}`); continue; }
      const ry = parseFloat(m[2]);
      const cy = m[4] === undefined ? 50 : parseFloat(m[4]);
      const stops = [...p.matchAll(/rgba?\([^)]*\)\s+([\d.]+)%/g)].map((s) => parseFloat(s[1]));
      const reach = ((stops.at(-1) ?? 100) / 100) * ry;
      const up = (cy / 100) * b.boxH;
      const down = (1 - cy / 100) * b.boxH;
      const hue = (p.match(/rgba?\((\d+), (\d+), (\d+)/) || []).slice(1, 4).join(',');
      const errs = [];
      if (reach > up) errs.push(`TOP −${Math.round(reach - up)}px`);
      if (reach > down) errs.push(`BOTTOM −${Math.round(reach - down)}px`);
      if (errs.length) { bad++; console.log(`  ✗ ${name}  ${hue}  at y=${cy}%  ${errs.join(', ')}`); }
    }
  }
  if (!bad) console.log('  every pool fades out inside its own box');
}

console.log(bad ? `\n${bad} clipped` : '\nclean at every width');
ws.close();
