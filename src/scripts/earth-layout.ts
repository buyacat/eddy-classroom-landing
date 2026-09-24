export interface Shell {
  rIn: number;
  rOut: number;
}

export const GAP = 0.14;

export const TAG_GAP = 1.05;

export function stageDistances(shells: Shell[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < shells.length; i++) {
    out.push(Math.max(shells[i].rOut + shells[i - 1].rOut + GAP, TAG_GAP));
  }
  return out;
}

export interface Stage {
  from: number;
  to: number;
  distance: number;
}

const HANDOVER = 0.55;

export function stageWindows(distances: number[]): Stage[] {
  const total = distances.reduce((a, b) => a + b, 0);
  const stages: Stage[] = [];
  let at = 0;
  for (let i = 0; i < distances.length; i++) {
    const span = distances[i] / total;
    stages.push({ from: at, to: at + span, distance: distances[i] });
    at += span * (1 - (GAP / distances[i]) * HANDOVER);
  }
  const end = stages[stages.length - 1].to;
  for (const s of stages) {
    s.from /= end;
    s.to /= end;
  }
  return stages;
}

export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function stageProgress(stages: Stage[], e: number): number[] {
  return stages.map((s) => smoothstep(s.from, s.to, e));
}

export function offsets(stages: Stage[], progress: number[]): number[] {
  const out = new Array<number>(stages.length + 1).fill(0);
  for (let i = 1; i < out.length; i++) {
    out[i] = out[i - 1] + stages[i - 1].distance * progress[i - 1];
  }
  return out;
}

export function totalTravel(distances: number[]): number {
  return distances.reduce((a, b) => a + b, 0);
}

export function revealStage(i: number, stageCount: number): number {
  return Math.min(i, stageCount - 1);
}

export interface Placed {
  x: number;
  width: number;
}

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
