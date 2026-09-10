/*
 * Hero globe — a photoreal cut-away Earth built entirely in code, no GLB.
 *
 * Every pixel of surface here is generated at runtime: continents, ice caps,
 * cloud cover, relief and gloss all come out of one fractal noise field, so
 * the whole thing still costs nothing but the three.js runtime. It also means
 * the model takes light the way a real object does — PBR materials lit by a
 * generated sky, not flat fills.
 *
 * Gesture: drag right to take it apart, drag left to turn it (mouse only — on
 * touch there is no free spin), tap to latch it open. Let go and it springs
 * back together. Both jobs live on the same axis now because the cascade is
 * horizontal and pulling along it is the only reading that matches what the
 * eye sees; the sign is what tells them apart. The pull has two acts and the
 * first one is not optional — a planet that is turned away from its own cut
 * turns back to face it before anything is allowed to open.
 *
 * Scene graph, and the reason for it:
 *
 *   stack      shrinks + re-centres as the model opens, so the exploded state
 *    │         still fits the square panel
 *    └ holder  carries the explode offset — deliberately NOT rotated, so the
 *       │      layers always cascade the same way on screen whatever the yaw
 *       └ spin every holder gets the same yaw/pitch, so it still reads as one
 *              rotating body
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  BackSide,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  EquirectangularReflectionMapping,
  FrontSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  RepeatWrapping,
  RingGeometry,
  SRGBColorSpace,
  Scene,
  SphereGeometry,
  Texture,
  Vector3,
  WebGLRenderer
} from 'three';

import { withBase } from '../utils/url';
import {
  offsets,
  revealStage,
  smoothstep,
  spreadRow,
  stageDistances,
  stageProgress,
  stageWindows,
  totalTravel
} from './earth-layout';

export interface LayerSpec {
  /** label copy, already localised by the component */
  name: string;
  /** depth and state of matter — the part of the tag that does the teaching */
  meta?: string;
}

type Kind = 'crust' | 'mantle' | 'outerCore' | 'innerCore';

interface LayerDef {
  kind: Kind;
  /** inner radius (0 for the solid inner core) */
  rIn: number;
  /** outer radius */
  rOut: number;
}

/**
 * Radii as fractions of Earth's 6371 km, from PREM. Three of the four are the
 * real numbers: the core-mantle boundary sits at 2891 km (0.5462) and the
 * inner-core boundary at 5150 km (0.1917).
 *
 * The crust is the one lie, and it is unavoidable: continental crust is 35 km,
 * i.e. 0.9945, which at the size this panel renders would be a single pixel
 * and would vanish under antialiasing. It is thickened about fourfold to 0.978
 * so it can be seen at all — and the panel says so, in words a pupil reads,
 * rather than only in this comment.
 */
const LAYERS: LayerDef[] = [
  { kind: 'crust', rIn: 0.978, rOut: 1 },
  { kind: 'mantle', rIn: 0.546, rOut: 0.978 },
  { kind: 'outerCore', rIn: 0.192, rOut: 0.546 },
  { kind: 'innerCore', rIn: 0, rOut: 0.192 }
];

/** The wedge cut out of every shell so the cross-section is visible. */
const PHI_START = 0;
const PHI_LENGTH = Math.PI * 1.34;

/**
 * Screen-space direction the layers cascade along.
 *
 * Horizontal, not stacked. The panel is square, but the lesson strip takes its
 * bottom quarter, so the vertical budget is the scarce one — a column made the
 * layers fight each other for room and forced them all smaller. Laid out
 * across, the labels get their own row underneath, and the slight rise stops
 * it reading as a dead flat line.
 *
 * It points LEFT because that is the side the wedge is open on. Pulling the
 * shells out the other way slides them straight through the solid half of the
 * planet, which is exactly the thing an exploded view is supposed to show is
 * impossible. Out through the opening is the only direction that reads.
 *
 * The pair (this and BASE_YAW below) is what decides the handedness of the
 * whole drawing: turn the model so its cut faces the other way and this has
 * to follow it, or the shells start travelling backwards through rock.
 */
const AXIS = new Vector3(-1, 0.05, 0).normalize();

/**
 * Three-quarter view: far enough round that the sphere still reads as a
 * sphere, open enough that you look straight into the cross-section.
 *
 * The number is set by one hard constraint, not by taste: the direction the
 * shells travel has to lie INSIDE the mouth of the cut. The opening is 119°
 * wide, so its bisector may sit at most 59.4° off the travel axis; park it at
 * 45° and the cascade leaves through the hole with 14° to spare, while the
 * cross-section is still turned far enough toward the camera to be read.
 *
 * The pose this replaced had the bisector 28° off camera — prettier, more
 * face-on, and 2.4° short of legal: the contents came out through the rim
 * rather than through the opening, so every shell scraped through the solid
 * half of the crust on its way out. That was true of the original right-handed
 * pose too (mirrored, it had the same 2.4° deficit), which is why it is fixed
 * here rather than treated as fallout from turning the model round.
 *
 * A rotation, not a reflection, so the map is not printed backwards; the
 * meridians that face out simply move round with the opening.
 */
const BASE_YAW = 1.8221;
/** 23.44 degrees — the real axial tilt, so even the pose teaches something. */
const BASE_PITCH = 0.409;

/**
 * The cascade: how far each shell ends up from the one outside it, and — the
 * part that used to be wrong — WHEN each of them moves. Spacing and sequencing
 * both live in earth-layout, which has no three.js in it so the rule they keep
 * ("no shell is ever half inside a shell it is not currently coming out of")
 * can be checked on its own: npm run check.
 *
 * The CRUST stays put and the contents come out of it, not the other way
 * round — that is how you actually take a nested thing apart, and it means
 * nothing ever travels backwards through the solid half of the planet. Right
 * to left the row therefore reads outside-to-inside, the same order as the
 * numbers on the tags.
 */
const STAGE_D = stageDistances(LAYERS);
const STAGES = stageWindows(STAGE_D);
const TOTAL_TRAVEL = totalTravel(STAGE_D);

/**
 * Where the tags hang, just clear of the largest shell. They alternate between
 * two rows: four names this long will not fit across one panel side by side,
 * and staggering them buys each tag twice the width without shrinking the type
 * or pushing the spheres further apart.
 */
const TAG_DROP = 1.16;
const TAG_STAGGER = 0.8;

/**
 * How far off the cut-facing pose the model may sit and still be allowed to
 * come apart.
 *
 * There is exactly one angle at which an exploded view of this thing is
 * truthful: the wedge open toward the side the shells travel. At any other
 * angle they appear to be dragged out through the solid half of the planet,
 * which is the one thing the drawing must never show. Fading the free yaw out
 * while the layers were already moving used to hide that badly — the model
 * twisted and opened at the same time and neither read.
 *
 * So orientation is now a gate, not a blend, and it governs every way the
 * model can open, the lesson's own `open(true)` included: while it is turned
 * away, nothing separates. Idle rock alone (0.17 rad) is enough to hold the
 * gate shut, which is what gives the pull its first act — the planet swings
 * round to face you, and only then does it start to come apart.
 */
const ALIGN_FREE = 0.02;
const ALIGN_BLOCK = 0.1;

/** Clear air kept between two captions in the same row, in pixels. */
const TAG_PAD = 8;

/** Keep pulling this far past the end and the lesson starts on its own. */
const OVERPULL = 1.35;

/**
 * The demo: how far the model opens itself, once, to say that it opens.
 *
 * A caption under a static planet is a fact about the page. A planet that
 * breaks a little way apart and closes again is a fact about the planet, and
 * it is read before the caption is. Deliberately a quarter of the travel —
 * far enough that the mantle clears the crust and the gesture is unmistakable,
 * short enough that it is an invitation and not the show itself.
 *
 * The window has to cover act one as well: the model is rocking when this
 * fires, the alignment gate holds it shut until it has turned to face its own
 * cut (~0.5s), and only then does the pull count. Hence two seconds, not one.
 */
const DEMO_OPEN = 0.26;
const DEMO_MS = 2000;

const CAM_Z = 5.9;
/** How much the whole assembly shrinks at full explode, to stay in the panel. */
const OPEN_SHRINK = 0.5;
/**
 * Bias applied to the open state only. The cascade is not symmetric — the
 * crust at the top is three times the radius of the core at the bottom — so
 * re-centring on the middle of the travel still hangs it low. These pull the
 * open fan back to the optical centre of the panel.
 */
const OPEN_LIFT_Y = 0.12;
// nudged off the right edge, where the floating tool badges overlap the panel
const OPEN_LIFT_X = -0.06;

/* ------------------------------------------------------------------- moon */

/*
 * The Moon is here to give the planet a scale and a companion, and it has to
 * do it inside a square panel that already holds a globe of radius 1 and four
 * captions. So two of these three numbers are true and one is a compromise,
 * the same bargain the crust makes above.
 *
 * MOON_R is 0.27 in reality; 0.19 is as large as it can be here before it
 * starts colliding with the caption row on the way past. MOON_ORBIT is a lie
 * by two orders of magnitude — the real distance is 60 Earth radii, which at
 * this scale would put it four metres off the side of the screen — and the
 * orbit is drawn as a visible line precisely because a path you can see is
 * the only honest way to say "this is a diagram, not a photograph".
 *
 * The tilt is what makes the path READ as a path: seen exactly edge-on an
 * orbit is a straight line, and a moon sliding along a line looks like a bug,
 * not a body going round.
 *
 * 0.88 rad is not a guess. Tip the orbit less than asin(1 / MOON_ORBIT) = 0.78
 * and its highest point still falls inside the planet's silhouette, so the top
 * and bottom of the ellipse are swallowed and all that is left is two side
 * arcs — the loop stops being a loop. Past that angle the whole ellipse clears
 * the disc, the path is legible in a single glance, and the Moon never crosses
 * in front of the cross-section it would otherwise hide.
 */
const MOON_R = 0.19;
const MOON_ORBIT = 1.42;
/** Seconds per lap. A real month compressed to something a visitor will wait for. */
const MOON_PERIOD = 26;
const MOON_TILT_X = 0.88;
const MOON_TILT_Z = 0.09;

/*
 * Where the Moon waits out the exploded view.
 *
 * The orbit cannot survive the model coming apart: it is a fixed ring at
 * r = MOON_ORBIT while the shells fan out along their own axis, so past a
 * third of the travel the Moon flies straight through them — and through
 * half-transparent shells that reads as passing through the planet, the one
 * thing this drawing must never show.
 *
 * Deleting it outright works and is dull: the companion that gave the planet
 * its scale simply stops existing the moment the lesson starts. So it steps
 * out of the way instead — up and to the right of the crust, where the top
 * corner is empty once the layers have gone left and the captions have
 * dropped under them, and where the sun already is (2.6, 2.2, 3.8), so the
 * parked face is the lit one.
 *
 * Offsets are in the units the open stack is drawn at and ride its scale, so
 * "one crust-diameter up" stays one crust-diameter up when the lesson strip
 * shrinks the picture. Smaller than in orbit, because up there it is scenery
 * and not the subject.
 */
const MOON_PARK_DIR = new Vector3(0.22, 1, 0).normalize();
/**
 * Clear air between the crust's rim and the parked Moon. The park is measured
 * off the RIM, not off a fixed point in the panel: the crust halves in size as
 * the row opens, and a Moon pinned to panel coordinates either grazes it early
 * in the pull or floats off into the top edge late in it. Hung off the rim it
 * keeps the same gap the whole way and simply drifts in as the planet shrinks.
 *
 * Only 12 degrees off vertical, though the corner invites more: the floating
 * tool badges hang over the right edge of the panel from about 5% to 18% of
 * its height, and a Moon parked further right would drift under the rocket.
 */
const MOON_PARK_CLEAR = 0.22;
const MOON_PARK_SCALE = 0.66;
/** rad/s — slow enough to read as a body, not as a spinning prop. */
const MOON_PARK_SPIN = 0.014;

/* ------------------------------------------------------------------ noise */

/** Integer hash — cheap enough to run a few million times while the page loads. */
function hash3(i: number, j: number, k: number): number {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in 3D — sampled on the sphere itself, so it never seams. */
function noise3(x: number, y: number, z: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);

  const c000 = hash3(xi, yi, zi), c100 = hash3(xi + 1, yi, zi);
  const c010 = hash3(xi, yi + 1, zi), c110 = hash3(xi + 1, yi + 1, zi);
  const c001 = hash3(xi, yi, zi + 1), c101 = hash3(xi + 1, yi, zi + 1);
  const c011 = hash3(xi, yi + 1, zi + 1), c111 = hash3(xi + 1, yi + 1, zi + 1);

  const x00 = c000 + (c100 - c000) * u;
  const x10 = c010 + (c110 - c010) * u;
  const x01 = c001 + (c101 - c001) * u;
  const x11 = c011 + (c111 - c011) * u;

  const y0 = x00 + (x10 - x00) * v;
  const y1 = x01 + (x11 - x01) * v;
  return y0 + (y1 - y0) * w;
}

function fbm(x: number, y: number, z: number, octaves: number): number {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise3(x * freq, y * freq, z * freq) * amp;
    norm += amp;
    freq *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d') as CanvasRenderingContext2D];
}

interface EarthMaps {
  map: Texture;
  bumpMap: Texture;
  roughnessMap: Texture;
  cloudAlpha: Texture;
}

/**
 * One pass over an equirectangular grid produces everything the surface needs.
 * The height field decides land against sea; colour, relief and gloss all fall
 * out of the same number, which is why the coastlines line up across all three.
 */
/*
 * The surface is NASA's Blue Marble (public domain), not an invented planet.
 * A procedural world looked convincing and was the wrong call: this product
 * sells geography lessons, and a photoreal planet that is not Earth is a map
 * of the world that is not the world. Everything else here is still generated.
 *
 * Only two files are fetched — colour and cloud cover. Relief and gloss are
 * derived from the colour map in one pass, because Blue Marble's oceans are
 * the only dark, blue-dominant pixels in it, so water separates cleanly.
 */
const TEX_SURFACE = withBase('/assets/textures/earth-surface.webp');
const TEX_CLOUDS = withBase('/assets/textures/earth-clouds.webp');

/** Slides which meridians land in the kept wedge — tuned so Europe faces out. */
const TEX_OFFSET = 0.02;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

async function loadEarthMaps(anisotropy: number): Promise<EarthMaps> {
  const [surface, clouds] = await Promise.all([
    loadImage(TEX_SURFACE),
    loadImage(TEX_CLOUDS)
  ]);

  const W = surface.naturalWidth;
  const H = surface.naturalHeight;
  const [colorCanvas, colorCtx] = canvas2d(W, H);
  colorCtx.drawImage(surface, 0, 0);
  const src = colorCtx.getImageData(0, 0, W, H).data;

  const [roughCanvas, roughCtx] = canvas2d(W, H);
  const [bumpCanvas, bumpCtx] = canvas2d(W, H);
  const rough = roughCtx.createImageData(W, H);
  const bump = bumpCtx.createImageData(W, H);

  for (let i = 0; i < src.length; i += 4) {
    const r = src[i], g = src[i + 1], b = src[i + 2];
    const water = b > r + 12 && b > g + 6 && r + g + b < 300;
    const lum = r * 0.299 + g * 0.587 + b * 0.114;

    // water is the glossy part; land is matte
    const ro = water ? 66 : 208;
    rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = ro;
    rough.data[i + 3] = 255;

    // relief from brightness on land only — the sea floor must stay flat
    const relief = water ? 96 : 108 + lum * 0.4;
    bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = relief;
    bump.data[i + 3] = 255;
  }
  roughCtx.putImageData(rough, 0, 0);
  bumpCtx.putImageData(bump, 0, 0);

  // three lays a full 0..1 U across the partial sphere, so the maps have to be
  // squeezed into the same fraction of longitude the wedge actually keeps
  const span = PHI_LENGTH / (Math.PI * 2);
  const fit = <T extends Texture>(t: T): T => {
    t.wrapS = RepeatWrapping;
    t.repeat.x = span;
    t.offset.x = TEX_OFFSET;
    t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };

  const map = fit(new CanvasTexture(colorCanvas));
  map.colorSpace = SRGBColorSpace;

  const cloudAlpha = fit(new Texture(clouds));

  return {
    map,
    bumpMap: fit(new CanvasTexture(bumpCanvas)),
    roughnessMap: fit(new CanvasTexture(roughCanvas)),
    cloudAlpha
  };
}

/**
 * Sedimentary bedding for the crust's cut face. RingGeometry lays its UVs
 * across the ring's bounding box, so bands drawn concentrically land as real
 * bedding planes on the cross-section. Greyscale, so the material colour tints
 * it. Only the crust gets this — bedding is a sedimentary feature, and drawing
 * it on mantle rock or liquid iron would be a lie a geologist spots at once.
 */
function buildStrata(): CanvasTexture {
  const S = 512;
  const [c, ctx] = canvas2d(S, S);
  const img = ctx.createImageData(S, S);
  const mid = S / 2;

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const dx = (x - mid) / mid;
      const dy = (y - mid) / mid;
      const r = Math.sqrt(dx * dx + dy * dy);
      const a = Math.atan2(dy, dx);

      // turbulence first, so the beds buckle instead of sitting as clean rings.
      // Frequency stays low on purpose: fine rings alias into a moire pattern
      // the moment the model turns.
      const warp = (fbm(dx * 3.6, dy * 3.6, 3.7, 4) - 0.5) * 0.26;
      const bands = 0.5 + 0.5 * Math.sin((r + warp) * 27);
      const grain = fbm(dx * 22, dy * 22, Math.cos(a) * 3, 4);

      // darker toward the rim, so the face reads as depth rather than a decal
      const shade = 1 - Math.min(1, r) * 0.16;
      const v = (142 + bands * 38 + (grain - 0.5) * 34) * shade;

      const i = (y * S + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/** Coarse mineral grain — peridotite, not sediment, so no bedding planes. */
function buildGrain(): CanvasTexture {
  const S = 256;
  const [c, ctx] = canvas2d(S, S);
  const img = ctx.createImageData(S, S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const n = fbm((x / S) * 14, (y / S) * 14, 4.1, 4);
      const i = (y * S + x) * 4;
      const v = 150 + (n - 0.5) * 78;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.max(0, Math.min(255, v));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(c);
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * The Moon's face, generated the same way the Earth's is — no second texture
 * file for an object 200px wide.
 *
 * Two passes, because the Moon really is two things: the pale, saturated
 * highlands from the fractal field, and the maria, the dark basalt seas that
 * are the part everyone can actually name. The craters go on last, each drawn
 * as a dark floor under a lit rim, and each stretched horizontally by
 * 1/cos(latitude) so it comes back out round once the equirectangular map is
 * wrapped onto a sphere — without that the poles wear ellipses.
 */
function buildMoonMaps(): { color: CanvasTexture; bump: CanvasTexture } {
  const W = 512, H = 256;
  const [c, ctx] = canvas2d(W, H);
  const img = ctx.createImageData(W, H);

  for (let y = 0; y < H; y++) {
    const lat = (y / H - 0.5) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      // sampled on the sphere itself, so the seam at lon = 0 closes
      const sx = Math.cos(lat) * Math.cos(lon), sy = Math.sin(lat), sz = Math.cos(lat) * Math.sin(lon);
      const n = fbm(sx * 3.1 + 11, sy * 3.1 + 5, sz * 3.1 + 2, 5);
      const sea = fbm(sx * 1.35 + 41, sy * 1.35 + 17, sz * 1.35 + 29, 3);
      // maria: the low, dark half of the noise field, with a soft shoreline
      const mare = smoothstep(0.52, 0.61, sea);
      const v = (150 + (n - 0.5) * 46) * (1 - 0.36 * mare);
      const i = (y * W + x) * 4;
      img.data[i] = Math.max(0, Math.min(255, v * 1.02));
      img.data[i + 1] = Math.max(0, Math.min(255, v));
      img.data[i + 2] = Math.max(0, Math.min(255, v * 0.97));
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  // deterministic craters — a fixed seed, so the Moon is the same one twice
  let seed = 20240712;
  const rnd = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
    return ((seed >>> 8) & 0xffffff) / 0xffffff;
  };
  for (let k = 0; k < 90; k++) {
    const cx = rnd() * W;
    const cy = 20 + rnd() * (H - 40);
    const lat = (cy / H - 0.5) * Math.PI;
    const r = 2 + rnd() * rnd() * 15;
    const stretch = 1 / Math.max(0.25, Math.cos(lat));
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(stretch, 1);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(78, 76, 74, 0.30)';
    ctx.fill();
    // rim, lit from the same side as the scene's sun
    ctx.beginPath();
    ctx.arc(-r * 0.16, -r * 0.16, r * 0.92, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(236, 233, 228, 0.42)';
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  const color = new CanvasTexture(c);
  color.colorSpace = SRGBColorSpace;
  // the same canvas serves as relief: the craters are already dark-on-light
  const bump = new CanvasTexture(c);
  return { color, bump };
}

/**
 * A generated sky in place of an HDRI: bright above, dark below, one warm sun
 * spot. It is what gives the metal core its highlight and the oceans their
 * sheen without shipping an environment file.
 */
function buildEnvironment(): CanvasTexture {
  const [c, ctx] = canvas2d(512, 256);
  const sky = ctx.createLinearGradient(0, 0, 0, 256);
  sky.addColorStop(0, '#eaf1fb');
  sky.addColorStop(0.45, '#8fa4bd');
  sky.addColorStop(0.62, '#3d4654');
  sky.addColorStop(1, '#14171d');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 512, 256);

  const glow = ctx.createRadialGradient(360, 60, 4, 360, 60, 110);
  glow.addColorStop(0, '#ffffff');
  glow.addColorStop(0.35, 'rgba(255,244,222,.7)');
  glow.addColorStop(1, 'rgba(255,244,222,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, 512, 256);

  const tex = new CanvasTexture(c);
  tex.mapping = EquirectangularReflectionMapping;
  tex.colorSpace = SRGBColorSpace;
  return tex;
}

/* --------------------------------------------------------------- geometry */

/**
 * A half-annulus that closes one side of the wedge cut.
 *
 * three's SphereGeometry places the phi boundary curve in the plane spanned by
 * d = (-cos phi, 0, sin phi) and +Y. RingGeometry builds its arc in XY, so we
 * build the x >= 0 half and re-base it onto (d, y, d x y).
 */
function cutFace(rIn: number, rOut: number, phi: number, material: MeshStandardMaterial): Mesh {
  const geo = new RingGeometry(Math.max(rIn, 0.0001), rOut, 96, 1, -Math.PI / 2, Math.PI);
  const d = new Vector3(-Math.cos(phi), 0, Math.sin(phi));
  const up = new Vector3(0, 1, 0);
  const z = new Vector3().crossVectors(d, up);
  const mesh = new Mesh(geo, material);
  mesh.matrixAutoUpdate = false;
  mesh.matrix.makeBasis(d, up, z);
  return mesh;
}

interface Recipe {
  /** the outward-facing skin */
  shell: MeshStandardMaterial;
  /** the flat faces of the wedge and the hollow inside */
  cut: MeshStandardMaterial;
}

/** Rock at the top, iron at the bottom — the deeper the layer, the hotter it glows. */
function buildRecipes(
  maps: EarthMaps,
  strata: CanvasTexture,
  grain: CanvasTexture
): Record<Kind, Recipe> {
  /**
   * Cut faces, with the texture that belongs to the material. Bedding planes
   * are a sedimentary feature of the upper crust; drawing them on molten iron
   * is the kind of detail a geologist spots instantly, so only the crust gets
   * strata, the mantle gets mineral grain, and the two cores get neither.
   */
  const face = (texture: CanvasTexture | null, o: Record<string, unknown>) =>
    new MeshStandardMaterial({
      map: texture,
      bumpMap: texture,
      bumpScale: texture === strata ? 0.02 : 0.01,
      side: DoubleSide,
      ...o
    });

  return {
    crust: {
      shell: new MeshStandardMaterial({
        map: maps.map,
        bumpMap: maps.bumpMap,
        bumpScale: 0.015,
        roughnessMap: maps.roughnessMap,
        roughness: 1,
        metalness: 0.04,
        envMapIntensity: 1.15,
        side: DoubleSide
      }),
      cut: face(strata, {
        color: new Color('#7d6156'),
        roughness: 0.95,
        metalness: 0.05
      })
    },
    mantle: {
      // The mantle is SOLID silicate rock — only ~1-2% partial melt, and only
      // in the asthenosphere. It must not glow, or the model teaches the
      // "sea of fire under the crust" myth the lesson exists to correct.
      shell: new MeshStandardMaterial({
        color: new Color('#c2662c'),
        roughness: 0.88,
        metalness: 0.05,
        side: DoubleSide
      }),
      cut: face(grain, {
        color: new Color('#d9814a'),
        roughness: 0.8,
        metalness: 0.05
      })
    },
    outerCore: {
      // liquid iron-nickel: glossy, so the state of matter reads off the
      // surface rather than off the label
      shell: new MeshStandardMaterial({
        color: new Color('#e2670f'),
        roughness: 0.25,
        metalness: 0.55,
        emissive: new Color('#ff5a00'),
        emissiveIntensity: 0.45,
        side: DoubleSide
      }),
      cut: face(null, {
        color: new Color('#ff8a1c'),
        roughness: 0.22,
        metalness: 0.5,
        emissive: new Color('#ff6c05'),
        emissiveIntensity: 0.58
      })
    },
    innerCore: {
      // solid iron-nickel, held solid by 330-360 GPa. Matte against the
      // liquid layer above it, and pale straw rather than gold — "the core is
      // gold" is its own persistent myth.
      shell: new MeshStandardMaterial({
        color: new Color('#ffe0a0'),
        roughness: 0.55,
        metalness: 0.35,
        emissive: new Color('#ffa825'),
        emissiveIntensity: 1.05,
        side: DoubleSide
      }),
      cut: face(null, {
        color: new Color('#ffeab8'),
        roughness: 0.52,
        metalness: 0.32,
        emissive: new Color('#ffb845'),
        emissiveIntensity: 1.15
      })
    }
  };
}

interface Layer {
  name: string;
  holder: Group;
  spin: Group;
  anchor: Object3D;
  el: HTMLElement;
}

function buildLayer(
  def: LayerDef,
  index: number,
  recipe: Recipe,
  maps: EarthMaps
): Omit<Layer, 'name' | 'el'> {
  const holder = new Group();
  const spin = new Group();
  spin.rotation.x = BASE_PITCH;
  holder.add(spin);

  spin.add(new Mesh(
    new SphereGeometry(def.rOut, 128, 80, PHI_START, PHI_LENGTH),
    recipe.shell
  ));

  if (def.kind === 'crust') {
    // weather sits just off the surface and travels with the crust. 1.0019 is
    // 12 km — the top of the troposphere, where weather actually is.
    spin.add(new Mesh(
      new SphereGeometry(def.rOut * 1.0019, 96, 60, PHI_START, PHI_LENGTH),
      new MeshStandardMaterial({
        color: new Color('#ffffff'),
        alphaMap: maps.cloudAlpha,
        transparent: true,
        opacity: 0.95,
        depthWrite: false,
        roughness: 1,
        metalness: 0,
        // front faces only: a double-sided cloud shell draws its own far side
        // as a white fringe all round the silhouette
        side: FrontSide
      })
    ));
  }

  if (def.rIn > 0) {
    const inner = recipe.cut.clone();
    inner.side = BackSide;
    inner.map = null;
    inner.bumpMap = null;
    inner.color.multiplyScalar(0.66);
    spin.add(new Mesh(
      new SphereGeometry(def.rIn, 96, 60, PHI_START, PHI_LENGTH),
      inner
    ));
  }

  for (const phi of [PHI_START, PHI_START + PHI_LENGTH]) {
    spin.add(cutFace(def.rIn, def.rOut, phi, recipe.cut));
  }

  // The tag rides the holder, not the spinner, so it stays put while the
  // model turns — a label that orbits with the mesh is unreadable.
  // Every tag hangs at the same depth below its layer, so the four of them
  // line up as a caption row instead of scattering with the radii. Anchored by
  // its own top-centre (see the CSS transform), so a name never covers the
  // thing it names.
  const anchor = new Object3D();
  anchor.position.set(0, -(TAG_DROP + (index % 2) * TAG_STAGGER), 0);
  holder.add(anchor);

  return { holder, spin, anchor };
}

/* ------------------------------------------------------------------ mount */

export interface GlobeHandle {
  destroy(): void;
  /** Latch the model apart (or back together), overriding the idle state. */
  open(apart: boolean): void;
  /** Brief green pulse on one layer — how the model answers a question. */
  flash(index: number, ms?: number): void;
  /** The tag element for a layer, so a lesson can turn it into an option. */
  tag(index: number): HTMLElement | undefined;
  /** Fires once, the first time the visitor pulls the model fully apart. */
  onOpen(cb: () => void): void;
  /** Fires when the visitor keeps pulling past the end of the travel. */
  onOverpull(cb: () => void): void;
  /** Lift and shrink, to hand the bottom of the panel to the lesson strip. */
  compact(on: boolean): void;
  /** Open a little way and close again, once, to show that it opens at all. */
  demo(): void;
}

export async function mountGlobe(
  host: HTMLElement,
  canvas: HTMLCanvasElement,
  labelHost: HTMLElement,
  specs: LayerSpec[]
): Promise<GlobeHandle> {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.96;

  const scene = new Scene();
  const env = buildEnvironment();
  scene.environment = env;

  const camera = new PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0, 0, CAM_Z);
  camera.lookAt(0, 0, 0);

  // one hard sun, a cold bounce from the other side, and the sky for the rest
  const sun = new DirectionalLight(0xfff3e2, 3.4);
  sun.position.set(2.6, 2.2, 3.8);
  scene.add(sun);
  const bounce = new DirectionalLight(0x7f9dd6, 0.85);
  bounce.position.set(-3.2, -1, 1.4);
  scene.add(bounce);
  scene.add(new AmbientLight(0x8ea4c4, 0.28));

  const maps = await loadEarthMaps(renderer.capabilities.getMaxAnisotropy());
  const strata = buildStrata();
  const grain = buildGrain();
  const recipes = buildRecipes(maps, strata, grain);

  const stack = new Group();
  scene.add(stack);

  /** Saved so a flash can hand every material back exactly as it was. */
  const restore = new Map<MeshStandardMaterial, [Color, number]>();
  const remember = (m: MeshStandardMaterial) => {
    if (!restore.has(m)) restore.set(m, [m.emissive.clone(), m.emissiveIntensity]);
  };

  const layers: Layer[] = LAYERS.map((def, i) => {
    const built = buildLayer(def, i, recipes[def.kind], maps);
    stack.add(built.holder);

    const name = specs[i]?.name ?? '';
    const el = document.createElement('span');
    el.className = 'globe-tag';
    el.innerHTML =
      '<i class="globe-tag-dot">' + (i + 1) + '</i><span><b></b><em></em></span>';
    (el.querySelector('b') as HTMLElement).textContent = name;
    (el.querySelector('em') as HTMLElement).textContent = specs[i]?.meta ?? '';
    labelHost.appendChild(el);

    return { ...built, name, el };
  });

  /*
   * The Moon system hangs off the SCENE, not off the model.
   *
   * It cannot ride the spinner: the Earth turning on its axis does not carry
   * the Moon round with it, and one drag of the globe would whip the Moon
   * through a month. It cannot ride the stack either, and that one was tried:
   * the stack shrinks by half and slides sideways as the model comes apart, so
   * an orbit parented to it shrank and slid too — the ring sagged out of the
   * panel mid-fade and read as broken rather than as leaving.
   *
   * Parented to the scene it is a fixed frame instead: the path holds its
   * size and its centre, and the planet opens INSIDE it. The one transform it
   * still follows is `compact`, because that is the panel making room for the
   * lesson strip — the whole picture moves, so the orbit moves with it.
   *
   * The path is drawn as a real ring rather than implied: with depth testing
   * on, the planet occludes the far half of it, which is the whole lesson —
   * the line goes behind, so the Moon going behind reads as depth and not as
   * the Moon being deleted for a while.
   */
  const moonMaps = buildMoonMaps();
  const moonSystem = new Group();
  moonSystem.rotation.x = MOON_TILT_X;
  moonSystem.rotation.z = MOON_TILT_Z;
  scene.add(moonSystem);

  const orbitMat = new MeshBasicMaterial({
    color: new Color('#c3d4ff'),
    transparent: true,
    opacity: 0.3,
    side: DoubleSide,
    depthWrite: false
  });
  const orbitRing = new Mesh(new RingGeometry(MOON_ORBIT - 0.006, MOON_ORBIT + 0.006, 192), orbitMat);
  orbitRing.rotation.x = -Math.PI / 2;
  moonSystem.add(orbitRing);

  /* The arm turns; the Moon does not turn inside it. That is tidal locking,
     and it comes free: a body carried round on a rotating arm keeps the same
     face pointed at the centre unless you spin it the other way. */
  const moonArm = new Group();
  moonSystem.add(moonArm);
  const moonMat = new MeshStandardMaterial({
    map: moonMaps.color,
    bumpMap: moonMaps.bump,
    bumpScale: 0.006,
    roughness: 0.98,
    metalness: 0,
    transparent: true
  });
  const moonMesh = new Mesh(new SphereGeometry(MOON_R, 64, 40), moonMat);
  moonMesh.position.set(MOON_ORBIT, 0, 0);
  moonArm.add(moonMesh);

  /*
   * The same Moon, parked — a second mesh rather than the first one flown to
   * the corner. Flying it there would send it across the row it is being
   * moved out of, and from half the phases it would cross in front of the
   * cross-section on the way: the very shot this is meant to prevent. Two
   * meshes cross-fade with a gap between them instead, so at no frame are
   * there two Moons, and at no frame does one travel through rock.
   *
   * Its own material (and its own, coarser sphere — it is drawn at two thirds
   * the size) so the two opacities are independent. The maps are shared.
   */
  const parkMat = moonMat.clone();
  parkMat.opacity = 0;
  const parkMoon = new Mesh(new SphereGeometry(MOON_R, 48, 32), parkMat);
  parkMoon.visible = false;
  scene.add(parkMoon);

  /** Phase of the orbit, in turns. Starts front-left, where it is not behind. */
  let moonPhase = 0.62;

  // ---- state ----
  let yaw = 0;             // extra yaw from dragging, and from turning back
  let yawTarget = 0;
  let rockGain = 1;        // idle life, damped out the moment a hand is on it
  let explode = 0;         // eased
  let explodeTarget = 0;
  let dragging = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let yawAtStart = 0;
  let touched = false;
  let pinned = false;      // set by a tap, so it opens without a drag
  let demoed = false;      // the one-time invitation has been spent
  let width = 0;
  let height = 0;
  let t = 0;

  /*
   * One drag does one job. Which job is settled once, as soon as the hand
   * commits to a direction, and then held for the rest of the gesture — a pull
   * that wanders back the other way used to start spinning the model half way
   * through, and a spin that drifted right used to start prising it open.
   */
  type Mode = 'idle' | 'turn' | 'open';
  let mode: Mode = 'idle';

  // A finger gets no free spin: the leftward half of the axis is how the page
  // itself is swiped, and taking it would fight the browser for the gesture.
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  /*
   * Anything shorter than this is a tap, anything longer commits to a drag —
   * one number for both, so there is no band in between where a gesture is
   * neither and does nothing. A finger wanders further than a mouse, and on
   * touch the tap is the ONLY way to close a latched-open model, so the slop
   * there has to be generous enough to actually catch one.
   */
  const TAP_SLOP = coarse ? 12 : 7;

  let openCb: (() => void) | null = null;
  let overpullCb: (() => void) | null = null;
  let announced = false;
  let overpulled = false;
  // the lesson strip takes the bottom of the panel; the model gets out of its
  // way rather than being drawn underneath it
  let compact = 0;
  let compactTarget = 0;

  const worldPos = new Vector3();
  const recentre = new Vector3();

  /*
   * Tag widths, cached. They are re-measured rather than computed because the
   * lesson appends a vote count and a bar to each tag after mount, and because
   * the copy is translated. Reading them every frame would thrash layout
   * against the transforms written in the same loop, so it happens rarely.
   */
  const tagWidth = new Array<number>(LAYERS.length).fill(0);
  let measureIn = 0;

  /*
   * Where each caption wants to sit, and the two rows they are resolved in.
   * Reused every frame rather than rebuilt, because this runs at 60Hz.
   */
  const place = LAYERS.map(() => ({ x: 0, y: 0, width: 0 }));
  const rows: (typeof place)[] = [[], []];

  function resize() {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    width = rect.width;
    height = rect.height;
    renderer.setSize(width, height, false);
    measureIn = 0;
    camera.aspect = width / height;
    // hold the on-screen size steady when the panel gets narrow
    camera.position.z = CAM_Z * Math.max(1, 1 + (620 - Math.min(width, 620)) / 1500);
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // ---- input ----
  function onDown(e: PointerEvent) {
    if (dragging) return;
    // a right- or middle-click is not a grab; without this it took capture and
    // then latched the model open on release, under the context menu
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    dragging = true;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    yawAtStart = yawTarget;
    mode = 'idle';
    overpulled = false;
    canvas.setPointerCapture(pointerId);
    host.classList.add('is-grabbed');
    if (!touched) {
      touched = true;
      host.classList.add('is-touched');
    }
  }

  function onMove(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (mode === 'idle') {
      if (Math.hypot(dx, dy) < TAP_SLOP) return;
      /*
       * Rightwards opens it, on every pointer: the shells come out to the
       * left, through the cut, and the hand draws the crust off them the way
       * you would draw a lid.
       *
       * That claims the axis the free spin used to have all of, so the spin
       * keeps the other half of it — leftwards, on a mouse, and only while the
       * thing is still a globe: once it is coming apart the angle is no longer
       * the visitor's to choose.
       */
      mode = !coarse && dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.4 && explode < 0.08
        ? 'turn'
        : 'open';
      // taking hold of it to spin it means you want the globe back
      if (mode === 'turn') {
        pinned = false;
        explodeTarget = 0;
      }
    }

    if (mode === 'turn') {
      yawTarget = yawAtStart + (dx / Math.max(width, 1)) * Math.PI * 0.85;
      return;
    }

    // Act one: bring it round to face its own cut. The gate in the frame loop
    // is what actually holds the layers shut until it has; all this does is
    // ask for the pose. Act two: pull it apart.
    yawTarget = 0;
    // one axis, one sign: dragging back to the left folds it up again rather
    // than opening it a second time, which is what an absolute value did
    const pull = Math.max(0, dx) / Math.max(width * 0.34, 1);
    explodeTarget = Math.max(pinned ? 1 : 0, Math.min(1, pull));

    // keep pulling once it is all the way open, and the lesson takes over
    if (pull > OVERPULL && !overpulled) {
      overpulled = true;
      overpullCb?.();
    }
  }

  function release() {
    dragging = false;
    pointerId = -1;
    mode = 'idle';
    host.classList.remove('is-grabbed');
  }

  function onUp(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    // a tap, not a drag: latch it open (or closed) so it works without a mouse
    if (mode === 'idle' && Math.hypot(e.clientX - startX, e.clientY - startY) < TAP_SLOP) {
      pinned = !pinned;
      if (pinned) yawTarget = 0;
    }
    if (mode !== 'turn') explodeTarget = pinned ? 1 : 0;
    release();
  }

  /*
   * A cancel is the browser saying this gesture did not happen — a second
   * finger arrived and it became a pinch, or the capture was taken away. It
   * must not commit anything: routing it into onUp latched the model open off
   * a gesture the visitor had abandoned, because at that point the finger has
   * not travelled far enough to be anything but a tap.
   */
  function onCancel(e: PointerEvent) {
    if (!dragging || e.pointerId !== pointerId) return;
    explodeTarget = pinned ? 1 : 0;
    release();
  }

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onCancel);
  canvas.addEventListener('lostpointercapture', onCancel);

  // ---- loop ----
  let raf = 0;
  let last = performance.now();
  let visible = true;
  let shown = false;

  const io = new IntersectionObserver(
    (entries) => { visible = entries[0]?.isIntersecting ?? true; },
    { threshold: 0 }
  );
  io.observe(host);

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!visible) return;
    t += dt;

    /*
     * Idle life is a slow rock, not a full spin. It is the model's own
     * movement and it has no business fighting the visitor's, so the moment a
     * hand is on it — or the lesson opens it — the rock damps away instead of
     * being added on top of the drag.
     */
    rockGain += ((dragging || explodeTarget > 0.01 ? 0 : 1) - rockGain) * Math.min(1, dt * 4);
    yaw += (yawTarget - yaw) * Math.min(1, dt * 9);
    const offset = yaw + Math.sin(t * 0.42) * 0.17 * rockGain;
    const heading = BASE_YAW + offset;

    /*
     * Act one of every opening, however it was asked for. While the planet is
     * turned away from its own cut this is 0 and nothing separates; it only
     * lets go once the model is facing the way the layers travel. That is why
     * a pull on a rocking globe turns it first and opens it second, and why
     * you cannot spin a half-open model into a lie.
     */
    const facing = smoothstep(ALIGN_BLOCK, ALIGN_FREE, Math.abs(offset));

    explode += (explodeTarget * facing - explode) * Math.min(1, dt * (dragging ? 11 : 6));

    /*
     * One extraction at a time, outside-in: the whole contents come out of the
     * crust as one rigid group, then the cores out of the mantle, then the
     * inner core out of the outer one. Nothing moves relative to anything it
     * is still inside, so no two shells are ever seen half through each other.
     */
    const progress = stageProgress(STAGES, explode);
    const pos = offsets(STAGES, progress);
    const spread = pos[pos.length - 1];
    /** How open the thing actually is — the row's own length, not the gesture. */
    const openness = spread / TOTAL_TRAVEL;

    compact += (compactTarget - compact) * Math.min(1, dt * 5);

    const scale = (1 - OPEN_SHRINK * openness) * (1 - 0.16 * compact);
    stack.scale.setScalar(scale);
    recentre.copy(AXIS).multiplyScalar(-(spread / 2) * scale);
    recentre.x += OPEN_LIFT_X * openness;
    recentre.y += OPEN_LIFT_Y * openness + 0.42 * compact;
    stack.position.copy(recentre);

    /*
     * The Moon keeps its own clock — it is not driven by the drag, the rock or
     * the explode, because none of those are time passing.
     *
     * Opening the model takes it out of orbit — see MOON_PARK_* above for why
     * the ring cannot stay once the shells fan out through it. The orbit and
     * the body on it fade out early, well before the crust reaches the radius
     * the Moon travels on, and the group is switched off once there is nothing
     * left to see: a fully transparent mesh still sorts and still costs a draw.
     *
     * Then the parked one fades in up-right of the crust, on a gap after the
     * first has gone. Both halves run off `openness`, so closing the model
     * plays the whole handover backwards for free.
     */
    moonPhase = (moonPhase + dt / MOON_PERIOD) % 1;
    moonArm.rotation.y = moonPhase * Math.PI * 2;
    /* Gone by 0.14 of the row: measured, the crust first eats into the orbit
       at openness 0.17 — from there the Moon is inside it, not behind it. */
    const leaving = smoothstep(0.02, 0.14, openness);
    moonSystem.scale.setScalar(1 - 0.16 * compact);
    moonSystem.position.set(0, 0.42 * compact, 0);
    orbitMat.opacity = 0.3 * (1 - leaving);
    moonMat.opacity = 1 - leaving;
    moonSystem.visible = leaving < 0.999;

    /*
     * The park rides the crust, not the panel. The crust is the shell that
     * stays put while the rest of the row leaves it, so `recentre` IS the
     * crust's centre and `scale` IS its radius — the Moon can be hung off the
     * rim in one line, and stays the same distance off it at any openness.
     *
     * It fades in as the orbiting one finishes leaving, not later: a window
     * that waits for the row to finish opening leaves a stretch with no Moon
     * anywhere, and the invitation demo — which opens a quarter of the way and
     * closes again — would spend the whole of itself inside that stretch.
     */
    const parked = smoothstep(0.13, 0.27, openness);
    parkMat.opacity = parked;
    parkMoon.visible = parked > 0.002;
    if (parkMoon.visible) {
      const s = MOON_PARK_SCALE * (1 - 0.16 * compact);
      const d = scale + MOON_PARK_CLEAR + MOON_R * s;
      parkMoon.position.set(
        recentre.x + MOON_PARK_DIR.x * d,
        recentre.y + MOON_PARK_DIR.y * d,
        0
      );
      parkMoon.scale.setScalar(s);
      parkMoon.rotation.y += MOON_PARK_SPIN * dt;
    }

    if (measureIn <= 0) {
      measureIn = 30;
      for (let i = 0; i < layers.length; i++) tagWidth[i] = layers[i].el.offsetWidth;
    }
    measureIn--;

    // The floating tool badges hang over the panel right edge, so a tag is kept
    // further from that side than from the left. Below 500px the bottom badge
    // is display:none and the reserve would only squash the tags together.
    const insetRight = width < 500 ? 8 : Math.max(48, width * 0.11);

    rows[0].length = 0;
    rows[1].length = 0;

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      layer.spin.rotation.y = heading;
      layer.holder.position.copy(AXIS).multiplyScalar(pos[i]);

      layer.anchor.getWorldPosition(worldPos);
      worldPos.project(camera);

      const p = place[i];
      p.x = (worldPos.x * 0.5 + 0.5) * width;
      p.y = (-worldPos.y * 0.5 + 0.5) * height;
      p.width = tagWidth[i];
      rows[i % 2].push(p);
    }

    // spreadRow resolves a row in reading order, and the cascade now runs the
    // other way: index 0 (the crust) ends up on the RIGHT, so index order is
    // right-to-left on screen and each row has to be turned round first.
    rows[0].reverse();
    rows[1].reverse();

    /*
     * Captions are laid out, not merely projected. Clamping each one to the
     * panel on its own piles several of them into the same corner on a narrow
     * card; resolving the row pushes them off each other instead, so a name is
     * never printed over a name.
     */
    spreadRow(rows[0], 6, width - insetRight, TAG_PAD);
    spreadRow(rows[1], 6, width - insetRight, TAG_PAD);

    for (let i = 0; i < layers.length; i++) {
      const p = place[i];
      const style = layers[i].el.style;
      style.transform =
        'translate3d(' + p.x.toFixed(1) + 'px, ' + p.y.toFixed(1) + 'px, 0) translate(-50%, 0)';
      /*
       * A caption arrives with its own layer rather than with the gesture. It
       * says "this piece is now a thing of its own", which is not true until
       * the extraction that freed it has finished — and it means the row
       * writes itself right to left as the model comes apart.
       */
      const arrived = progress[revealStage(i, STAGES.length)];
      style.opacity = String(Math.min(1, Math.max(0, (arrived - 0.55) / 0.3)));
    }

    host.classList.toggle('is-open', openness > 0.35);

    if (!announced && openness > 0.9) {
      announced = true;
      openCb?.();
    }

    renderer.render(scene, camera);

    // reveal only once a finished frame is sitting behind the fade — otherwise
    // the panel flashes an empty canvas
    if (!shown) {
      shown = true;
      host.classList.add('is-live');
    }
  }
  raf = requestAnimationFrame(frame);

  return {
    compact(on: boolean) {
      compactTarget = on ? 1 : 0;
    },

    open(apart: boolean) {
      pinned = apart;
      explodeTarget = apart ? 1 : 0;
      // the lesson gets the same deal as a visitor: it may ask for the model
      // to open, but it opens facing its cut or not at all. A spin still under
      // the hand has to be called off with it, or the next pointermove would
      // put the yaw straight back and hold the gate shut for good.
      if (apart) {
        yawTarget = 0;
        if (mode === 'turn') mode = 'open';
      }
    },

    /*
     * Show, don't caption. Runs once per mount and never against the visitor:
     * a hand on the model at any point during it — even before it starts —
     * cancels it, because at that moment the demo would be arguing with the
     * gesture it exists to teach.
     */
    demo() {
      if (demoed || touched || pinned) return;
      demoed = true;
      yawTarget = 0;
      explodeTarget = DEMO_OPEN;
      window.setTimeout(() => {
        if (touched || pinned) return;
        explodeTarget = 0;
      }, DEMO_MS);
    },

    flash(index: number, ms = 900) {
      const kind = LAYERS[index]?.kind;
      if (!kind) return;
      const mats = [recipes[kind].shell, recipes[kind].cut];
      mats.forEach(remember);

      const glow = new Color('#1ccf8e');
      const t0 = performance.now();
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / ms);
        // in fast, out slow — a confirmation, not a strobe
        const level = k < 0.25 ? k / 0.25 : 1 - (k - 0.25) / 0.75;
        for (const m of mats) {
          m.emissive.copy(glow);
          m.emissiveIntensity = level * 1.5;
        }
        if (k < 1) {
          requestAnimationFrame(step);
        } else {
          for (const m of mats) {
            const [color, intensity] = restore.get(m)!;
            m.emissive.copy(color);
            m.emissiveIntensity = intensity;
          }
        }
      };
      requestAnimationFrame(step);
    },

    tag(index: number) {
      return layers[index]?.el;
    },

    onOpen(cb: () => void) {
      openCb = cb;
      if (announced) cb();
    },

    onOverpull(cb: () => void) {
      overpullCb = cb;
    },

    destroy() {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onCancel);
      canvas.removeEventListener('lostpointercapture', onCancel);
      scene.traverse((o) => {
        const m = o as Mesh;
        if (m.geometry) m.geometry.dispose();
      });
      Object.values(recipes).forEach((r) => { r.shell.dispose(); r.cut.dispose(); });
      [maps.map, maps.bumpMap, maps.roughnessMap, maps.cloudAlpha, strata, grain, env]
        .forEach((x) => x.dispose());
      renderer.dispose();
      layers.forEach((l) => l.el.remove());
    }
  };
}
