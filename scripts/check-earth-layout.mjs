/*
 * The no-overlap contract for the hero globe, checked rather than asserted in
 * a comment. Run with `npm run check`.
 *
 * It samples the whole gesture, not just the ends: the bug this exists to stop
 * came back three times as "it looks right when it is open", and it was never
 * the open state that was wrong.
 */
import {
  GAP,
  offsets,
  spreadRow,
  stageDistances,
  stageProgress,
  stageWindows
} from '../src/scripts/earth-layout.ts';

const SHELLS = [
  { rIn: 0.978, rOut: 1 },
  { rIn: 0.546, rOut: 0.978 },
  { rIn: 0.192, rOut: 0.546 },
  { rIn: 0, rOut: 0.192 }
];
// the cloud shell rides 0.19% above the crust and is the true outer surface
const OUTER = SHELLS.map((s, i) => (i === 0 ? s.rOut * 1.0019 : s.rOut));
const STEPS = 2000;

const distances = stageDistances(SHELLS);
const stages = stageWindows(distances);

let failed = 0;
/** Each test reports on its own, so one failure cannot silence the others. */
function test(name, run) {
  const before = failed;
  const note = run((msg) => { failed++; console.error('  FAIL  ' + msg); });
  if (failed === before) console.log('  ok    ' + (note || name));
}

console.log('stages:', stages.map((s) => `${s.from.toFixed(3)}->${s.to.toFixed(3)} d=${s.distance.toFixed(3)}`).join('  '));

/*
 * 1. At every point in the pull each pair of shells is in one of three honest
 *    states: still nested and rigid (concentric, reads as one solid object),
 *    clear of each other, or the single pair currently being pulled apart.
 *    What must never happen is a pair sitting half inside each other while
 *    some other pair is the one moving — that is the "layers climbing over
 *    each other" the sequential cascade exists to stop.
 */
test('cascade is sequential', (fail) => {
  let inflight = 0;
  let at = 0;
  for (let step = 0; step <= STEPS; step++) {
    const e = step / STEPS;
    const pos = offsets(stages, stageProgress(stages, e));
    let moving = 0;
    for (let i = 1; i < pos.length; i++) {
      const d = pos[i] - pos[i - 1];
      if (d > 1e-6 && d < OUTER[i] + OUTER[i - 1]) moving++;
      if (pos[i] < pos[i - 1] - 1e-9) fail(`shell ${i} is behind ${i - 1} at e=${e.toFixed(3)}`);
    }
    if (moving > inflight) { inflight = moving; at = e; }
  }
  if (inflight > 1) fail(`${inflight} pairs are half-apart at once (e=${at.toFixed(3)}) — the cascade is not sequential`);
  return 'only ever one pair is coming apart at a time';
});

/*
 * 2. And once a pair HAS come apart it stays apart. This is where the handover
 *    between stages is actually paid for, so the tightest residual is printed:
 *    it is the number to tune HANDOVER against, and the comment in
 *    earth-layout.ts quotes it.
 */
test('finished pairs hold their clearance', (fail) => {
  let worst = { e: 0, pair: '', clear: Infinity };
  for (let step = 0; step <= STEPS; step++) {
    const e = step / STEPS;
    const p = stageProgress(stages, e);
    const pos = offsets(stages, p);
    for (let i = 1; i < pos.length; i++) {
      if (p[i - 1] < 0.999) continue;                    // this pair is done
      const clear = pos[i] - pos[i - 1] - OUTER[i] - OUTER[i - 1];
      if (clear < worst.clear) worst = { e, pair: `${i - 1}/${i}`, clear };
    }
  }
  if (worst.clear < GAP - 0.02) {
    fail(`pair ${worst.pair} settles only ${worst.clear.toFixed(4)} apart at e=${worst.e.toFixed(3)}`);
  }
  /*
   * The handover itself: how much clearance a pair has at the exact moment the
   * NEXT extraction starts to move. This is what HANDOVER buys and what the
   * comment in earth-layout.ts quotes, so it is measured here rather than
   * reasoned about there — the eased ramp makes it far wider than the linear
   * bound suggests.
   */
  const margins = [];
  for (let i = 0; i + 1 < stages.length; i++) {
    const at = stages[i + 1].from;
    const p = stageProgress(stages, at);
    const pos = offsets(stages, p);
    const clear = pos[i + 1] - pos[i] - OUTER[i + 1] - OUTER[i];
    margins.push(clear);
    if (clear < 0) fail(`pair ${i}/${i + 1} is still ${(-clear).toFixed(4)} inside itself when stage ${i + 1} starts`);
  }
  return `tightest finished pair ${worst.clear.toFixed(4)} clear (${worst.pair}); at each handover `
    + margins.map((m) => m.toFixed(4)).join(' / ') + ` still clear, against GAP ${GAP}`;
});

/* 3. The open state is exactly the one the design was signed off on. */
test('open row unchanged', (fail) => {
  const open = offsets(stages, stageProgress(stages, 1));
  const want = [0, 2.118, 3.782, 4.832];
  open.forEach((v, i) => {
    if (Math.abs(v - want[i]) > 1e-6) fail(`shell ${i} lands at ${v.toFixed(4)}, expected ${want[i]}`);
  });
  return 'open row unchanged: ' + open.map((v) => v.toFixed(3)).join(', ');
});

/*
 * 4. Captions never sit on top of each other.
 *
 * Mirrors what the frame loop actually does: four captions dealt into two
 * staggered rows by index, the same right-hand inset the loop reserves for the
 * floating tool badges, and widths that include the vote count and the bar the
 * lesson appends after mount. The last width in each list is deliberately too
 * wide for the panel — the row must then run off the left edge, visibly, and
 * still never overlap, which is the documented failure mode.
 */
test('captions never overlap', (fail) => {
  const insetRight = (w) => (w < 500 ? 8 : Math.max(48, w * 0.11));
  const PAD = 8;
  let tightest = Infinity;

  for (const width of [1200, 900, 760, 620, 520, 420, 360]) {
    for (const tag of [110, 150, 175, 200, width]) {
      // both the spread-out row and the worst case, every caption wanting the
      // same spot hard against one edge
      for (const want of [(i) => (i / 3) * width, () => width, () => 0]) {
        const all = [0, 1, 2, 3].map((i) => ({ x: want(i), width: tag }));
        for (const row of [[all[0], all[2]], [all[1], all[3]]]) {
          spreadRow(row, 6, width - insetRight(width), PAD);
          for (let i = 1; i < row.length; i++) {
            const clear = row[i].x - row[i - 1].x - (row[i].width + row[i - 1].width) / 2;
            tightest = Math.min(tightest, clear);
            if (clear < PAD - 0.001) {
              fail(`captions ${tag}px collide at ${width}px panel (clearance ${clear.toFixed(1)}px)`);
            }
          }
        }
      }
    }
  }
  return `captions stay ${tightest.toFixed(1)}px apart at worst, 360px to 1200px panels`;
});

console.log(failed ? `\n${failed} failure(s)` : '\nall good');
process.exit(failed ? 1 : 0);
