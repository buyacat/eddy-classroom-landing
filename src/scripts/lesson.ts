/*
 * The hero's second beat: the visitor doesn't look at a lesson, they run one.
 *
 * Pulling the model apart is where the old hero stopped. Here that is only the
 * invitation — it hands over a button, and from there the whole loop of the
 * product plays out on one screen: a question goes to the class, twenty-two
 * pupils answer one by one, the answers pile up as bars on the layers
 * themselves, the right layer lights up inside the 3D scene, and the platform
 * tells the teacher what to do about the five who got it wrong.
 *
 * The last beat is the one that sells it in Ukraine: the connection drops and
 * the lesson does not.
 *
 * No dependencies, no assets. DOM plus CSS transitions, driven by a small
 * timeline of setTimeout steps — rAF is for the 3D, not for choreography.
 */
import type { GlobeHandle } from './earth';

export interface LessonRound {
  q: string;
  result: string;
}

export interface LessonCopy {
  ask: string;
  rounds: LessonRound[];
  answered: string;
  next: string;
  offlineState: string;
  offlineChip: string;
  again: string;
}

const CLASS_SIZE = 22;

/**
 * The three rounds, as votes per layer in layer order (crust, mantle, outer
 * core, inner core) plus which of them is right.
 *
 * One question was enough to prove the loop runs; three are what make it look
 * like a lesson, because the interesting part of the product is the SHAPE of
 * the answers changing. So none of these is a clean sweep and no two fail the
 * same way: the liquid layer splits between the two cores, the thinnest is
 * nearly unanimous, and the one about heat is the one a class actually gets
 * wrong — a third of them put the heat in the outer core.
 *
 * Every distribution sums to CLASS_SIZE. The check is worth stating because
 * a short round silently leaves dots unlit and the counter reading 20/22.
 */
interface Round {
  votes: number[];
  correct: number;
}

const ROUNDS: Round[] = [
  { votes: [1, 4, 17, 0], correct: 2 },
  { votes: [19, 2, 1, 0], correct: 0 },
  { votes: [0, 3, 5, 14], correct: 3 }
];

/** A pupil answers every 70-210 ms — uneven, because people are. */
const ANSWER_MIN = 70;
const ANSWER_MAX = 210;

interface Refs {
  ask: HTMLButtonElement;
  bar: HTMLElement;
  question: HTMLElement;
  dots: HTMLElement;
  answered: HTMLElement;
  result: HTMLElement;
  chip: HTMLElement;
}

/** Shuffled so the bars fill in a plausible order rather than block by block. */
function ballots(votes: number[]): number[] {
  const bag: number[] = [];
  votes.forEach((n, layer) => {
    for (let i = 0; i < n; i++) bag.push(layer);
  });
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

export function startLesson(
  root: HTMLElement,
  globe: GlobeHandle,
  copy: LessonCopy,
  outside: { liveText: HTMLElement | null; roster: HTMLElement | null }
): () => void {
  const q = <T extends HTMLElement>(sel: string) => root.querySelector<T>(sel);

  const refs: Refs = {
    ask: q<HTMLButtonElement>('[data-ask]')!,
    bar: q('[data-lesson-bar]')!,
    question: q('[data-q]')!,
    dots: q('[data-dots]')!,
    answered: q('[data-answered]')!,
    result: q('[data-result]')!,
    chip: q('[data-chip]')!
  };
  if (Object.values(refs).some((el) => !el)) return () => {};

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timers: number[] = [];
  const after = (ms: number, fn: () => void) => {
    timers.push(window.setTimeout(fn, reduced ? 0 : ms));
  };
  const clear = () => {
    timers.splice(0).forEach(clearTimeout);
  };

  // ---- the class ----
  const dots: HTMLElement[] = [];
  for (let i = 0; i < CLASS_SIZE; i++) {
    const dot = document.createElement('i');
    refs.dots.appendChild(dot);
    dots.push(dot);
  }

  // ---- turn every layer tag into an answer option ----
  const options: { tag: HTMLElement; fill: HTMLElement; count: HTMLElement }[] = [];
  for (let i = 0; i < ROUNDS[0].votes.length; i++) {
    const tag = globe.tag(i);
    if (!tag) continue;

    const count = document.createElement('span');
    count.className = 'globe-tag-count';
    tag.appendChild(count);

    const bar = document.createElement('span');
    bar.className = 'globe-tag-bar';
    const fill = document.createElement('i');
    bar.appendChild(fill);
    tag.appendChild(bar);

    tag.addEventListener('click', () => {
      if (!root.classList.contains('is-quiz')) return;
      tag.classList.add('is-picked');
      reveal();
    });

    options.push({ tag, fill, count });
  }

  refs.ask.textContent = copy.ask;

  // ---- state ----
  let phase: 'idle' | 'asking' | 'polling' | 'done' = 'idle';
  const tally = [0, 0, 0, 0];
  let answered = 0;
  /* Which of the three is on the board. It survives a reset — asking again
     moves the class ON to the next question rather than re-running the one
     they have just answered — and wraps at the end, so the panel can be left
     running without ever showing an exhausted state. */
  let round = 0;
  const votes = () => ROUNDS[round].votes;
  const correct = () => ROUNDS[round].correct;
  const last = () => round === ROUNDS.length - 1;

  function showQuestion() {
    refs.question.textContent = copy.rounds[round]?.q ?? '';
  }
  showQuestion();

  function paint() {
    refs.answered.textContent = String(answered);
    // the roster badge already runs its own count-up on load; only take it over
    // once the visitor has actually asked the class something
    if (outside.roster && phase !== 'idle') {
      outside.roster.textContent = answered + '/' + CLASS_SIZE;
    }
    options.forEach((o, i) => {
      o.fill.style.width = (tally[i] / CLASS_SIZE) * 100 + '%';
      o.count.textContent = tally[i] ? String(tally[i]) : '';
    });
  }

  function poll() {
    const bag = ballots(votes());
    const tick = (n: number) => {
      if (n >= bag.length) {
        after(420, reveal);
        return;
      }
      tally[bag[n]]++;
      answered++;
      dots[n].classList.add('is-in');
      paint();
      after(ANSWER_MIN + Math.random() * (ANSWER_MAX - ANSWER_MIN), () => tick(n + 1));
    };
    tick(0);
  }

  function reveal() {
    if (phase === 'done') return;
    phase = 'done';
    clear();

    // if the visitor cut the poll short by answering, finish it on paper
    answered = CLASS_SIZE;
    votes().forEach((n, i) => { tally[i] = n; });
    dots.forEach((d) => d.classList.add('is-in'));
    paint();

    root.classList.remove('is-quiz');
    root.classList.add('is-marked');
    options[correct()]?.tag.classList.add('is-correct');
    globe.flash(correct(), 900);

    refs.result.textContent = copy.rounds[round]?.result ?? '';
    root.classList.add('is-result');

    /* The dropped connection is a story point, not a feature of every round:
       it lands once, after the first question, where it reads as "and this
       kept working". Told three times it would read as a flaky product. */
    if (round === 0) {
      after(2200, offline);
    } else {
      after(1400, arm);
    }
  }

  /** Put the button back, labelled with what it will actually do next. */
  function arm() {
    refs.ask.textContent = last() ? copy.again : copy.next;
    root.classList.add('is-again');
  }

  function offline() {
    const live = outside.liveText;
    const was = live?.textContent ?? '';
    document.documentElement.classList.add('lesson-offline');
    // the pill is green for LIVE; a dropped line must not read as a good state
    live?.parentElement?.classList.add('is-down');
    if (live) live.textContent = copy.offlineState;
    refs.chip.textContent = copy.offlineChip;
    root.classList.add('is-offline');

    after(1900, () => {
      document.documentElement.classList.remove('lesson-offline');
      live?.parentElement?.classList.remove('is-down');
      if (live) live.textContent = was;
      root.classList.remove('is-offline');
      arm();
    });
  }

  function ask() {
    if (phase !== 'idle' && phase !== 'done') return;

    /*
     * Finished a round. "Next question" has to BE the next question — clearing
     * the board and then waiting for a second click on a button that has
     * quietly renamed itself back to "ask the class" is a dead beat, and it
     * was the first thing that looked broken when three questions replaced
     * one. So the middle rounds wipe the slate and go straight on, with the
     * model left open and compact: nothing folds up only to unfold again.
     *
     * The end of the set is the exception. There the panel really is starting
     * over, so the model closes and hands the invitation back, exactly as it
     * did the first time.
     */
    if (phase === 'done') {
      const wrapping = last();
      round = wrapping ? 0 : round + 1;
      reset(!wrapping);
      if (wrapping) return;
    }
    phase = 'polling';
    root.classList.remove('is-invited');
    root.classList.add('is-quiz', 'is-polling');
    globe.open(true);
    globe.compact(true);
    after(reduced ? 0 : 520, poll);
  }

  function reset(keepOpen = false) {
    clear();
    phase = 'idle';
    answered = 0;
    tally.fill(0);
    dots.forEach((d) => d.classList.remove('is-in'));
    options.forEach((o) => o.tag.classList.remove('is-correct', 'is-picked'));
    root.classList.remove('is-polling', 'is-marked', 'is-result', 'is-again', 'is-offline');
    refs.result.textContent = '';
    showQuestion();
    paint();
    if (keepOpen) return;
    globe.compact(false);
    // and hand the model back: `ask` latched it apart, and nothing else ever
    // unlatches it, so without this the hero stays exploded and stone still
    // — the idle rock is damped off for as long as it is held open
    globe.open(false);
    root.classList.add('is-invited');
    refs.ask.textContent = copy.ask;
  }

  refs.ask.addEventListener('click', ask);

  // the button only appears once the visitor has actually opened the model —
  // it is the reward for the first gesture, not a call to action sitting there
  globe.onOpen(() => {
    if (phase === 'idle') root.classList.add('is-invited');
  });

  // pull straight past the end of the travel and you have said "go on then" —
  // the question comes up without asking for a second gesture
  globe.onOverpull(() => {
    if (phase === 'idle') ask();
  });

  paint();

  return () => {
    clear();
    refs.ask.removeEventListener('click', ask);
  };
}
