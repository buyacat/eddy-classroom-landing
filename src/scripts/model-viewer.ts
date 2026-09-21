/**
 * Loads and drives a single glTF model: drag to turn, slider to explode,
 * per-part select/zoom. Per-model specifics (hotspots, travel directions,
 * explode spacing) are passed in by the caller (src/data/models.json).
 *
 * Scene graph: root (scaled on explode) > scene (glTF, recentred on origin)
 *   > parts (offset along explode direction) + anchors (caption points)
 */
import {
  ACESFilmicToneMapping,
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  Object3D,
  PMREMGenerator,
  PerspectiveCamera,
  Scene,
  Sphere,
  Vector3,
  WebGLRenderer
} from 'three';
import type { MeshStandardMaterial, Texture } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** A part as the page knows it: a node name and the copy that belongs to it. */
export interface PartSpec {
  node: string;
  label: string;
  desc: string;
}

/** Part hotspot + explode direction, in model-space coordinates (models.json).
 *  Both are optional; omitted values fall back to the part's own centre/direction. */
export interface PartGeometry {
  /** the point the caption points at, in model space */
  at?: [number, number, number];
  /** direction the part travels when the model opens; normalised on use */
  out?: [number, number, number];
}

/**
 * `factor`: how far apart parts end up, as a multiple of the model's own size.
 * `groups`: sets of parts that must travel together as one body (offset solved
 * on the bounding box of the whole group, not each part individually).
 */
export interface ExplodeSpec {
  factor: number;
  groups?: string[][];
}

/** The factor to use when a model's data leaves it out. */
const EXPLODE_FALLBACK = 2;

/** How fast the slider's value catches up with the model. */
const EXPLODE_EASE = 6;

/** Field of view, and the air left around the model inside it. */
const FOV = 45;
const FIT_MARGIN = 1.04;

/** Where the camera stands before anybody has turned anything. */
const START_DIR = new Vector3(0.5, 0.45, 0.75).normalize();

/** Callout dimensions. DOT must match .mv-marker-dot in ModelViewer.astro. */
const DOT = 10;
const LEAD = 92;
const LEAD_MIN = 26;
/** Clear air kept between the callout and the edge of the stage. */
const EDGE = 12;

/** How far in and out the zoom buttons may take the model. */
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.6;

/** One swing-and-return on load, not continuous auto-rotate (which would
 *  hold the GPU at 60Hz for as long as the tab stays open). */
const SWING = 0.5;
const SWING_MS = 2600;
const SWING_DELAY = 500;

/** Highlight via emissive, not a colour swap — a flat tint reads as a bug on
 *  transparent materials. */
const GLOW = new Color('#ffbe3d');
const GLOW_STRENGTH = 0.62;

export interface ViewerHandle {
  destroy(): void;
  /** Take the model apart: 0 shut, 1 fully open. */
  setExplode(value: number): void;
  /** Light one part up, or clear the highlight with null. */
  select(node: string | null): void;
  /** Step the model closer (> 1) or further off (< 1), without the wheel. */
  zoom(factor: number): void;
  /** Back to the pose and the distance the model arrived in. */
  resetView(): void;
}

interface Part {
  spec: PartSpec;
  node: Object3D;
  /** the node's position with the model shut */
  home: Vector3;
  /** where the caption points, with the model shut */
  at: Vector3;
  /** how far, and which way, the part travels at full explode */
  offset: Vector3;
  /** the caption's point in the scene, moved with the part */
  anchor: Object3D;
}

/**
 * A tighter bounding sphere than `Box3.getBoundingSphere`, which circumscribes
 * the box's corners and over-estimates radius for non-cubic models. Uses each
 * mesh's own geometry bounding sphere, gathered around the box's centre.
 */
function tightSphere(object: Object3D, target: Sphere): Sphere {
  const box = new Box3().setFromObject(object);
  box.getBoundingSphere(target);

  const centre = target.center.clone();
  let radius = 0;
  object.updateWorldMatrix(true, true);
  object.traverse((o) => {
    const geometry = (o as Mesh).geometry;
    if (!geometry) return;
    if (!geometry.boundingSphere) geometry.computeBoundingSphere();
    const sphere = geometry.boundingSphere!.clone().applyMatrix4(o.matrixWorld);
    radius = Math.max(radius, sphere.center.distanceTo(centre) + sphere.radius);
  });

  // a node with no geometry of its own keeps the box's answer
  if (radius > 0) target.radius = radius;
  return target;
}

function materialsOf(root: Object3D): MeshStandardMaterial[] {
  const out: MeshStandardMaterial[] = [];
  root.traverse((o) => {
    const mat = (o as Mesh).material;
    if (!mat) return;
    for (const m of Array.isArray(mat) ? mat : [mat]) out.push(m as MeshStandardMaterial);
  });
  return out;
}

export interface MountOptions {
  /** the element the canvas fills; captions are clamped to its box */
  host: HTMLElement;
  canvas: HTMLCanvasElement;
  /** the callout — dot, leader and name — positioned by the frame loop */
  marker: HTMLElement;
  /** the name inside it, measured so the leader can be cut to fit the stage */
  caption: HTMLElement;
  url: string;
  parts: PartSpec[];
  /** the model's own hotspots and travel directions, keyed by node name */
  geometry?: Record<string, PartGeometry>;
  /** how far it opens, and what travels together */
  explode?: ExplodeSpec;
  /** 0..1 while the file is on the wire, or -1 when its size is unknown */
  onProgress?: (fraction: number) => void;
}

export async function mountViewer(opts: MountOptions): Promise<ViewerHandle> {
  const { host, canvas, marker } = opts;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.92;

  const scene = new Scene();

  // RoomEnvironment gives transparent/gel materials something to reflect
  // (a flat sky reads as grey fog); generated once, no network cost.
  const pmrem = new PMREMGenerator(renderer);
  const envTexture: Texture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTexture;
  scene.environmentIntensity = 0.4;

  const key = new DirectionalLight(0xfff9e2, 3.1);
  key.position.set(2.4, 2.6, 3.4);
  scene.add(key);
  const fill = new DirectionalLight(0xcfe3ff, 0.55);
  fill.position.set(-2.8, -0.6, -1.8);
  scene.add(fill);
  scene.add(new AmbientLight(0xffffff, 0.12));

  const camera = new PerspectiveCamera(FOV, 1, 0.01, 200);

  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(opts.url, (event) => {
    // a server that gzips without declaring a length reports total 0; say so
    // rather than inventing a percentage that sits at zero and then jumps
    opts.onProgress?.(event.total > 0 ? event.loaded / event.total : -1);
  });

  const model = gltf.scene;

  // Solved in the model's original (pre-recentre) coordinates — recentring
  // first would change every part's distance from origin.
  const whole = new Box3().setFromObject(model);
  const centre = whole.getCenter(new Vector3());
  const span = whole.getSize(new Vector3()).length() / 2 || 1;
  const geometry = opts.geometry ?? {};
  const travelScale = Math.max(0, (opts.explode?.factor ?? EXPLODE_FALLBACK) - 1);

  const scratch = new Vector3();
  const partSphere = new Sphere();
  /** Every part as a sphere, where it starts and where it ends up. */
  const shutSpheres: { at: Vector3; r: number }[] = [];
  const openSpheres: { at: Vector3; r: number }[] = [];

  // Travel distance grows with how far the part already sits from centre.
  function travelFrom(middle: Vector3, out?: [number, number, number]) {
    const distance = middle.length();
    const direction = out
      ? new Vector3(...out).normalize()
      : distance > 1e-4
        ? middle.clone().normalize()
        : new Vector3(0, 1, 0);
    const travel = span * travelScale * (0.6 + 0.8 * Math.min(1, distance / span));
    return direction.multiplyScalar(travel);
  }

  // Groups solved first, on the bounding box of the whole group, so every
  // member gets the same offset (solving individually would fan them apart).
  const grouped = new Map<string, Vector3>();
  for (const group of opts.explode?.groups ?? []) {
    const nodes = group
      .map((name) => model.getObjectByName(name))
      .filter((node): node is Object3D => !!node);
    if (nodes.length < 2) continue;

    const box = new Box3();
    for (const node of nodes) box.union(new Box3().setFromObject(node));
    const offset = travelFrom(box.getCenter(new Vector3()), geometry[group[0]]?.out);
    for (const name of group) grouped.set(name, offset);
  }

  const parts: Part[] = [];
  for (const spec of opts.parts) {
    const node = model.getObjectByName(spec.node);
    if (!node) continue;

    tightSphere(node, partSphere);

    const own = geometry[spec.node];
    const offset = grouped.get(spec.node)?.clone()
      ?? travelFrom(partSphere.center.clone(), own?.out);

    const at = new Vector3(...(own?.at ?? partSphere.center.toArray()));
    const anchor = new Object3D();
    anchor.position.copy(at);
    model.add(anchor);

    shutSpheres.push({ at: partSphere.center.clone(), r: partSphere.radius });
    openSpheres.push({ at: partSphere.center.clone().add(offset), r: partSphere.radius });

    parts.push({ spec, node, home: node.position.clone(), at, offset, anchor });
  }

  // centre the model on the origin, so the root's scale pivots on the model
  // rather than on wherever the exporter happened to put (0, 0, 0)
  model.position.sub(centre);

  const root = new Group();
  root.add(model);
  scene.add(root);

  /**
   * Open and shut states can have very different centres (parts fanning out
   * asymmetrically), so each is framed with its own centre/radius; root
   * travels between the two as the slider moves. Centre = midpoint of extremes
   * (not size-weighted); radius = furthest part from that centre.
   */
  function frameOf(spheres: { at: Vector3; r: number }[], at?: Vector3) {
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const s of spheres) {
      min.min(scratch.copy(s.at).subScalar(s.r));
      max.max(scratch.copy(s.at).addScalar(s.r));
    }
    const middle = at ?? min.clone().add(max).multiplyScalar(0.5);
    const radius = spheres.reduce((m, s) => Math.max(m, s.at.distanceTo(middle) + s.r), 0);
    return { middle, radius: radius || 1 };
  }

  // shut state framed on the model's own centre — the camera's orbit point
  const shut = frameOf(shutSpheres, centre);
  const open = frameOf(openSpheres);
  const shutRadius = shut.radius;
  const openRadius = Math.max(open.radius, shutRadius);
  const openShift = open.middle.clone().sub(centre);

  const baseDistance = (shutRadius / Math.sin((FOV * Math.PI) / 360)) * FIT_MARGIN;
  camera.position.copy(START_DIR).multiplyScalar(baseDistance);
  camera.near = baseDistance / 100;
  camera.far = baseDistance * 100;
  camera.updateProjectionMatrix();

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  // Disabled: OrbitControls' wheel zoom calls preventDefault on every wheel
  // event over the canvas, trapping page scroll. Zoom is buttons instead (see zoom()).
  controls.enableZoom = false;
  // Overrides the `none` OrbitControls sets on connect: vertical drag scrolls
  // the page like anywhere else; only horizontal drag orbits the model.
  canvas.style.touchAction = 'pan-y';

  let explode = 0;
  let explodeTarget = 0;
  let zoomLevel = 1;
  let zoomTarget = 1;
  let selected: Part | null = null;

  /** Emissive as it was before a part was lit, so it can be handed back. */
  const litBefore = new Map<MeshStandardMaterial, [Color, number]>();

  function clearGlow() {
    for (const [material, [emissive, intensity]] of litBefore) {
      material.emissive.copy(emissive);
      material.emissiveIntensity = intensity;
    }
    litBefore.clear();
  }

  function applyGlow(part: Part) {
    for (const material of materialsOf(part.node)) {
      if (!material.emissive) continue;
      if (!litBefore.has(material)) {
        litBefore.set(material, [material.emissive.clone(), material.emissiveIntensity]);
      }
      material.emissive.copy(GLOW);
      material.emissiveIntensity = GLOW_STRENGTH;
    }
  }

  // Rendered on demand (dirty flag) rather than a fixed clock/rAF loop cost.
  let dirty = true;
  let visible = true;
  let raf = 0;
  let last = performance.now();

  // When the swing runs, or -1 once spent/cancelled by user interaction.
  let swingAt = reduced ? -1 : performance.now() + SWING_DELAY;

  const invalidate = () => { dirty = true; };
  const stopSwing = () => {
    swingAt = -1;
    root.rotation.y = 0;
  };
  controls.addEventListener('change', invalidate);
  controls.addEventListener('start', stopSwing);

  const io = new IntersectionObserver(
    (entries) => {
      visible = entries[0]?.isIntersecting ?? true;
      if (visible) invalidate();
    },
    { threshold: 0 }
  );
  io.observe(host);

  function resize() {
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / rect.height;
    camera.updateProjectionMatrix();
    invalidate();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  resize();

  // Leader direction recomputed every frame: defaults outward (away from
  // stage centre), flips inward only if that side lacks room, else gets cut short.
  function placeMarker() {
    if (!selected) {
      marker.hidden = true;
      return;
    }
    // unhidden before measuring — a hidden element measures 0 wide
    marker.hidden = false;

    const rect = host.getBoundingClientRect();
    selected.anchor.getWorldPosition(scratch);
    scratch.project(camera);

    const x = (scratch.x * 0.5 + 0.5) * rect.width;
    // the dot may sit on the point, but the name must not hang off the stage
    const y = Math.min(Math.max((-scratch.y * 0.5 + 0.5) * rect.height, EDGE), rect.height - EDGE);

    const caption = opts.caption.offsetWidth;
    const needed = DOT / 2 + LEAD_MIN + caption + EDGE;
    let left = x < rect.width / 2;
    let room = left ? x : rect.width - x;
    if (room < needed && rect.width - room >= needed) {
      left = !left;
      room = rect.width - room;
    }
    const lead = Math.max(LEAD_MIN, Math.min(LEAD, room - DOT / 2 - caption - EDGE));

    marker.classList.toggle('is-left', left);
    marker.style.setProperty('--lead', Math.round(lead) + 'px');
    marker.style.transform = 'translate3d(' + x.toFixed(1) + 'px, ' + y.toFixed(1) + 'px, 0)';

    // Re-measure after layout and cut again if needed — the name can wrap,
    // so its actual width isn't known until rendered.
    const width = marker.offsetWidth;
    const over = left
      ? EDGE - (x + DOT / 2 - width)
      : x - DOT / 2 + width - (rect.width - EDGE);
    if (over > 0) {
      marker.style.setProperty('--lead', Math.round(Math.max(0, lead - over)) + 'px');
    }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    if (!visible) return;

    if (Math.abs(explodeTarget - explode) > 0.0005 || Math.abs(zoomTarget - zoomLevel) > 0.0005) {
      // a visitor who asked for less motion gets the state, not the journey
      const k = reduced ? 1 : Math.min(1, dt * EXPLODE_EASE);
      explode += (explodeTarget - explode) * k;
      zoomLevel += (zoomTarget - zoomLevel) * k;

      for (const part of parts) {
        part.node.position.copy(part.home).addScaledVector(part.offset, explode);
        part.anchor.position.copy(part.at).addScaledVector(part.offset, explode);
      }

      // Model shrinks/slides rather than camera moving, so user zoom/orbit is
      // preserved. Shift applied to the model (inside root) so it stays in the
      // model's own axes and isn't skewed by the swing rotation on root.
      const framed = shutRadius + (openRadius - shutRadius) * explode;
      root.scale.setScalar((shutRadius / framed) * zoomLevel);
      model.position.copy(centre).negate().addScaledVector(openShift, -explode);
      dirty = true;
    }

    if (swingAt > 0) {
      const k = (now - swingAt) / SWING_MS;
      if (k >= 1) {
        stopSwing();
      } else if (k > 0) {
        // out and back in one arc, so it ends on the pose it started from
        root.rotation.y = Math.sin(k * Math.PI) * SWING;
      }
      dirty = true;
    }

    if (controls.update(dt)) dirty = true;
    if (!dirty) return;
    dirty = false;

    placeMarker();
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);

  return {
    setExplode(value: number) {
      explodeTarget = Math.min(1, Math.max(0, value));
      invalidate();
    },

    select(node: string | null) {
      clearGlow();
      selected = parts.find((p) => p.spec.node === node) ?? null;
      if (selected) applyGlow(selected);
      invalidate();
    },

    zoom(factor: number) {
      // the model scales, not the camera, so one clamp covers both buttons
      // and no amount of clicking can push the thing through the near plane
      zoomTarget = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoomTarget * factor));
      invalidate();
    },

    resetView() {
      controls.target.set(0, 0, 0);
      camera.position.copy(START_DIR).multiplyScalar(baseDistance);
      controls.update();
      zoomTarget = 1;
      invalidate();
    },

    destroy() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      clearGlow();
      controls.removeEventListener('change', invalidate);
      controls.removeEventListener('start', stopSwing);
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        for (const m of materialsOf(mesh)) {
          if (m.map) m.map.dispose();
          m.dispose();
        }
      });
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
    }
  };
}
