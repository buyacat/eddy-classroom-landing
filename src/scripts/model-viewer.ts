/*
 * The library band's one real model: a glTF file off the client's own shelf,
 * turned and taken apart in the page.
 *
 * Why this exists at all. The comb above it shows 1200+ models as coloured
 * cells with a rendered object in each, and the client's note about tenders
 * was that a cell is not evidence — a buyer wants to see the thing itself.
 * So one model out of the catalogue is shipped whole and handed over: drag to
 * turn, a slider to pull it apart, a list of its structures with what each of
 * them does. Everything the hero globe does, except that this one is a FILE,
 * and that is the point being made.
 *
 * What this module is not: a general glTF viewer. It knows the scene is a
 * flat list of named nodes and that a part's caption lives in the translated
 * content next to its node name. Everything that is a fact about ONE model —
 * where a caption hangs, which way a part travels when the model opens, how
 * far apart the parts end up, which of them travel as one piece — is handed
 * in by the caller (src/data/models.json), because the band now carries nine
 * of them and they differ in every one of those numbers.
 *
 * Scene graph:
 *
 *   root     scaled as the model opens, so the exploded state stays framed
 *    │       without moving the camera out from under the visitor's drag
 *    └ scene the glTF, shifted so the model's own centre sits on the origin
 *       ├ Sclera, Choroid, … each pushed along its own explode direction
 *       └ anchors            one per part, moved with it, for the caption
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

/**
 * Where a part's caption points, and which way the part travels when the
 * model comes apart. Both are facts about one model in its own coordinates,
 * not about a language — a Ukrainian hotspot and an English one are the same
 * three numbers — so they are shipped alongside the file in models.json and
 * handed to `mountViewer` rather than translated.
 *
 * `out` may be missing: a part that already sits well off centre leaves in
 * the direction it is already in, which the fallback below works out for
 * itself. So may `at`, and then the caption hangs on the part's own middle.
 */
export interface PartGeometry {
  /** the point the caption points at, in model space */
  at?: [number, number, number];
  /** direction the part travels when the model opens; normalised on use */
  out?: [number, number, number];
}

/**
 * How far apart the parts of one model end up, as a multiple of its own size,
 * and which of them have to travel together.
 *
 * Every model was authored against a factor of its own — an eye opens to 2.2,
 * a Newton's cradle to 1.5 — and the spacing rule below is the one the source
 * viewer applies, kept term for term on purpose: the directions were tuned
 * against it, and a tidier formula would send two of them through each other.
 *
 * A group is a set of parts that must not come apart from each other: the
 * membrane and the sugar chains standing on it, a frame and the wires hanging
 * from it. They are offset as one body — one direction, one distance, solved
 * on the box around all of them — so what is drawn on one stays on it.
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

/**
 * The callout. LEAD is the length the client asked for — far enough that the
 * name stands well off the silhouette — and LEAD_MIN is as short as the line
 * may be cut before the name would leave the stage. DOT matches the CSS.
 */
const DOT = 10;
const LEAD = 92;
const LEAD_MIN = 26;
/** Clear air kept between the callout and the edge of the stage. */
const EDGE = 12;

/** How far in and out the zoom buttons may take the model. */
const ZOOM_MIN = 0.45;
const ZOOM_MAX = 1.6;

/**
 * The invitation: once, shortly after the model arrives, it swings a little
 * way round and comes back.
 *
 * Not a continuous auto-rotate, which was the first thing tried. A model that
 * never stops turning holds a GPU at 60Hz for as long as the tab is open, it
 * drifts away from the pose the shot was composed for, and it reads as a
 * video — the one thing this panel exists to prove it is not. A swing that
 * returns says "this turns, and you are the one who turns it", and then the
 * scene goes quiet.
 */
const SWING = 0.5;
const SWING_MS = 2600;
const SWING_DELAY = 500;

/**
 * The highlight. Emissive rather than a colour swap, because half of these
 * materials are transparent gels and a flat tint on them reads as a bug; warm
 * rather than brand blue, because the parts that most need pointing out (the
 * lens, the aqueous, the vitreous) are already pale blue themselves.
 */
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
 * A bounding sphere tight enough to frame a model by.
 *
 * `Box3.getBoundingSphere` circumscribes the BOX, so for this model — 2.7
 * wide, 2.0 tall, 1.0 deep — it hands back a radius of 1.74 for something
 * that is 1.35 at its longest. Framed on that the eye sat in the middle of
 * the stage at two thirds the size it could have been, with a quarter of the
 * panel empty all the way round.
 *
 * Geometry bounding spheres are computed from the vertices themselves, so a
 * hollow shell reports the radius of the shell and not of a cube around it.
 * Gathering them around the box's centre stays conservative — nothing ever
 * pokes out — while giving back most of the room the box was wasting.
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

  /*
   * A room, not a sky. These materials are mostly clear gels and wet tissue:
   * with nothing structured to reflect, the lens and the vitreous come out as
   * grey fog. RoomEnvironment is generated, so it costs one render pass at
   * mount and nothing at all on the network.
   */
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

  /*
   * Explode offsets are solved in the model's ORIGINAL coordinates, before it
   * is re-centred below: the rule measures how far each part already sits
   * from the model's own origin, and shifting the whole thing first would
   * quietly change every one of those distances.
   */
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

  /*
   * Where a part goes when the model opens.
   *
   * The travel grows with how far out the part already sits. The shells that
   * wrap the whole eye barely move — they only have to clear each other —
   * while the lens and the iris start bunched at one pole and have to come
   * right out before there is anything to see.
   */
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

  /*
   * Grouped parts are solved before anything else, on the box around the
   * whole group and in the direction of its first member, so that each of
   * them is handed the SAME offset below. Solved one by one they would fan
   * out from their own centres, and the sugar chains would walk off the
   * membrane they are drawn standing on.
   */
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

  /*
   * The open state is not the shut one grown outwards: the eye throws nine
   * parts toward the cornea and the optic nerve the other way entirely, so the
   * cloud's centre is a long way from the eyeball's. Framed on the shut centre
   * the open view drifted into the right half of the stage and shrank to fit
   * the nerve trailing off the left. So the framing has its own centre and its
   * own radius, and the root travels between the two as the slider moves.
   *
   * Centre first — the midpoint of the extremes, so no part is favoured for
   * being large — then the radius as the furthest any part reaches from it.
   * A box's own bounding sphere would do neither job: it circumscribes the
   * corners of a box nothing occupies, and the open model would come out a
   * third smaller than it needs to be.
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

  // the shut state is framed on the model's own centre, because that is the
  // point the camera orbits and a framing that drifted off it would tilt the
  // whole drag
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
  /*
   * The wheel belongs to the page.
   *
   * OrbitControls' own zoom calls preventDefault on every wheel event over
   * the canvas, which on a landing page means a reader scrolling past this
   * band gets stuck inside it, zooming an eyeball they never asked to zoom.
   * Two fingers are no better — a pinch here would fight the page's own. So
   * zooming is a pair of buttons instead (see zoom()), which has the second
   * benefit of being reachable from a keyboard.
   */
  controls.enableZoom = false;
  /*
   * `pan-y`, replacing the `none` OrbitControls writes on connect: a finger
   * dragged up or down the model scrolls the page, exactly as a finger
   * anywhere else on the page does, and only a sideways drag turns the model.
   * Vertical orbit by touch is the price, and it is the right one — a viewer
   * that traps the scroll on a phone is a viewer people escape by closing the
   * tab.
   */
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

  /*
   * Rendered on demand, not on a clock. Nothing in this scene moves unless a
   * visitor moves it, and a band most readers scroll straight past has no
   * business holding a GPU at 60Hz for the length of the page.
   */
  let dirty = true;
  let visible = true;
  let raf = 0;
  let last = performance.now();

  /* When the swing runs, or -1 once it has been spent. A hand on the model at
     any point during it cancels it: at that moment the demonstration would be
     arguing with the very gesture it exists to teach. */
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

  /*
   * The callout: a dot on the geometry, a hairline off it, the name at the
   * end of the line and clear of the model.
   *
   * Which side the line leaves on is decided every frame, not fixed, because
   * the visitor turns the model and the point being named can end up
   * anywhere. It goes OUTWARD — away from the middle of the stage, which is
   * where the model is — so the line leaves the silhouette instead of
   * crossing it. It flips inward only when the outward side has no room for
   * the leader and the words, and when neither side has room the leader is
   * cut short rather than the name allowed off the edge.
   */
  function placeMarker() {
    if (!selected) {
      marker.hidden = true;
      return;
    }
    // unhidden before it is measured: a hidden element is 0 wide, and every
    // callout would spend its first frame with a full-length leader
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

    /* Then measure what was actually laid out, and cut the leader again if the
       row still runs off the stage. The name is allowed to wrap, so its width
       is not a thing the arithmetic above can be sure of — and a caption half
       off the panel is exactly the failure this callout replaced. */
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

      /* The model shrinks and slides rather than the camera pulling back and
         panning, so a visitor who has zoomed or turned it keeps what they set
         while the parts fan out — and the framing is exact rather than a
         guess, because both centres and both radii were measured off the
         geometry at load.

         The slide is written onto the MODEL, inside the root, so that it is
         expressed in the model's own axes: the root also carries the swing
         below, and a shift applied outside a rotation would send the open
         cloud off in whatever direction the model happened to be facing. */
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
