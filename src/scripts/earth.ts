/**
 * Hero globe: procedurally generated cut-away Earth (noise-based textures/geometry, no GLB).
 * Scene graph per layer: stack (shrinks/recenters on explode) > holder (explode offset, unrotated) > spin (yaw/pitch).
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
 * Radii as fractions of Earth's 6371 km radius, per PREM: core-mantle
 * boundary at 2891 km (0.5462), inner-core boundary at 5150 km (0.1917).
 * Crust is exaggerated ~4x (real continental crust is 0.9945) to stay
 * visible under antialiasing.
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
 * Cascade direction: points toward the wedge opening (left). Paired with
 * BASE_YAW below — the two set the handedness of the layout, so turning the
 * model must flip both or shells travel through the solid crust.
 */
const AXIS = new Vector3(-1, 0.05, 0).normalize();

/**
 * Three-quarter view yaw. The wedge opening is 119° wide, so its bisector
 * must be within 59.4° of the travel axis; 45° leaves ~14° of margin while
 * still turning the cross-section toward the camera.
 */
const BASE_YAW = 1.8221;
/** 23.44 degrees — the real axial tilt, so even the pose teaches something. */
const BASE_PITCH = 0.409;

/**
 * Stage spacing/sequencing computed in earth-layout.ts (no three.js
 * dependency, so the no-overlap invariant is unit-testable via `npm run
 * check`). Crust stays fixed; contents extract outside-in.
 */
const STAGE_D = stageDistances(LAYERS);
const STAGES = stageWindows(STAGE_D);
const TOTAL_TRAVEL = totalTravel(STAGE_D);

/**
 * TAG_DROP (model units, scales with model) and TAG_ROW_GAP (pixels, row
 * spacing) are deliberately different units — keeping the stagger in model
 * space made the two caption rows converge on small phones.
 */
const TAG_DROP = 1.16;
const TAG_ROW_GAP = 6;

/** Leader line from shell bottom to caption; stops short of both ends so it touches neither. */
const LEAD_FROM = 3;
const LEAD_TO = 4;
/** Below this panel width leaders are hidden — measured: they start crossing captions under ~328px, clean above it. */
const LEAD_MIN_PANEL = 310;

/**
 * Alignment gate: the model may explode only when within ALIGN_FREE rad of
 * the cut-facing pose; the gate closes again past ALIGN_BLOCK. Without it,
 * shells appear to pull out through the solid half of the planet at the
 * wrong yaw.
 */
const ALIGN_FREE = 0.02;
const ALIGN_BLOCK = 0.1;

/** Clear air kept between two captions in the same row, in pixels. */
const TAG_PAD = 8;

/* Ambient motion (idle rock, Moon orbit) respects prefers-reduced-motion; gesture-driven motion is unaffected. */
const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Amplitude of the idle rock, in radians. Zero when motion is not wanted. */
const ROCK = REDUCED ? 0 : 0.17;

/** One-time demo: opens 26% of travel for 2s (covers the ~0.5s alignment gate plus a visible opening). */
const DEMO_OPEN = 0.26;
const DEMO_MS = 2000;

const CAM_Z = 5.9;
/** How much the whole assembly shrinks at full explode, to stay in the panel. */
const OPEN_SHRINK = 0.5;
/**
 * Recenters the open cascade in the panel. The stack is asymmetric — the
 * crust radius is ~3x the core's — so centring on the travel midpoint alone
 * hangs it low.
 */
const OPEN_LIFT_Y = 0.3;
// nudged off the right edge, where the floating tool badges overlap the panel
const OPEN_LIFT_X = -0.06;

/* ------------------------------------------------------------------- moon */

/**
 * Moon dimensions are stylized to fit the panel: MOON_R 0.19 (real 0.27) and
 * MOON_ORBIT 1.42 (real ~60 Earth radii) are both scaled down; the orbit is
 * drawn as a visible ring since the scale isn't realistic. MOON_TILT_X must
 * exceed asin(1 / MOON_ORBIT) ≈ 0.78 rad or the ellipse collapses inside the
 * planet's silhouette.
 */
const MOON_R = 0.19;
const MOON_ORBIT = 1.42;
/** Seconds per lap. A real month compressed to something a visitor will wait for. */
const MOON_PERIOD = 26;
const MOON_TILT_X = 0.88;
const MOON_TILT_Z = 0.09;

/**
 * Parked position (upper-right of crust, near the sun at (2.6, 2.2, 3.8))
 * avoids the Moon passing through the shells or the half-transparent crust
 * during explode. Offset rides the open stack's own scale, so the gap stays
 * constant however far the row has opened.
 */
const MOON_PARK_DIR = new Vector3(0.22, 1, 0).normalize();
/**
 * Gap is measured off the crust's rim, not fixed panel coordinates, so it
 * holds steady as the crust scales during explode. 12° off vertical to clear
 * the floating tool badges (~5-18% of panel height on the right edge).
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
 * Base colour is NASA's Blue Marble (public domain), not procedural noise,
 * since the product teaches real geography. Relief and roughness are derived
 * from it in one pass: ocean pixels are the only dark, blue-dominant ones, so
 * water separates cleanly without a second texture.
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
 * Crust cross-section bedding texture. RingGeometry maps UVs across its
 * bounding box, so concentric bands become real bedding planes. Only the
 * crust gets this — bedding is a sedimentary feature.
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

      // low-frequency warp — buckles the bands and avoids moire aliasing when the model turns
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
 * Procedural Moon texture (no separate file): fbm highlands plus a maria
 * (dark basalt) pass, then craters stretched by 1/cos(latitude) so they
 * render round after the equirectangular map wraps onto a sphere — without
 * that the poles get elliptical craters.
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
   * Bedding is a sedimentary feature: only the crust gets strata texture,
   * the mantle gets mineral grain, and the two cores get neither.
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
      // solid silicate rock (only ~1-2% partial melt) — must not glow, avoids the "sea of fire under the crust" myth
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
      // solid iron-nickel, held solid by 330-360 GPa; pale straw not gold (avoids the "core is gold" myth)
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
  holder: Group;
  spin: Group;
  /** where the caption hangs */
  anchor: Object3D;
  /** the bottom of the shell's silhouette, where its leader starts */
  rim: Object3D;
  /** the caption, positioned by the frame loop */
  el: HTMLElement;
  /** the hairline from the rim to the caption */
  lead: HTMLElement;
}

function buildLayer(
  def: LayerDef,
  recipe: Recipe,
  maps: EarthMaps
): Omit<Layer, 'el' | 'lead'> {
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

  // Anchor rides the holder (not spin) so the tag doesn't rotate with the
  // model; positioned via its own top-centre CSS transform.
  const anchor = new Object3D();
  anchor.position.set(0, -TAG_DROP, 0);
  holder.add(anchor);

  /* The lowest point of the shell, which is where its leader starts. A sphere
     looks the same from every angle, so this is the bottom of the silhouette
     whatever the model's yaw — no need to follow the spin. */
  const rim = new Object3D();
  rim.position.set(0, -def.rOut, 0);
  holder.add(rim);

  return { holder, spin, anchor, rim };
}

/* ------------------------------------------------------------------ mount */

export interface GlobeHandle {
  destroy(): void;
  /** Latch the model apart (or back together), overriding the idle state. */
  open(apart: boolean): void;
  /** Fires when the model crosses between open and closed, from any cause (drag, tap, or the explode button). */
  onOpenChange(cb: (open: boolean) => void): void;
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

  const layers: Layer[] = LAYERS.map((def, i) => {
    const built = buildLayer(def, recipes[def.kind], maps);
    stack.add(built.holder);

    const el = document.createElement('span');
    el.className = 'globe-tag';
    el.innerHTML =
      '<i class="globe-tag-dot">' + (i + 1) + '</i><span><b></b><em></em></span>';
    (el.querySelector('b') as HTMLElement).textContent = specs[i]?.name ?? '';
    (el.querySelector('em') as HTMLElement).textContent = specs[i]?.meta ?? '';
    labelHost.appendChild(el);

    // prepended so every leader paints under every pill, not just its own
    const lead = document.createElement('i');
    lead.className = 'globe-lead';
    labelHost.prepend(lead);

    return { ...built, el, lead };
  });

  /**
   * Moon system parented to the scene, not the model: riding the spinner
   * would tie the orbit to Earth's own rotation, and riding the stack would
   * resize/reposition it as the model explodes. Depth-tested, so the planet
   * occludes the far half of the orbit ring.
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

  /* Tidal locking comes free: the Moon mesh doesn't rotate within the arm, so it always faces the orbit centre. */
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

  /**
   * Parked Moon is a separate mesh (not the orbiting one relocated) so it
   * never crosses the cross-section in flight; the two cross-fade with a gap
   * so both are never visible at once. Own material and a coarser, smaller
   * geometry for independent opacity; maps are shared.
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

  /* Drag direction commits to one mode ('turn' or 'open') once threshold is crossed, and holds for the rest of the gesture. */
  type Mode = 'idle' | 'turn' | 'open';
  let mode: Mode = 'idle';

  // A finger gets no free spin: the leftward half of the axis is how the page
  // itself is swiped, and taking it would fight the browser for the gesture.
  const coarse = window.matchMedia('(pointer: coarse)').matches;

  /**
   * One threshold for both tap and drag. Touch needs a larger slop since a
   * tap is the only way to close a latched-open model on touch.
   */
  const TAP_SLOP = coarse ? 12 : 7;

  let openCb: ((open: boolean) => void) | null = null;
  /** Last state handed to openCb, so it fires on a crossing and not per frame. */
  let wasOpen = false;

  const worldPos = new Vector3();
  const recentre = new Vector3();

  // Bottom strip (caveat + explode button); measured rather than assumed,
  // since its top depends on breakpoint and open state.
  const foot = host.querySelector<HTMLElement>('.globe-foot');

  /**
   * Tag widths, cached rather than measured every frame — caption width
   * depends on font/translation length, and reading layout every frame would
   * thrash against the transforms written in the same loop.
   */
  const tagWidth = new Array<number>(LAYERS.length).fill(0);
  // Read from the DOM since both change with breakpoint (tags drop their
  // depth line under 760px; the foot grows a line when the model is open).
  let tagHeight = 0;
  let footTop = Number.POSITIVE_INFINITY;
  let measureIn = 0;

  // Reused every frame (60Hz) rather than reallocated.
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
      /**
       * Rightward drag opens it (shells exit left, through the cut); leftward
       * spin is only available on mouse, and only while still a globe.
       */
      mode = !coarse && dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.4 && explode < 0.08
        ? 'turn'
        : 'open';
      // grabbing to spin cancels a pending explode
      if (mode === 'turn') {
        pinned = false;
        explodeTarget = 0;
      }
    }

    if (mode === 'turn') {
      yawTarget = yawAtStart + (dx / Math.max(width, 1)) * Math.PI * 0.85;
      return;
    }

    // Act one: turn to face the cut (gated in the frame loop). Act two: pull apart.
    yawTarget = 0;
    // one axis, one sign — dragging left folds it back up instead of opening a second time
    const pull = Math.max(0, dx) / Math.max(width * 0.34, 1);
    explodeTarget = Math.max(pinned ? 1 : 0, Math.min(1, pull));
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

  /* A cancel means the gesture didn't happen (second finger, capture lost) — must not commit like onUp would. */
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

    // Idle rock damps out (not additive) the moment a hand is on it or the explode target moves.
    rockGain += ((dragging || explodeTarget > 0.01 ? 0 : 1) - rockGain) * Math.min(1, dt * 4);
    yaw += (yawTarget - yaw) * Math.min(1, dt * 9);
    const offset = yaw + Math.sin(t * 0.42) * ROCK * rockGain;
    const heading = BASE_YAW + offset;

    // Gate: layers stay shut until yaw is near the cut-facing pose (act one of the gesture).
    const facing = smoothstep(ALIGN_BLOCK, ALIGN_FREE, Math.abs(offset));

    explode += (explodeTarget * facing - explode) * Math.min(1, dt * (dragging ? 11 : 6));

    // Outside-in extraction: crust's contents come out as one group, then the
    // cores, then the inner core — never two stages at once.
    const progress = stageProgress(STAGES, explode);
    const pos = offsets(STAGES, progress);
    const spread = pos[pos.length - 1];
    /** How open the thing actually is — the row's own length, not the gesture. */
    const openness = spread / TOTAL_TRAVEL;

    const scale = 1 - OPEN_SHRINK * openness;
    stack.scale.setScalar(scale);
    recentre.copy(AXIS).multiplyScalar(-(spread / 2) * scale);
    recentre.x += OPEN_LIFT_X * openness;
    recentre.y += OPEN_LIFT_Y * openness;
    stack.position.copy(recentre);

    /**
     * Moon runs on its own clock, independent of drag/rock/explode. It fades
     * out of orbit before the crust reaches the orbit radius, and the group
     * is switched off once fully transparent (a transparent mesh still costs
     * a draw). The parked Moon fades in after, on the same `openness` curve,
     * so closing the model reverses the handover for free.
     */
    if (!REDUCED) moonPhase = (moonPhase + dt / MOON_PERIOD) % 1;
    moonArm.rotation.y = moonPhase * Math.PI * 2;
    /* Gone by 0.14 of the row: measured, the crust first eats into the orbit
       at openness 0.17 — from there the Moon is inside it, not behind it. */
    const leaving = smoothstep(0.02, 0.14, openness);
    orbitMat.opacity = 0.3 * (1 - leaving);
    moonMat.opacity = 1 - leaving;
    moonSystem.visible = leaving < 0.999;

    /**
     * Park position rides the crust's rim (recentre + scale), so the gap
     * stays constant at any openness. Fades in as the orbiting Moon finishes
     * leaving, so there's no stretch with no Moon visible at all.
     */
    const parked = smoothstep(0.13, 0.27, openness);
    parkMat.opacity = parked;
    parkMoon.visible = parked > 0.002;
    if (parkMoon.visible) {
      const s = MOON_PARK_SCALE;
      const d = scale + MOON_PARK_CLEAR + MOON_R * s;
      parkMoon.position.set(
        recentre.x + MOON_PARK_DIR.x * d,
        recentre.y + MOON_PARK_DIR.y * d,
        0
      );
      parkMoon.scale.setScalar(s);
      if (!REDUCED) parkMoon.rotation.y += MOON_PARK_SPIN * dt;
    }

    if (measureIn <= 0) {
      measureIn = 30;
      for (let i = 0; i < layers.length; i++) tagWidth[i] = layers[i].el.offsetWidth;
      tagHeight = layers[0].el.offsetHeight || 0;
      footTop = foot ? foot.offsetTop : Number.POSITIVE_INFINITY;
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

      /**
       * Row = which half of the screen the shell is in, not index parity —
       * grouping by side keeps leader lines from crossing under a different
       * shell's caption.
       */
      const row = i < 2 ? 0 : 1;

      const p = place[i];
      p.x = (worldPos.x * 0.5 + 0.5) * width;
      // the lower row is one tag lower, in pixels — see TAG_ROW_GAP
      p.y = (-worldPos.y * 0.5 + 0.5) * height + row * (tagHeight + TAG_ROW_GAP);
      p.width = tagWidth[i];
      rows[row].push(p);
    }

    // Lift both rows clear of the foot strip if they'd overlap it (measured, not assumed).
    const lowest = Math.max(place[2].y, place[3].y) + tagHeight;
    const ceiling = footTop - 8;
    if (lowest > ceiling) {
      const lift = lowest - ceiling;
      for (const p of place) p.y -= lift;
    }

    // spreadRow resolves a row in reading order, and the cascade runs the
    // other way: index 0 (the crust) ends up on the RIGHT, so index order is
    // right-to-left on screen and each row has to be turned round first.
    rows[0].reverse();
    rows[1].reverse();

    /**
     * Resolve each row instead of clamping captions independently, so they
     * push off each other rather than stacking on top of one another.
     */
    spreadRow(rows[0], 6, width - insetRight, TAG_PAD);
    spreadRow(rows[1], 6, width - insetRight, TAG_PAD);

    const leaders = width >= LEAD_MIN_PANEL;

    for (let i = 0; i < layers.length; i++) {
      const p = place[i];
      const style = layers[i].el.style;
      style.transform =
        'translate3d(' + p.x.toFixed(1) + 'px, ' + p.y.toFixed(1) + 'px, 0) translate(-50%, 0)';
      // Caption opacity tracks its own stage's progress (not the whole
      // gesture), so the row reveals right-to-left as each shell is freed.
      const arrived = progress[revealStage(i, STAGES.length)];
      const shown = Math.min(1, Math.max(0, (arrived - 0.55) / 0.3));
      style.opacity = String(shown);

      // Leader line: shell-bottom to caption top-centre, computed after the
      // row spread so it follows the caption to wherever it landed.
      const lead = layers[i].lead.style;
      if (!leaders || shown < 0.01) {
        lead.opacity = '0';
        continue;
      }
      layers[i].rim.getWorldPosition(worldPos);
      worldPos.project(camera);
      const rx = (worldPos.x * 0.5 + 0.5) * width;
      const ry = (-worldPos.y * 0.5 + 0.5) * height;
      const dx = p.x - rx;
      const dy = p.y - ry;
      const span = Math.hypot(dx, dy);
      if (span <= LEAD_FROM + LEAD_TO) {
        lead.opacity = '0';
        continue;
      }
      const angle = Math.atan2(dy, dx);
      // walked in from both ends, so it touches neither the shell nor the pill
      lead.transform =
        'translate3d(' + (rx + (dx / span) * LEAD_FROM).toFixed(1) + 'px, ' +
        (ry + (dy / span) * LEAD_FROM).toFixed(1) + 'px, 0) rotate(' + angle.toFixed(4) + 'rad)';
      lead.width = (span - LEAD_FROM - LEAD_TO).toFixed(1) + 'px';
      // a hairline is support, not an accent: it never reaches full strength
      lead.opacity = String(shown * 0.55);
    }

    // Single threshold shared by the caveat text and the button label, so they can't drift apart.
    const open = openness > 0.35;
    host.classList.toggle('is-open', open);
    if (open !== wasOpen) {
      wasOpen = open;
      openCb?.(open);
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
    open(apart: boolean) {
      pinned = apart;
      explodeTarget = apart ? 1 : 0;
      // Opening still requires facing the cut; cancel an in-progress spin,
      // or the next pointermove would re-block the gate.
      if (apart) {
        yawTarget = 0;
        if (mode === 'turn') mode = 'open';
      }
    },

    // Runs once per mount; a hand on the model at any point cancels it.
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

    onOpenChange(cb: (open: boolean) => void) {
      openCb = cb;
      // hand the caller the starting state too, not just future crossings
      cb(wasOpen);
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
      layers.forEach((l) => { l.el.remove(); l.lead.remove(); });
    }
  };
}
