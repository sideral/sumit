/**
 * Score = altitude in metres relative to Camp (0 m) = your usual performance.
 *
 * Every round yields a pace index:
 *     P = Σ predicted time / Σ actual time   (over the problems you solved)
 * "Predicted" is the adaptive model's estimate — made *before* you answered — of how
 * long you usually take on that exact kind of problem (its digit sizes, carries,
 * borrows, specific facts like 7+8). So difficulty is judged against your own history:
 * a round full of your weak spots isn't held against you. P > 1 = quicker than predicted.
 * Only time counts — no errors.
 * The problem still open when time runs out counts too: its time is all spent, and it
 * earns credit for at most its predicted time. So stalling on it can only lower P, while
 * being cut off mid-problem at your usual speed leaves P unchanged.
 *
 * Your "usual" is the distribution of ln(P) over *all* your previous rounds of the same
 * operation (all modes and durations), each weighted by how long ago it was:
 * weight = ½^(age / 60 days) — 2 months ago counts half, 1 year ago ~1.6%.
 * Nothing is cut off; old rounds just fade. μ and σ are the weighted mean and spread.
 * The score is how many σ this round sits above or below μ:
 *     altitude = 4 425 m · (ln P − μ) / σ
 * so   a usual round        →      0 m (Camp)
 *      1σ better than usual → +4 425 m
 *      2σ better            → +8 850 m (summit: ~1 in 44 rounds by chance alone,
 *                                       ~22% faster than usual at a 10% spread)
 *      worse than usual     → negative (the abyss)
 * The plain-language line under the score is e^(ln P − μ): "15% faster than usual".
 *
 * With little (recent) history σ is unreliable, so it's blended with a prior spread
 * (≈10%) that fades out as the effective number of rounds grows. Your first round with an operation sets Camp: 0 m.
 */

export const EVEREST = 8849;
export const SIGMA_M = 4425; // metres per standard deviation; summit ≈ +2σ
export const HALF_LIFE_DAYS = 60;
const DAY = 86_400_000;
const PRIOR_SD = 0.1; // ln-units, ≈ 10% speed variation
const PRIOR_WEIGHT = 4; // in rounds
const MIN_SD = 0.03;

export interface Solve {
  /** Model's personal time prediction for the problem, taken before answering. */
  pred: number;
  ms: number;
  solved: boolean;
}

/** The problem on screen when time ran out. */
export interface Open { pred: number; ms: number }

export function speedIndex(items: Solve[], open?: Open | null) {
  let pred = 0;
  let spent = 0;
  for (const it of items) {
    spent += Math.max(it.ms, 150);
    if (it.solved) pred += it.pred;
  }
  if (open && open.ms > 0) {
    spent += open.ms;
    pred += Math.min(open.ms, open.pred);
  }
  return spent ? pred / spent : 0;
}

export interface Usual { mean: number; sd: number; n: number }
export interface Past { speed: number; ts: number }

/** Weight of a round played `ageMs` ago. */
export const decay = (ageMs: number) => Math.pow(0.5, Math.max(0, ageMs) / (HALF_LIFE_DAYS * DAY));

/** Your usual performance as of `now`, from previous rounds. null if none. */
export function usual(past: Past[], now: number): Usual | null {
  const xs = past.filter((p) => p.speed > 0).map((p) => ({ x: Math.log(p.speed), w: decay(now - p.ts) }));
  if (!xs.length) return null;
  const W = xs.reduce((a, p) => a + p.w, 0);
  const W2 = xs.reduce((a, p) => a + p.w * p.w, 0);
  const mean = xs.reduce((a, p) => a + p.w * p.x, 0) / W;
  const variance = xs.reduce((a, p) => a + p.w * (p.x - mean) ** 2, 0) / W;
  const n = (W * W) / W2; // effective number of rounds
  // pooled with the prior: (sum of squares ≈ var·n + prior pseudo-rounds) / (dof + prior weight)
  const sd = Math.max(MIN_SD, Math.sqrt((variance * n + PRIOR_WEIGHT * PRIOR_SD ** 2) / (Math.max(0, n - 1) + PRIOR_WEIGHT)));
  return { mean, sd, n };
}

/** This round's pace relative to your usual: 1.15 = 15% faster, 0.5 = 2× slower. */
export function vsUsual(speed: number, u: Usual | null) {
  if (!speed || !u) return null;
  return Math.exp(Math.log(speed) - u.mean);
}

export function altitude(speed: number, u: Usual | null) {
  if (!speed || !u) return 0;
  return Math.round((SIGMA_M * (Math.log(speed) - u.mean)) / u.sd);
}
