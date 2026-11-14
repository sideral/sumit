import { describe, expect, it } from 'vitest';
import { analyze, randomProblem, shapesFor } from '../src/engine/problem';
import { Model } from '../src/engine/model';
import { finalScore, pointsFor } from '../src/engine/score';

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

describe('score', () => {
  it('rewards speed, difficulty and accuracy', () => {
    expect(pointsFor(2, 2000, 0)).toBeGreaterThan(pointsFor(2, 4000, 0));
    expect(pointsFor(4, 6000, 0)).toBeGreaterThan(pointsFor(2, 3000, 0));
    expect(finalScore(100, 10, 10, 60000)).toBeGreaterThan(finalScore(100, 9, 10, 60000));
    expect(finalScore(100, 10, 10, 60000)).toBe(finalScore(200, 10, 10, 120000));
  });
  it('typical 1-digit and 3-digit rounds land in similar ranges', () => {
    const sim = (mode: '1' | '3', msPer: number) => {
      let pts = 0, t = 0, k = 0, n = 0;
      while (t < 60000) {
        const p = randomProblem('add', mode);
        const { load } = analyze(p);
        const ms = msPer * (mode === '3' ? load / 4 : 1);
        pts += pointsFor(load, ms, k++); t += ms; n++;
      }
      return finalScore(pts, n, n, 60000);
    };
    console.log({ one: sim('1', 1300), three: sim('3', 8000) });
  });
});
