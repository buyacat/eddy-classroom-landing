/**
 * Layout maths for the cut-away globe — no three.js dependency, so the
 * no-overlap invariant can be checked standalone (scripts/check-earth-layout.mjs).
 *
 * Invariant: two shells never occupy the same space, at any point in the gesture.
 */

/** A shell, as radii in Earth radii. Only the outer one matters to layout. */
export interface Shell {
  rIn: number;
  rOut: number;
}

/** Clear air left between two shells once they are apart. */
export const GAP = 0.14;

/** Floor on every step: the two cores are tiny but their captions aren't, so spacing accounts for label width too. */
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
 * Cuts the gesture into one extraction per pair of shells: the whole contents
 * come out of the crust first (as one rigid group), then the cores out of the
 * mantle, then the inner core out of the outer one — three moves, never two
 * at once, always outside-in. Each window is sized proportional to the
 * distance it covers.
 *
 * Consecutive windows overlap slightly so the cascade flows rather than
 * stopping dead three times. HANDOVER * GAP / d bounds that overlap assuming a
 * linear ramp; the real ramp is a smoothstep, so the margin comes out wider.
 * Tune it against `npm run check:layout`, which measures the actual clearance.
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
 * Where every shell sits at pull `e`, as distance along the cascade axis.
 * Shell 0 (crust) never moves — the contents come out of it. Every shell
 * inside stage i moves rigidly with it.
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
 * Push a row of captions off each other rather than clamping each
 * independently to the panel edges, which stacks several on top of one
 * another near the edges. Resolved left-to-right then right-to-left, so it
 * either fits all of them or fails visibly by overflowing the panel.
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
