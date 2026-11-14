/**
 * Score = altitude in metres. Unbounded.
 *
 * Each correct answer earns
 *     load^1.8 · speed^0.7 · streak
 * where
 *   load   = intrinsic cognitive load of the problem (columns, carries, chains, borrows
 *            through zero). The super-linear exponent rewards harder problems more than
 *            proportionally, because working-memory cost grows faster than size.
 *   speed  = reference time / your time, clamped to [0.3, 2.5]. Reference time is an
 *            absolute (not personal) curve 1.2s · load^1.4, so the score tracks real
 *            improvement instead of normalising it away.
 *   streak = 1 + 0.3·(1 − e^(−k/8)) for k consecutive correct answers before this one.
 *            Rewards consistency, saturates at ×1.3.
 *
 * Round score = 25 · points per minute · accuracy².
 * Per-minute keeps 1/2/5 min rounds comparable; accuracy² makes guessing a bad strategy
 * (90% accuracy costs 19%, 70% costs 51%).
 */

export function pointsFor(load: number, ms: number, streak: number) {
  const ref = 1200 * Math.pow(load, 1.4);
  const speed = Math.min(2.5, Math.max(0.3, ref / Math.max(ms, 150)));
  const streakMul = 1 + 0.3 * (1 - Math.exp(-streak / 8));
  return Math.pow(load, 1.8) * Math.pow(speed, 0.7) * streakMul;
}

export function finalScore(points: number, correct: number, total: number, durationMs: number) {
  if (!total) return 0;
  const acc = correct / total;
  return Math.round((25 * points * acc * acc) / (durationMs / 60000));
}

export const EVEREST = 8849;
