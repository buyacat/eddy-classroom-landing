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
  name: string;
  meta?: string;
}

type Kind = 'crust' | 'mantle' | 'outerCore' | 'innerCore';

interface LayerDef {
  kind: Kind;
  rIn: number;
  rOut: number;
}

const LAYERS: LayerDef[] = [
  { kind: 'crust', rIn: 0.978, rOut: 1 },
  { kind: 'mantle', rIn: 0.546, rOut: 0.978 },
  { kind: 'outerCore', rIn: 0.192, rOut: 0.546 },
  { kind: 'innerCore', rIn: 0, rOut: 0.192 }
];

const PHI_START = 0;
const PHI_LENGTH = Math.PI * 1.34;

const AXIS = new Vector3(-1, 0.05, 0).normalize();

const BASE_YAW = 1.8221;
const BASE_PITCH = 0.409;

const STAGE_D = stageDistances(LAYERS);
const STAGES = stageWindows(STAGE_D);
const TOTAL_TRAVEL = totalTravel(STAGE_D);

const TAG_DROP = 1.16;
const TAG_ROW_GAP = 6;

const LEAD_FROM = 3;
const LEAD_TO = 4;
const LEAD_MIN_PANEL = 310;

const ALIGN_FREE = 0.02;
const ALIGN_BLOCK = 0.1;

const TAG_PAD = 8;

const REDUCED =
  typeof window !== 'undefined' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const ROCK = REDUCED ? 0 : 0.17;

const DEMO_OPEN = 0.26;
const DEMO_MS = 2000;

const CAM_Z = 5.9;
const OPEN_SHRINK = 0.5;
const OPEN_LIFT_Y = 0.3;
const OPEN_LIFT_X = -0.06;

const MOON_R = 0.19;
const MOON_ORBIT = 1.42;
const MOON_PERIOD = 26;
const MOON_TILT_X = 0.88;
const MOON_TILT_Z = 0.09;

const MOON_PARK_DIR = new Vector3(0.22, 1, 0).normalize();
const MOON_PARK_CLEAR = 0.22;
const MOON_PARK_SCALE = 0.66;
const MOON_PARK_SPIN = 0.014;

function hash3(i: number, j: number, k: number): number {
  let n = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(k, 1274126177)) | 0;
  n = (n ^ (n >>> 13)) | 0;
  n = Math.imul(n, 1274126177) | 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

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

const TEX_SURFACE = withBase('/assets/textures/earth-surface.webp');
const TEX_CLOUDS = withBase('/assets/textures/earth-clouds.webp');

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

    const ro = water ? 66 : 208;
    rough.data[i] = rough.data[i + 1] = rough.data[i + 2] = ro;
    rough.data[i + 3] = 255;

    const relief = water ? 96 : 108 + lum * 0.4;
    bump.data[i] = bump.data[i + 1] = bump.data[i + 2] = relief;
    bump.data[i + 3] = 255;
  }
  roughCtx.putImageData(rough, 0, 0);
  bumpCtx.putImageData(bump, 0, 0);

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

      const warp = (fbm(dx * 3.6, dy * 3.6, 3.7, 4) - 0.5) * 0.26;
      const bands = 0.5 + 0.5 * Math.sin((r + warp) * 27);
      const grain = fbm(dx * 22, dy * 22, Math.cos(a) * 3, 4);

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

function buildMoonMaps(): { color: CanvasTexture; bump: CanvasTexture } {
  const W = 512, H = 256;
  const [c, ctx] = canvas2d(W, H);
  const img = ctx.createImageData(W, H);

  for (let y = 0; y < H; y++) {
    const lat = (y / H - 0.5) * Math.PI;
    for (let x = 0; x < W; x++) {
      const lon = (x / W) * Math.PI * 2;
      const sx = Math.cos(lat) * Math.cos(lon), sy = Math.sin(lat), sz = Math.cos(lat) * Math.sin(lon);
      const n = fbm(sx * 3.1 + 11, sy * 3.1 + 5, sz * 3.1 + 2, 5);
      const sea = fbm(sx * 1.35 + 41, sy * 1.35 + 17, sz * 1.35 + 29, 3);
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
    ctx.beginPath();
    ctx.arc(-r * 0.16, -r * 0.16, r * 0.92, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(236, 233, 228, 0.42)';
    ctx.lineWidth = Math.max(1, r * 0.22);
    ctx.stroke();
    ctx.restore();
  }

  const color = new CanvasTexture(c);
  color.colorSpace = SRGBColorSpace;
  const bump = new CanvasTexture(c);
  return { color, bump };
}

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
  shell: MeshStandardMaterial;
  cut: MeshStandardMaterial;
}

function buildRecipes(
  maps: EarthMaps,
  strata: CanvasTexture,
  grain: CanvasTexture
): Record<Kind, Recipe> {
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
  anchor: Object3D;
  rim: Object3D;
  el: HTMLElement;
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

  const anchor = new Object3D();
  anchor.position.set(0, -TAG_DROP, 0);
  holder.add(anchor);

  const rim = new Object3D();
  rim.position.set(0, -def.rOut, 0);
  holder.add(rim);

  return { holder, spin, anchor, rim };
}

export interface GlobeHandle {
  destroy(): void;
  open(apart: boolean): void;
  onOpenChange(cb: (open: boolean) => void): void;
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

    const lead = document.createElement('i');
    lead.className = 'globe-lead';
    labelHost.prepend(lead);

    return { ...built, el, lead };
  });

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

  const parkMat = moonMat.clone();
  parkMat.opacity = 0;
  const parkMoon = new Mesh(new SphereGeometry(MOON_R, 48, 32), parkMat);
  parkMoon.visible = false;
  scene.add(parkMoon);

  let moonPhase = 0.62;

  let yaw = 0;
  let yawTarget = 0;
  let rockGain = 1;
  let explode = 0;
  let explodeTarget = 0;
  let dragging = false;
  let pointerId = -1;
  let startX = 0;
  let startY = 0;
  let yawAtStart = 0;
  let touched = false;
  let pinned = false;
  let demoed = false;
  let width = 0;
  let height = 0;
  let t = 0;

  type Mode = 'idle' | 'turn' | 'open';
  let mode: Mode = 'idle';

  const coarse = window.matchMedia('(pointer: coarse)').matches;

  const TAP_SLOP = coarse ? 12 : 7;

  let openCb: ((open: boolean) => void) | null = null;
  let wasOpen = false;

  const worldPos = new Vector3();
  const recentre = new Vector3();

  const foot = host.querySelector<HTMLElement>('.globe-foot');

  const tagWidth = new Array<number>(LAYERS.length).fill(0);
  let tagHeight = 0;
  let footTop = Number.POSITIVE_INFINITY;
  let measureIn = 0;

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
    camera.position.z = CAM_Z * Math.max(1, 1 + (620 - Math.min(width, 620)) / 1500);
    camera.updateProjectionMatrix();
  }

  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  function onDown(e: PointerEvent) {
    if (dragging) return;
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
      mode = !coarse && dx < 0 && Math.abs(dx) > Math.abs(dy) * 1.4 && explode < 0.08
        ? 'turn'
        : 'open';
      if (mode === 'turn') {
        pinned = false;
        explodeTarget = 0;
      }
    }

    if (mode === 'turn') {
      yawTarget = yawAtStart + (dx / Math.max(width, 1)) * Math.PI * 0.85;
      return;
    }

    yawTarget = 0;
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
    if (mode === 'idle' && Math.hypot(e.clientX - startX, e.clientY - startY) < TAP_SLOP) {
      pinned = !pinned;
      if (pinned) yawTarget = 0;
    }
    if (mode !== 'turn') explodeTarget = pinned ? 1 : 0;
    release();
  }

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

    rockGain += ((dragging || explodeTarget > 0.01 ? 0 : 1) - rockGain) * Math.min(1, dt * 4);
    yaw += (yawTarget - yaw) * Math.min(1, dt * 9);
    const offset = yaw + Math.sin(t * 0.42) * ROCK * rockGain;
    const heading = BASE_YAW + offset;

    const facing = smoothstep(ALIGN_BLOCK, ALIGN_FREE, Math.abs(offset));

    explode += (explodeTarget * facing - explode) * Math.min(1, dt * (dragging ? 11 : 6));

    const progress = stageProgress(STAGES, explode);
    const pos = offsets(STAGES, progress);
    const spread = pos[pos.length - 1];
    const openness = spread / TOTAL_TRAVEL;

    const scale = 1 - OPEN_SHRINK * openness;
    stack.scale.setScalar(scale);
    recentre.copy(AXIS).multiplyScalar(-(spread / 2) * scale);
    recentre.x += OPEN_LIFT_X * openness;
    recentre.y += OPEN_LIFT_Y * openness;
    stack.position.copy(recentre);

    if (!REDUCED) moonPhase = (moonPhase + dt / MOON_PERIOD) % 1;
    moonArm.rotation.y = moonPhase * Math.PI * 2;
    const leaving = smoothstep(0.02, 0.14, openness);
    orbitMat.opacity = 0.3 * (1 - leaving);
    moonMat.opacity = 1 - leaving;
    moonSystem.visible = leaving < 0.999;

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

    const insetRight = width < 500 ? 8 : Math.max(48, width * 0.11);

    rows[0].length = 0;
    rows[1].length = 0;

    for (let i = 0; i < layers.length; i++) {
      const layer = layers[i];
      layer.spin.rotation.y = heading;
      layer.holder.position.copy(AXIS).multiplyScalar(pos[i]);

      layer.anchor.getWorldPosition(worldPos);
      worldPos.project(camera);

      const row = i < 2 ? 0 : 1;

      const p = place[i];
      p.x = (worldPos.x * 0.5 + 0.5) * width;
      p.y = (-worldPos.y * 0.5 + 0.5) * height + row * (tagHeight + TAG_ROW_GAP);
      p.width = tagWidth[i];
      rows[row].push(p);
    }

    const lowest = Math.max(place[2].y, place[3].y) + tagHeight;
    const ceiling = footTop - 8;
    if (lowest > ceiling) {
      const lift = lowest - ceiling;
      for (const p of place) p.y -= lift;
    }

    rows[0].reverse();
    rows[1].reverse();

    spreadRow(rows[0], 6, width - insetRight, TAG_PAD);
    spreadRow(rows[1], 6, width - insetRight, TAG_PAD);

    const leaders = width >= LEAD_MIN_PANEL;

    for (let i = 0; i < layers.length; i++) {
      const p = place[i];
      const style = layers[i].el.style;
      style.transform =
        'translate3d(' + p.x.toFixed(1) + 'px, ' + p.y.toFixed(1) + 'px, 0) translate(-50%, 0)';
      const arrived = progress[revealStage(i, STAGES.length)];
      const shown = Math.min(1, Math.max(0, (arrived - 0.55) / 0.3));
      style.opacity = String(shown);

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
      lead.transform =
        'translate3d(' + (rx + (dx / span) * LEAD_FROM).toFixed(1) + 'px, ' +
        (ry + (dy / span) * LEAD_FROM).toFixed(1) + 'px, 0) rotate(' + angle.toFixed(4) + 'rad)';
      lead.width = (span - LEAD_FROM - LEAD_TO).toFixed(1) + 'px';
      lead.opacity = String(shown * 0.55);
    }

    const open = openness > 0.35;
    host.classList.toggle('is-open', open);
    if (open !== wasOpen) {
      wasOpen = open;
      openCb?.(open);
    }

    renderer.render(scene, camera);

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
      if (apart) {
        yawTarget = 0;
        if (mode === 'turn') mode = 'open';
      }
    },

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
