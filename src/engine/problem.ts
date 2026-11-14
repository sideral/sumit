export type Op = 'add' | 'sub';
export type Mode = '1' | '2' | '3' | 'mix';

export interface Problem {
  op: Op;
  a: number;
  b: number;
  answer: number;
}

export interface Analysis {
  /** Skill tags this problem exercises. Used by the adaptive model. */
  features: string[];
  /** Intrinsic cognitive load (columns worked, carries/borrows, chains). Used for scoring. */
  load: number;
  /** Shape key, e.g. "add:2x1". Used to normalise answer times. */
  shape: string;
}

const RANGES: Record<number, [number, number]> = { 1: [1, 9], 2: [10, 99], 3: [100, 999] };

/** Allowed (lenA, lenB) pairs for each op/mode. Subtraction always has a >= b. */
export function shapesFor(op: Op, mode: Mode): [number, number][] {
  const all: [number, number][] = [];
  for (let x = 1; x <= 3; x++) for (let y = 1; y <= 3; y++) all.push([x, y]);
  const top = mode === 'mix' ? 3 : Number(mode);
  return all.filter(([x, y]) => {
    if (x > top || y > top) return false;
    if (mode !== 'mix' && Math.max(x, y) !== top) return false;
    if (op === 'sub' && y > x) return false;
    return true;
  });
}

const rnd = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));

export function randomProblem(op: Op, mode: Mode): Problem {
  const shapes = shapesFor(op, mode);
  const [la, lb] = shapes[Math.floor(Math.random() * shapes.length)];
  let a = rnd(...RANGES[la]);
  let b = rnd(...RANGES[lb]);
  if (op === 'sub') {
    if (b > a) [a, b] = [b, a];
    return { op, a, b, answer: a - b };
  }
  return { op, a, b, answer: a + b };
}

const digitsOf = (n: number) => String(n).split('').reverse().map(Number); // least significant first

export function analyze(p: Problem): Analysis {
  const f = new Set<string>();
  const da = digitsOf(p.a);
  const db = digitsOf(p.b);
  const n = Math.max(da.length, db.length);
  let load = 0;

  if (p.op === 'add') {
    let carry = 0;
    let carries = 0;
    for (let i = 0; i < n; i++) {
      const x = da[i];
      const y = db[i];
      const both = x !== undefined && y !== undefined;
      const s = (x ?? 0) + (y ?? 0) + carry;
      if (both) {
        // The pair itself (order-free), plus the pair as written: 8+7 and 7+8 share
        // a base speed but each order can learn its own extra cost.
        f.add(`a:${Math.min(x, y)}+${Math.max(x, y)}`);
        if (x !== y) {
          f.add(`a:o${x}+${y}`);
          f.add(x < y ? 'a:col-smaller-first' : 'a:col-larger-first');
        }
        load += 1;
        if (carry) { f.add('a:carry-in'); load += 0.3; }
      } else {
        load += carry ? 0.6 : 0.15;
        if (carry) f.add('a:carry-tail');
      }
      // carry-in turned a non-carrying column into a carrying one (e.g. 4+5+1)
      if (carry && s >= 10 && s - 1 < 10) { f.add('a:chain'); load += 0.5; }
      if (s >= 10) carries++;
      carry = s >= 10 ? 1 : 0;
    }
    if (carries) { f.add('a:carry'); f.add(`a:carries${Math.min(carries, 3)}`); load += 0.9 * carries; }
    else f.add('a:no-carry');
    // Operand order: 8 + 47 vs 47 + 8, and 23 + 58 vs 58 + 23.
    if (da.length !== db.length) f.add(da.length < db.length ? 'a:short-first' : 'a:long-first');
    else if (p.a !== p.b) f.add(p.a < p.b ? 'a:smaller-first' : 'a:larger-first');
  } else {
    let borrow = 0;
    let borrows = 0;
    for (let i = 0; i < n; i++) {
      const t = da[i];
      const y = db[i];
      const tt = t - borrow;
      if (borrow && t === 0) { f.add('s:zero-borrow'); load += 0.7; }
      let next = 0;
      if (y !== undefined) {
        next = tt < y ? 1 : 0;
        f.add(next ? `s:1${tt}-${y}` : `s:${tt}-${y}`); // actual column fact, e.g. "13-7"
        load += 1;
        if (borrow) { f.add('s:borrow-in'); load += 0.3; }
      } else {
        next = tt < 0 ? 1 : 0;
        load += borrow ? 0.6 : 0.15;
        if (borrow) f.add('s:borrow-tail');
      }
      if (next) borrows++;
      borrow = next;
    }
    if (borrows) { f.add('s:borrow'); f.add(`s:borrows${Math.min(borrows, 3)}`); load += 0.9 * borrows; }
    else f.add('s:no-borrow');
  }

  const pre = p.op === 'add' ? 'a' : 's';
  for (const d of new Set([...da, ...db])) f.add(`${pre}:d${d}`);

  const la = da.length;
  const lb = db.length;
  const shape = p.op === 'add' ? `add:${Math.max(la, lb)}x${Math.min(la, lb)}` : `sub:${la}x${lb}`;
  return { features: [...f], load: Math.max(load, 1), shape };
}

export const symbol = (op: Op) => (op === 'add' ? '+' : '−');
