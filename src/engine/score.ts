/**
 * Score = altitude in metres, relative to your own past self.
 *
 * Every round yields a speed index:
 *     S = Σ refTime(problem) over solved problems / Σ time actually spent (solved + skipped)
 * refTime(load) = 1.2s · load^1.4 is a fixed curve of how long a problem of a given
 * intrinsic load (columns, carries, chains, borrows through zero) "should" take.
 * Dividing by it means harder problems aren't punished for taking longer, so the index
 * stays fair even as the adaptive picker feeds you more of what you struggle with.
 * Skipped problems and wrong full-length entries cost only time — there are no "errors".
 *
 * There is one score per operation (+ / −), shared by all modes and durations.
 * Your first round with an operation sets Base Camp (5 364 m, Everest's south base camp).
 * Every later round:
 *     altitude = 5 364 · (S / S_first)^1.5
 * The summit (8 849 m) is reached when you are ~40% faster than you were on day one.
 * Unbounded above; a bad day can put you below base camp.
 */

export const BASE_CAMP = 5364;
export const EVEREST = 8849;
const EXP = 1.5;

export const refMs = (load: number) => 1200 * Math.pow(load, 1.4);

export interface Solve {
  load: number;
  ms: number;
  solved: boolean;
}

export function speedIndex(items: Solve[]) {
  let ref = 0;
  let spent = 0;
  for (const it of items) {
    spent += Math.max(it.ms, 150);
    if (it.solved) ref += refMs(it.load);
  }
  return spent ? ref / spent : 0;
}

export function altitude(speed: number, baseline: number) {
  if (!speed || !baseline) return 0;
  return Math.round(BASE_CAMP * Math.pow(speed / baseline, EXP));
}
