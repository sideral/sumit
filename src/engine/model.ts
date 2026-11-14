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
 * Each problem is described by features: column facts like "7+8" (and "8+7" as
 * written — order matters), carries, chained carries, borrowing through zero, digits
 * present, which operand comes first... An online regression learns how much each
 * feature adds to (or removes from) your time, so overlapping features share credit.
 *
 * To pick a problem we draw many random candidates within the mode's constraints,
 * score each by its predicted slow-down for you, and sample one with softmax — so hard
 * patterns come up more often, easy ones less, and nothing disappears entirely.
 * (Per-feature moving averages are kept too, for inspection and exploration.)
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
  /** Additive per-feature effects on log2(time / shape baseline), learned online (for predictions). */
  private reg = new Map<string, number>();

  reset() {
    this.feats.clear();
    this.shapes.clear();
    this.reg.clear();
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

    // online least-squares: nudge each present feature's effect toward the residual
    const err = struggle - this.regDev(features);
    const lr = 0.6 / features.length;
    for (const k of features) {
      const w = this.reg.get(k) ?? 0;
      this.reg.set(k, w * 0.999 + lr * err);
    }

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

  /**
   * How long *you* would usually take on this problem: your typical time for its shape,
   * times 2^(sum of the learned effects of its features — facts, carries, borrows,
   * digits). The effects come from an online regression, so overlapping features
   * (e.g. "7+8" and "carry") share the credit instead of double-counting.
   */
  predictMs(p: Problem) {
    const { features, shape } = analyze(p);
    return this.expectedMs(shape) * Math.pow(2, this.regDev(features));
  }

  private regDev(features: string[]) {
    let d = 0;
    for (const k of features) d += this.reg.get(k) ?? 0;
    return Math.max(-1.5, Math.min(2, d));
  }

  logWeight(op: Op, feature: string) {
    const s = this.feats.get(feature);
    if (!s || s.n === 0) return UNSEEN_BONUS;
    const shrink = s.n / (s.n + SHRINK_K);
    const d = GAIN * shrink * (s.ema - this.global[op].ema);
    return Math.max(-1.5, Math.min(1.5, d));
  }

  /**
   * How much harder than usual this problem is predicted to be for you (log2 of the
   * expected slow-down, from the regression), plus a small bonus for patterns you
   * haven't met yet so they get tried.
   */
  scoreProblem(p: Problem) {
    const { features } = analyze(p);
    const unseen = features.filter((k) => !this.feats.get(k)?.n).length;
    return this.regDev(features) + (UNSEEN_BONUS * unseen) / features.length;
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

  /**
   * The whole problem list for a round, drawn up front from what the model knows now,
   * each with its time prediction. Nothing learned during the round changes it — the
   * next round is the first to use the new evidence.
   */
  plan(op: Op, mode: Mode, count: number): { problem: Problem; pred: number }[] {
    const out: { problem: Problem; pred: number }[] = [];
    const recent: Problem[] = [];
    for (let i = 0; i < count; i++) {
      const problem = this.pick(op, mode, recent);
      out.push({ problem, pred: this.predictMs(problem) });
      recent.push(problem);
      if (recent.length > 6) recent.shift();
    }
    return out;
  }

  /** For inspection / tests. */
  weights(op: Op) {
    return [...this.feats.entries()]
      .filter(([k]) => k.startsWith(op === 'add' ? 'a:' : 's:'))
      .map(([k, s]) => ({ k, n: s.n, w: this.logWeight(op, k) }))
      .sort((x, y) => y.w - x.w);
  }
}
