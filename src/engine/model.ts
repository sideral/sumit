import { analyze, randomProblem, type Mode, type Op, type Problem } from './problem';

/**
 * Adaptive problem picker.
 *
 * Every attempt yields a "struggle" signal:
 *   skipped        -> 2
 *   solved         -> log2(time / expected time for that shape) + 0.5 per wrong full-length
 *                     entry, clamped to [-1, 2]
 * Expected time per shape (e.g. 2-digit + 1-digit) is learned, so the signal measures
 * "slower/faster than you usually are on problems of this size", not raw size.
 *
 * Each feature the problem exercises (column facts like "7+8" or "13-6", carries,
 * chained carries, borrowing through zero, digits present...) keeps an exponential
 * moving average of that signal. A feature's weight is how much worse than your
 * overall average you do when it is present, shrunk toward 0 while evidence is thin.
 *
 * To pick a problem we draw many random candidates within the mode's constraints,
 * score each by the weights of its features, and sample one with softmax — so hard
 * patterns come up more often, easy ones less, and nothing disappears entirely.
 */

export interface AttemptLike {
  op: Op;
  a: number;
  b: number;
  correct: boolean;
  ms: number;
  misses?: number;
  skipped?: boolean;
}

interface Stat { n: number; ema: number }

const ALPHA_FLOOR = 0.06; // ~ last 30 observations dominate
const SHRINK_K = 4;
const GAIN = 1.3;
const UNSEEN_BONUS = 0.25;
const BETA = 1.8;
const CANDIDATES = 48;

function push(s: Stat, x: number) {
  const alpha = Math.max(1 / (s.n + 1), ALPHA_FLOOR);
  s.ema = s.n === 0 ? x : s.ema + alpha * (x - s.ema);
  s.n++;
}

function priorMs(shape: string) {
  const [op, dims] = shape.split(':');
  const [x, y] = dims.split('x').map(Number);
  return (900 + 700 * (x + y)) * (op === 'sub' ? 1.25 : 1);
}

export class Model {
  private feats = new Map<string, Stat>();
  private global: Record<Op, Stat> = { add: { n: 0, ema: 0 }, sub: { n: 0, ema: 0 } };
  private shapes = new Map<string, Stat>();

  reset() {
    this.feats.clear();
    this.shapes.clear();
    this.global = { add: { n: 0, ema: 0 }, sub: { n: 0, ema: 0 } };
  }

  expectedMs(shape: string) {
    const prior = priorMs(shape);
    const s = this.shapes.get(shape);
    if (!s || s.n === 0) return prior;
    const w = s.n / (s.n + 3);
    return Math.exp(w * s.ema + (1 - w) * Math.log(prior));
  }

  observe(at: AttemptLike) {
    const { features, shape } = analyze({ op: at.op, a: at.a, b: at.b, answer: 0 });
    const ms = Math.max(at.ms, 150);
    const failed = at.skipped || !at.correct;
    const misses = at.misses ?? 0;
    const struggle = failed
      ? 2
      : Math.min(2, Math.max(-1, Math.log2(ms / this.expectedMs(shape)) + 0.5 * misses));

    if (!failed && !misses) {
      let s = this.shapes.get(shape);
      if (!s) this.shapes.set(shape, (s = { n: 0, ema: 0 }));
      push(s, Math.log(Math.min(ms, priorMs(shape) * 6)));
    }
    push(this.global[at.op], struggle);
    for (const k of features) {
      let s = this.feats.get(k);
      if (!s) this.feats.set(k, (s = { n: 0, ema: 0 }));
      push(s, struggle);
    }
  }

  logWeight(op: Op, feature: string) {
    const s = this.feats.get(feature);
    if (!s || s.n === 0) return UNSEEN_BONUS;
    const shrink = s.n / (s.n + SHRINK_K);
    const d = GAIN * shrink * (s.ema - this.global[op].ema);
    return Math.max(-1.5, Math.min(1.5, d));
  }

  scoreProblem(p: Problem) {
    const { features } = analyze(p);
    let sum = 0;
    let max = -Infinity;
    for (const k of features) {
      const w = this.logWeight(p.op, k);
      sum += w;
      if (w > max) max = w;
    }
    return sum / features.length + 0.5 * max;
  }

  pick(op: Op, mode: Mode, recent: Problem[] = []): Problem {
    const seen = new Set(recent.map((p) => `${p.a},${p.b}`));
    const cands: Problem[] = [];
    for (let i = 0; i < CANDIDATES * 3 && cands.length < CANDIDATES; i++) {
      const p = randomProblem(op, mode);
      if (!seen.has(`${p.a},${p.b}`)) cands.push(p);
    }
    if (!cands.length) return randomProblem(op, mode);
    const scores = cands.map((p) => BETA * this.scoreProblem(p));
    const m = Math.max(...scores);
    const ws = scores.map((s) => Math.exp(s - m));
    let r = Math.random() * ws.reduce((x, y) => x + y, 0);
    for (let i = 0; i < cands.length; i++) if ((r -= ws[i]) <= 0) return cands[i];
    return cands[cands.length - 1];
  }

  /** For inspection / tests. */
  weights(op: Op) {
    return [...this.feats.entries()]
      .filter(([k]) => k.startsWith(op === 'add' ? 'a:' : 's:'))
      .map(([k, s]) => ({ k, n: s.n, w: this.logWeight(op, k) }))
      .sort((x, y) => y.w - x.w);
  }
}
