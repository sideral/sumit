import { describe, expect, it, beforeEach, afterEach } from 'vitest';

// Deterministic randomness so the statistical tests can't flake.
const realRandom = Math.random;
beforeEach(() => {
  let x = 0x2f6e2b1;
  Math.random = () => ((x = (x * 1664525 + 1013904223) >>> 0) / 2 ** 32);
});
afterEach(() => { Math.random = realRandom; });
import { analyze, randomProblem, shapesFor } from '../src/engine/problem';
import { Model } from '../src/engine/model';
import { altitude, decay, EVEREST, SIGMA_M, speedIndex, usual as usualAt, vsUsual } from '../src/engine/score';

const NOW = Date.UTC(2026, 10, 14);
const DAY = 86_400_000;
/** Previous rounds played on consecutive days, oldest first, ending yesterday. */
const usual = (speeds: number[]) => usualAt(speeds.map((speed, i) => ({ speed, ts: NOW - (speeds.length - i) * DAY })), NOW);

describe('problem', () => {
  it('shapes respect mode constraints', () => {
    expect(shapesFor('add', '2')).toEqual([[1, 2], [2, 1], [2, 2]]);
    expect(shapesFor('sub', '2')).toEqual([[2, 1], [2, 2]]);
    expect(shapesFor('sub', '3')).toEqual([[3, 1], [3, 2], [3, 3]]);
    expect(shapesFor('add', 'mix')).toHaveLength(9);
  });
  it('generates valid problems', () => {
    for (let i = 0; i < 2000; i++) {
      const p = randomProblem('sub', '3');
      expect(p.a).toBeGreaterThanOrEqual(p.b);
      expect(p.a).toBeGreaterThanOrEqual(100);
      expect(p.answer).toBe(p.a - p.b);
      const q = randomProblem('add', '2');
      expect(Math.max(q.a, q.b)).toBeGreaterThanOrEqual(10);
      expect(Math.max(q.a, q.b)).toBeLessThan(100);
    }
  });
  it('detects carries, chains and borrows', () => {
    const f = analyze({ op: 'add', a: 16, b: 27, answer: 43 }).features;
    expect(f).toContain('a:6+7');
    expect(f).toContain('a:carry');
    expect(f).toContain('a:carry-in');
    expect(analyze({ op: 'add', a: 45, b: 58, answer: 103 }).features).toContain('a:chain');
    expect(analyze({ op: 'add', a: 12, b: 13, answer: 25 }).features).toContain('a:no-carry');
    const s = analyze({ op: 'sub', a: 302, b: 157, answer: 145 }).features;
    expect(s).toContain('s:12-7');
    expect(s).toContain('s:zero-borrow');
    expect(s).toContain('s:borrows2');
  });
  it('load grows with difficulty', () => {
    const easy = analyze({ op: 'add', a: 12, b: 13, answer: 0 }).load;
    const hard = analyze({ op: 'add', a: 58, b: 67, answer: 0 }).load;
    expect(hard).toBeGreaterThan(easy);
  });
});

describe('model', () => {
  it('shifts toward patterns the user struggles with', () => {
    const m = new Model();
    const rate = (pred: (a: number, b: number) => boolean) => {
      let hits = 0;
      for (let i = 0; i < 3000; i++) { const p = m.pick('add', '2'); if (pred(p.a, p.b)) hits++; }
      return hits / 3000;
    };
    const has7 = (a: number, b: number) => `${a}${b}`.includes('7');
    const carries = (a: number, b: number) => analyze({ op: 'add', a, b, answer: 0 }).features.includes('a:carry');
    const before7 = rate(has7);
    const beforeCarry = rate(carries);
    // Simulated user: slow & error-prone with 7s and carries
    for (let i = 0; i < 600; i++) {
      const p = randomProblem('add', '2');
      const hard = has7(p.a, p.b) || carries(p.a, p.b);
      m.observe({ op: 'add', a: p.a, b: p.b, ms: hard ? 5200 : 2200, correct: !hard || Math.random() > 0.3 });
    }
    const after7 = rate(has7);
    const afterCarry = rate(carries);
    expect(after7).toBeGreaterThan(before7 + 0.08);
    expect(afterCarry).toBeGreaterThan(beforeCarry + 0.08);
    console.log({ before7, after7, beforeCarry, afterCarry, top: m.weights('add').slice(0, 6) });
  });
});

describe('round plan', () => {
  it('is fixed at round start and unaffected by what happens during the round', () => {
    const m = new Model();
    for (let i = 0; i < 300; i++) {
      const p = randomProblem('add', '2');
      m.observe({ op: 'add', a: p.a, b: p.b, ms: 2000 + (p.a % 10) * 300, correct: true });
    }
    const t0 = performance.now();
    const plan = m.plan('add', '2', 500); // a 5-minute round
    const took = performance.now() - t0;
    const snapshot = JSON.stringify(plan);
    // learning during the round changes the model, not the plan already drawn
    for (const { problem } of plan.slice(0, 50)) m.observe({ op: 'add', a: problem.a, b: problem.b, ms: 9000, correct: true });
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(plan).toHaveLength(500);
    // no immediate repeats
    for (let i = 1; i < plan.length; i++) expect(`${plan[i].problem.a}+${plan[i].problem.b}`).not.toBe(`${plan[i - 1].problem.a}+${plan[i - 1].problem.b}`);
    expect(took).toBeLessThan(400);
  });
});

describe('prediction', () => {
  it('predicts longer times for patterns you are slow at', () => {
    const m = new Model();
    for (let i = 0; i < 400; i++) {
      const p = randomProblem('add', '2');
      const carry = analyze(p).features.includes('a:carry');
      m.observe({ op: 'add', a: p.a, b: p.b, ms: carry ? 6000 : 2500, correct: true });
    }
    const noCarry = m.predictMs({ op: 'add', a: 21, b: 34, answer: 55 });
    const carry = m.predictMs({ op: 'add', a: 28, b: 37, answer: 65 });
    expect(carry).toBeGreaterThan(noCarry * 1.5);
  });
});

describe('operand order', () => {
  it('tags the order of pairs and operands', () => {
    const f = analyze({ op: 'add', a: 8, b: 47, answer: 55 }).features;
    expect(f).toContain('a:7+8');        // order-free pair
    expect(f).toContain('a:o8+7');       // as written
    expect(f).toContain('a:short-first');
    expect(analyze({ op: 'add', a: 47, b: 8, answer: 55 }).features).toContain('a:long-first');
    expect(analyze({ op: 'add', a: 23, b: 58, answer: 81 }).features).toContain('a:smaller-first');
  });

  it('learns that one order is harder and serves it more', () => {
    const m = new Model();
    const hard = (a: number, b: number) => (a < 10 && b >= 10) || (a === 8 && b === 7);
    for (let i = 0; i < 800; i++) {
      const p = randomProblem('add', 'mix');
      if (p.a >= 100 || p.b >= 100) continue;
      m.observe({ op: 'add', a: p.a, b: p.b, ms: hard(p.a, p.b) ? 5000 : 2500, correct: true });
    }
    // 8 + 7 is predicted slower than 7 + 8
    expect(m.predictMs({ op: 'add', a: 8, b: 7, answer: 15 })).toBeGreaterThan(m.predictMs({ op: 'add', a: 7, b: 8, answer: 15 }) * 1.3);
    // 6 + 45 (short first) slower than 45 + 6
    expect(m.predictMs({ op: 'add', a: 6, b: 45, answer: 51 })).toBeGreaterThan(m.predictMs({ op: 'add', a: 45, b: 6, answer: 51 }) * 1.3);
    // and the picker shows short-first more than long-first in 2-digit mode
    let short = 0, long = 0;
    for (let i = 0; i < 3000; i++) {
      const p = m.pick('add', '2');
      if (p.a < 10) short++;
      else if (p.b < 10) long++;
    }
    expect(short).toBeGreaterThan(long * 1.3);
  });
});

describe('score', () => {
  it('pace compares actual time with your predicted time', () => {
    expect(speedIndex([{ pred: 3000, ms: 2000, solved: true }])).toBeCloseTo(1.5);
    expect(speedIndex([{ pred: 3000, ms: 6000, solved: true }])).toBeCloseTo(0.5);
    // a problem predicted to be hard for you isn't held against you
    expect(speedIndex([{ pred: 8000, ms: 8000, solved: true }])).toBeCloseTo(speedIndex([{ pred: 2000, ms: 2000, solved: true }]));
  });

  it('counts the time left on the unanswered last problem', () => {
    const fast = { pred: 3000, ms: 1000, solved: true };
    // one quick answer, then waiting out a minute: no longer a great pace
    expect(speedIndex([fast], { pred: 3000, ms: 59_000 })).toBeCloseTo(6000 / 60_000);
    // cut off mid-problem at exactly the usual pace: unchanged
    expect(speedIndex([{ pred: 3000, ms: 3000, solved: true }], { pred: 3000, ms: 1500 })).toBeCloseTo(1);
    // nothing open: as before
    expect(speedIndex([fast], null)).toBeCloseTo(3);
  });
  it('unsolved problems cost time and earn nothing', () => {
    const clean = speedIndex([{ pred: 3000, ms: 3000, solved: true }]);
    const withUnsolved = speedIndex([{ pred: 3000, ms: 3000, solved: true }, { pred: 3000, ms: 3000, solved: false }]);
    expect(withUnsolved).toBeCloseTo(clean / 2);
  });
  it('vsUsual reads the score in plain terms', () => {
    const u = usual([1, 1, 1, 1])!;
    expect(vsUsual(1.15, u)).toBeCloseTo(1.15);
    expect(vsUsual(0.5, u)).toBeCloseTo(0.5);
    expect(vsUsual(1, null)).toBeNull();
  });
  it('first round is camp, usual round is ~0, better is up, worse is the abyss', () => {
    expect(altitude(1.2, usual([]))).toBe(0);
    const hist = [1.0, 1.05, 0.95, 1.02, 0.98, 1.0];
    const u = usual(hist)!;
    expect(Math.abs(altitude(1.0, u))).toBeLessThan(200);
    expect(altitude(1.1, u)).toBeGreaterThan(0);
    expect(altitude(0.9, u)).toBeLessThan(0);
  });
  it('is measured in standard deviations of your own history', () => {
    const steady = usual([1, 1.01, 0.99, 1, 1.01, 0.99, 1, 1, 1.01, 0.99, 1, 1])!;
    const erratic = usual([1, 1.3, 0.75, 1.2, 0.8, 1.25, 0.8, 1.1, 0.9, 1.3, 0.75, 1])!;
    // the same 5% gain is a bigger deal when you're usually consistent
    expect(altitude(1.05, steady)).toBeGreaterThan(altitude(1.05, erratic) * 2);
    // one sd above the mean is SIGMA_M metres
    expect(altitude(Math.exp(steady.mean + steady.sd), steady)).toBe(SIGMA_M);
    expect(2 * SIGMA_M).toBeGreaterThanOrEqual(EVEREST); // summit at 2σ
  });
  it('older rounds fade by time, none are cut off', () => {
    expect(decay(0)).toBe(1);
    expect(decay(60 * DAY)).toBeCloseTo(0.5);
    expect(decay(365 * DAY)).toBeLessThan(0.02);
    // a year of slow rounds barely moves today's usual next to a week of fast ones...
    const old = Array.from({ length: 50 }, (_, i) => ({ speed: 0.5, ts: NOW - (365 + i) * DAY }));
    const recent = Array.from({ length: 7 }, (_, i) => ({ speed: 1, ts: NOW - (i + 1) * DAY }));
    const u = usualAt([...old, ...recent], NOW)!;
    expect(Math.exp(u.mean)).toBeGreaterThan(0.9);
    // ...but it still counts a little
    expect(Math.exp(u.mean)).toBeLessThan(1);
    // and with only old history, it is still used
    expect(usualAt(old, NOW)).not.toBeNull();
  });
});
