/*
 * Layout maths for the cut-away globe.
 *
 * This is the half of the model that has a right answer, so it lives apart
 * from the three.js half that only has a look: how far each shell slides, in
 * what order, and where the four captions may sit without touching. It has no
 * imports, which is the point — the no-overlap contract below can be checked
 * on its own, and is (scripts/check-earth-layout.mjs).
 *
 * The rule the whole file exists to keep: two shells never occupy the same
 * space, at any point in the gesture — not just at the end of it.
 */

/** A shell, as radii in Earth radii. Only the outer one matters to layout. */
export interface Shell {
  rIn: number;
  rOut: number;
}

/** Clear air left between two shells once they are apart. */
export const GAP = 0.14;

/**
 * A floor on every step. The two cores are tiny but their names are not, and
 * the captions hang under the shells they name — so the row has to be spaced
 * for the words as well as for the geometry.
 */
export const TAG_GAP = 1.05;

/**
 * How far apart consecutive shells must end up: enough that their outermost
 * surfaces clear each other by GAP, or enough for the captions, whichever is
 * the larger. Index i is the distance between shell i and shell i + 1.
 */
export function stageDistances(shells: Shell[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < shells.length; i++) {
    out.push(Math.max(shells[i].rOut + shells[i - 1].rOut + GAP, TAG_GAP));
  }
  return out;
}

export interface Stage {
  /** where in the 0..1 pull this extraction begins and ends */
  from: number;
  to: number;
  /** how far the group travels during it */
  distance: number;
}

/**
 * The gesture, cut into one extraction per pair of shells.
 *
 * This is the fix for shells that used to slide through each other: they all
 * moved at once, in proportion, so for most of the pull every layer was still
 * buried inside the one outside it. Taking a nested object apart does not work
 * like that. You pull the whole contents out of the crust FIRST — as one solid
 * group, so nothing moves relative to anything else and nothing can intersect
 * — then pull the cores out of the mantle, then the inner core out of the
 * outer one. Three moves, never two at once, always outside-in.
 *
 * Each window is sized in proportion to the distance it covers, so the row
 * grows at a steady speed rather than lurching through the short steps.
 *
 * Consecutive windows are allowed to overlap by a little, so the cascade
 * flows instead of stopping dead three times — but only by as much as the
 * clearance can absorb. The next stage starts when this one is a fraction
 * HANDOVER * GAP / d short of its window, which under a LINEAR ramp would
 * leave the pair GAP * HANDOVER from touching: the conservative bound, and
 * the reason any value below 1 is safe.
 *
 * The real margin is far wider, because the ramp is a smoothstep and its tail
 * is flat. Measured: when the next stage begins, the pair behind it is still
 * ~0.130 clear against a GAP of 0.14 — a shortfall of about 0.01, not the
 * 0.077 the linear reading implies. So there is a lot of room here if the
 * cascade should ever flow more; the numbers to tune against are the ones
 * `npm run check` prints, not this comment.
 */
const HANDOVER = 0.55;

export function stageWindows(distances: number[]): Stage[] {
  const total = distances.reduce((a, b) => a + b, 0);
  const stages: Stage[] = [];
  let at = 0;
  for (let i = 0; i < distances.length; i++) {
    const span = distances[i] / total;
    stages.push({ from: at, to: at + span, distance: distances[i] });
    // the next stage may start this far before this one lands
    at += span * (1 - (GAP / distances[i]) * HANDOVER);
  }
  // the overlaps shorten the gesture; stretch it back out to the full pull
  const end = stages[stages.length - 1].to;
  for (const s of stages) {
    s.from /= end;
    s.to /= end;
  }
  return stages;
}

/** Ease each extraction in and out, so the cascade reads as three moves. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/** How far through its own extraction each stage is, at pull `e`. */
export function stageProgress(stages: Stage[], e: number): number[] {
  return stages.map((s) => smoothstep(s.from, s.to, e));
}

/**
 * Where every shell sits at pull `e`, as a distance along the cascade axis.
 *
 * Shell 0 — the crust — never moves: the contents come out of it, which is
 * both how you actually open a nested thing and the only direction that does
 * not drag a core backwards through the solid half of the planet. Every shell
 * inside stage i moves with it, so during a stage the group is rigid.
 */
export function offsets(stages: Stage[], progress: number[]): number[] {
  const out = new Array<number>(stages.length + 1).fill(0);
  for (let i = 1; i < out.length; i++) {
    out[i] = out[i - 1] + stages[i - 1].distance * progress[i - 1];
  }
  return out;
}

/** Full spread, for scaling and re-centring the open row. */
export function totalTravel(distances: number[]): number {
  return distances.reduce((a, b) => a + b, 0);
}

/**
 * The stage whose completion means shell `i` is standing on its own — and so
 * the moment its caption has earned the right to appear. The innermost shell
 * is freed by the last stage, like the one outside it.
 */
export function revealStage(i: number, stageCount: number): number {
  return Math.min(i, stageCount - 1);
}

/* ------------------------------------------------------- caption row */

export interface Placed {
  /** centre, in panel pixels */
  x: number;
  width: number;
}

/**
 * Push a row of captions off each other.
 *
 * Projecting each caption under its own shell and clamping it to the panel is
 * not enough: near the edges several of them clamp to the same place and end
 * up stacked. So the row is resolved instead — once left to right, once back
 * again — which either finds room for all of them or fails visibly by pushing
 * the row out of the panel, rather than silently printing one name on top of
 * another.
 *
 * `items` must already be in left-to-right order. Mutates and returns `x`.
 */
export function spreadRow(items: Placed[], left: number, right: number, pad: number): Placed[] {
  let edge = left;
  for (const it of items) {
    it.x = Math.max(it.x, edge + it.width / 2);
    edge = it.x + it.width / 2 + pad;
  }
  edge = right;
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    it.x = Math.min(it.x, edge - it.width / 2);
    edge = it.x - it.width / 2 - pad;
  }
  return items;
}
