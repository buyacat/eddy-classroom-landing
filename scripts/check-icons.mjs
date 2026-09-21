/*
 * Контракт об'єктів (.obj), перевірений замість того, щоб бути обіцяним у
 * коментарі — так само, як check-ambient.mjs робить із калюжами світла.
 *
 * Куплені об'єкти — це м'яка глина: широке світло згори зліва, без твердого
 * відблиску. Мальовані для сайту лежать із ними в одному рядку картки й
 * мають не вирізнятися. Три найновіші вирізнилися, і причина лишилася
 * записаною в коментарі offline.svg: «the bought objects put one hot streak
 * on the lit face». Це неправда, і саме з цього припущення виросли скляний
 * куб і скло на екранах ноутбука та планшета.
 *
 * ЧОМУ НЕ МІРЯЄТЬСЯ ГОТОВИЙ PNG. Перша версія рахувала на растрі частку
 * майже білих ненасичених пікселів поряд із помітно темнішими. На скляних
 * об'єктах вона спрацьовувала (3.8% і 8.4% проти 1.7% у паку), але разом із
 * ними ловила кремовий напис «3D» на грані куба й межу «світлий екран —
 * темна рамка», тобто рівно ту кремову деталь, якою користується сам пак.
 * Відрізнити на растрі блік від кремової деталі без здогадок не вийшло, а
 * перевірка, що червонить правильно намальоване, навчає її обходити.
 *
 * ЩО МІРЯЄТЬСЯ НАТОМІСТЬ. У SVG блік — це білий шар ПОВЕРХ тіла: елемент з
 * білою фарбою і явною непрозорістю (у тіла непрозорості немає, тож кремова
 * рамка планшета під підозру не потрапляє). Важить не сама непрозорість і не
 * сама площа — їх по черзі пробували, і кожна окремо ставила схвалені
 * об'єкти по той самий бік межі, що й скляні. Важить нерозсіяне світло:
 *
 *     glare = непрозорість × площа / (1 + розмиття)²
 *
 * Розмиття розганяє ту саму фарбу по площі, що росте як квадрат радіуса,
 * тому воно в знаменнику. За цією міркою набір ділиться чисто: скляні смуги
 * ноутбука й планшета дають 2237, 1159 і 731, відблиски на ребрах wifi —
 * 569, 556 і 517, а найяскравіше з того, що клієнт прийняв (ілюмінатор
 * ракети), — 198. Поріг 250 стоїть у цьому проміжку.
 *
 * Площа обведення — це периметр × товщина, а не площа фігури: білий обідок
 * колеса інакше рахувався суцільною плямою на 37% кадру і сам ламав поріг.
 *
 * ЧОГО ЦЕЙ ПОРІГ НЕ ЛОВИТЬ, І ЧОМУ ТАК ЛИШЕНО. Куб до правок ставив пляму
 * 0.95 при 3px на 0.49% площі — glare 19, добряче під порогом, хоч на
 * растрі він і давав 3.84% проти 1.66% у найгіршого купленого. Це інший
 * дефект: не велика тверда площина, а мала й дуже яскрава. Автоматично
 * відрізнити її від законної не вийшло, бо вирішує не геометрія, а те, на
 * чому вона лежить: у ракети біла пляма 0.7 взагалі без розмиття — і це
 * правильно, бо вона на склі ілюмінатора, який склом і мусить бути. Та
 * сама різкість на матовій грані куба — уже скло там, де його не просили.
 * Скрипт такого судження не винесе, тому він його й не вдає: яскраві тугі
 * шари він просто виписує в таблицю, щоб їх було видно оком.
 *
 * ВИСОТА міряється на PNG, бо там вона однозначна. `.obj` — квадратний бокс
 * 88px, тож об'єкт заввишки 183 з 256 малюється 63px проти 85px у сусіда й
 * читається дрібним, навіть якщо він на всю ширину. Саме на це показав
 * клієнт, і саме це число куплені тримають у межах 212–248.
 *
 *   npm run check:icons
 */
import sharp from 'sharp';
import { readdir, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const RASTER = 'public/assets/icons';
const SOURCE = 'src/assets/icon-src';

/* Куплені об'єкти — еталон, а не піддослідні: вони задають бюджет. */
const PACK = ['document', 'check', 'lightbulb', 'megaphone', 'clock', 'trophy'];

const MIN_OPACITY = 0.40;   /* слабший шар не блік, хай яка площа */
const MAX_GLARE = 250;      /* між ракетою (198) і ребрами wifi (517) */
const MIN_H = 205;          /* найнижчий куплений — тека, 212 */

const at=(t,n)=>{for(const a of t.matchAll(/([a-zA-Z-]+)="([^"]*)"/g))if(a[1]===n)return a[2];return null;};
/* Площа фарби. Обведення — це периметр×товщина, а не диск: тонкий білий
   обідок колеса рахувався як суцільна пляма на 37% кадру. */
function paintArea(body,name){
  const sw=+(at(body,'stroke-width')||0);
  const stroked = at(body,'fill')==='none' && sw>0;
  const n=s=>[...String(s).matchAll(/-?\d+(?:\.\d+)?/g)].map(Number);
  if(name==='circle'){const r=+at(body,'r'); return stroked?2*Math.PI*r*sw:Math.PI*r*r;}
  if(name==='ellipse'){const a=+at(body,'rx'),b=+at(body,'ry');
    return stroked?Math.PI*(3*(a+b)-Math.sqrt((3*a+b)*(a+3*b)))*sw:Math.PI*a*b;}
  if(name==='rect'){const w=+at(body,'width'),h=+at(body,'height');
    return stroked?2*(w+h)*sw:w*h;}
  const d=at(body,'d'); if(!d)return 0;
  const v=n(d), xs=v.filter((_,i)=>i%2===0), ys=v.filter((_,i)=>i%2===1);
  if(!xs.length)return 0;
  const w=Math.max(...xs)-Math.min(...xs), h=Math.max(...ys)-Math.min(...ys);
  return stroked ? Math.hypot(w,h)*sw*1.15 : w*h*0.5;
}
const isWhite=v=>{if(!v)return false;const m=/^#([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(v.trim());
  if(!m)return v.trim().toLowerCase()==='white';
  const h=m[1].length===3?[...m[1]].map(c=>c+c).join(''):m[1];
  return [0,2,4].map(i=>parseInt(h.slice(i,i+2),16)).every(c=>c>=240);};
function scan(svg){
  const blur=new Map();
  for(const f of svg.matchAll(/<filter\b[^>]*\bid="([^"]+)"[\s\S]*?<\/filter>/g)){
    const sd=/stdDeviation="([\d.]+)"/.exec(f[0]); blur.set(f[1],sd?parseFloat(sd[1]):0);}
  const defs=[...svg.matchAll(/<defs\b[\s\S]*?<\/defs>/g)].map(d=>[d.index,d.index+d[0].length]);
  const stack=[],out=[];
  for(const el of svg.matchAll(/<(\/?)([a-zA-Z]+)\b([^>]*?)(\/?)>/g)){
    const [,close,name,body,self]=el;
    if(defs.some(([a,b])=>el.index>=a&&el.index<b))continue;
    if(close){if(name==='g')stack.pop();continue;}
    const own={fill:at(body,'fill'),stroke:at(body,'stroke'),filter:at(body,'filter')};
    const up=k=>own[k]??stack.findLast(s=>s[k]!=null)?.[k]??null;
    if(name==='g'){if(!self)stack.push(own);continue;}
    if(!/^(path|rect|ellipse|circle|polygon)$/.test(name))continue;
    const paint=isWhite(up('fill'))?'fill':isWhite(up('stroke'))?'stroke':null;
    if(!paint)continue;
    const raw=at(body,'opacity')??at(body,`${paint}-opacity`); if(raw===null)continue;
    const op=parseFloat(raw); if(!(op<1))continue;
    const fid=/url\(#([^)]+)\)/.exec(up('filter')||'');
    const sd=fid?(blur.get(fid[1])??0):0;
    const a=paintArea(body,name);
    out.push({op,sd,a,glare:op*a/Math.pow(1+sd,2),line:svg.slice(0,el.index).split('\n').length});
  }
  return out;
}

/* Фарба і фільтр успадковуються, а непрозорість — ні: в offline.svg білий
   штрих стоїть на <g>, а stroke-opacity на кожному <path> усередині, тож
   scan() веде стек відкритих груп. Атрибути розбираються списком, бо `\b`
   у шаблонному рядку — це символ забою, а не межа слова: на цьому перша
   версія мовчки не знаходила жодного шару в жодному файлі. */
export function glass(svg) {
  return scan(svg).filter((o) => o.op > MIN_OPACITY && o.glare > MAX_GLARE);
}

/* Порогом не можна вирішити, чи поверхня МУСИТЬ бути склом. Ілюмінатор
   ракети пройшов на 198 радше випадково, ніж за судженням, а око з
   вологою рогівкою дає 877 і за тією ж логікою правильне. Тому файл може
   заявити намір сам — рядком `check-icons: glass-ok — причина`. Виняток
   видно у файлі, він іменований і його друкує звіт, тобто це не тиха
   дірка в бюджеті. */
const INTENT = /check-icons:\s*glass-ok\s*[—-]\s*(.+)/;
export const glassOk = (svg) => (INTENT.exec(svg) || [])[1]?.trim() ?? null;

/* Інлайнові <svg> у компонентах — сліпа пляма, якої тут спершу не було, і
   саме в ній жила найглянцевіша річ на сайті: око в Library3D.astro
   малюється розміткою, а не PNG, тож жодна перевірка файлів icon-src його
   не бачила. Колесо так само живе у WheelIcon.astro, бо воно крутиться. */
export function inlineSvgs(src) {
  return [...src.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((m) => m[0]);
}

async function drawnBox(file) {
  const { data, info } = await sharp(`${RASTER}/${file}`).ensureAlpha().raw()
    .toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: ch } = info;
  let minY = H, maxY = -1, minX = W, maxX = -1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (data[(y * W + x) * ch + 3] <= 24) continue;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
  }
  return { w: maxX - minX + 1, h: maxY - minY + 1 };
}

/* Які top-level PNG сторінка справді просить. wheel.png не просить ніхто:
   колесо крутиться, тож Platform малює <WheelIcon/> розміткою. Перевірка
   міряла мертвий рендер і мовчала про живу розмітку — звідси обидва
   доповнення нижче. Без dist/ ця колонка просто не показується. */
async function requestedPngs() {
  const { existsSync } = await import('node:fs');
  if (!existsSync('dist')) return null;
  const html = [];
  for (const dir of ['dist', 'dist/en']) {
    if (!existsSync(dir)) continue;
    for (const f of await readdir(dir)) {
      if (f.endsWith('.html')) html.push(await readFile(`${dir}/${f}`, 'utf8'));
    }
  }
  const out = new Set();
  for (const h of html) {
    for (const m of h.matchAll(/assets\/icons\/([a-z0-9-]+)\.png/g)) out.add(m[1]);
  }
  return out;
}

async function report() {
  const pngs = (await readdir(RASTER)).filter((f) => f.endsWith('.png'));
  const drawn = (await readdir(SOURCE)).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4));
  const live = await requestedPngs();

  console.log('── куплені (еталон висоти) ──');
  let shortest = 256;
  for (const n of PACK) {
    if (!pngs.includes(`${n}.png`)) continue;
    const { w, h } = await drawnBox(`${n}.png`);
    shortest = Math.min(shortest, h);
    console.log(`  · ${`${n}.png`.padEnd(15)}${String(w).padStart(3)}×${String(h).padStart(3)}`);
  }
  console.log(`  найнижчий куплений об'єкт ${shortest}`);

  console.log(`\n── мальовані (glare ≤ ${MAX_GLARE}; висота ≥ ${MIN_H}) ──`);
  let bad = 0;
  const tight = [];

  for (const n of drawn) {
    const svg = await readFile(`${SOURCE}/${n}.svg`, 'utf8');
    const errs = [];
    const notes = [];
    const rendered = pngs.includes(`${n}.png`);
    const onPage = live ? live.has(n) : rendered;
    const { w, h } = rendered ? await drawnBox(`${n}.png`) : { w: 0, h: 0 };

    /* Висоту має сенс міряти тільки там, де PNG справді вантажиться. */
    if (onPage && h < MIN_H) errs.push(`нижчий на ${MIN_H - h}px`);
    if (!onPage) notes.push(rendered ? 'PNG є, але сторінка його не просить' : 'немає PNG');

    const intent = glassOk(svg);
    for (const g of glass(svg)) {
      const line = `${g.op} при ${g.sd}px на ${(100 * g.a / 65536).toFixed(1)}%, рядок ${g.line}`;
      if (intent) tight.push({ n: `${n}.svg`, line, why: intent });
      else errs.push(`скло ${Math.round(g.glare)}: ${line}`);
    }
    tight.push(...scan(svg)
      .filter((o) => o.op > 0.55 && o.sd < 4 && !glass(svg).some((g) => g.line === o.line))
      .map((o) => ({ n: `${n}.svg`, line: `${o.op} при ${o.sd}px на ${(100 * o.a / 65536).toFixed(2)}%, рядок ${o.line}` })));

    if (errs.length) bad++;
    console.log(`  ${errs.length ? '✗' : '·'} ${`${n}.svg`.padEnd(15)}` +
      (rendered ? `${String(w).padStart(3)}×${String(h).padStart(3)}` : '       ') +
      (notes.length ? `  ${notes.join(', ')}` : '') +
      (errs.length ? `   ← ${errs.join('; ')}` : ''));
  }

  /* Розмітка компонентів: те, що малюється інлайном і живе на сторінці. */
  const comps = (await readdir('src/components')).filter((f) => f.endsWith('.astro'));
  const rows = [];
  for (const f of comps) {
    const src = await readFile(`src/components/${f}`, 'utf8');
    const intent = glassOk(src);
    for (const svg of inlineSvgs(src)) {
      for (const g of glass(svg)) {
        rows.push({ f, g, intent });
      }
      tight.push(...scan(svg)
        .filter((o) => o.op > 0.55 && o.sd < 4 && !glass(svg).some((x) => x.line === o.line))
        .map((o) => ({ n: f, line: `${o.op} при ${o.sd}px на ${(100 * o.a / 65536).toFixed(2)}%` })));
    }
  }
  if (rows.length) {
    console.log('\n── інлайнові <svg> у компонентах ──');
    for (const r of rows) {
      const ok = r.intent;
      if (!ok) bad++;
      console.log(`  ${ok ? '·' : '✗'} ${r.f.padEnd(20)}скло ${Math.round(r.g.glare)}: ` +
        `${r.g.op} при ${r.g.sd}px на ${(100 * r.g.a / 65536).toFixed(1)}%` +
        (ok ? `   ← навмисне: ${ok}` : ''));
    }
  }

  if (tight.length) {
    console.log('');
    console.log('── тугі яскраві шари: не помилка, але подивіться оком ──');
    for (const t of tight) {
      console.log(`  ${String(t.n).padEnd(20)}${t.line}` + (t.why ? `   ← навмисне: ${t.why}` : ''));
    }
    console.log('  біле на склі — задум (ілюмінатор ракети, рогівка ока); біле на глині — ні');
  }

  console.log(bad ? `\n${bad} поза бюджетом` : '\nвесь набір в одній стилістиці');
  return bad;
}

/* argv[1] порожній при `node -e` та при імпорті з іншого модуля —
   без цієї перевірки гард сам кидає, і файл стає неімпортовним */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit((await report()) ? 1 : 0);
}
