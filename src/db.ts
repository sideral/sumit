import type { Mode, Op } from './engine/problem';

export interface Attempt {
  id: string;
  ts: number;
  round: string;
  op: Op;
  a: number;
  b: number;
  given: number | null;
  /** Solved (not skipped). */
  correct: boolean;
  ms: number;
  /** Wrong full-length entries before solving. */
  misses?: number;
  skipped?: boolean;
}

export interface Round {
  id: string;
  ts: number;
  op: Op;
  mode: Mode;
  duration: number; // minutes
  /** Altitude at the time; recomputed on load from speed vs. base camp. */
  score: number;
  count: number;
  /** Speed index, see engine/score.ts. */
  speed?: number;
  /** Pace vs. your usual at the time (derived on load, not essential). */
  ratio?: number;
}

export type Theme = 'system' | 'light' | 'dark';
export interface Settings {
  theme: Theme;
  op: Op;
  mode: Mode;
  duration: number;
  sound: boolean;
}

export const DEFAULT_SETTINGS: Settings = { theme: 'system', op: 'add', mode: '2', duration: 1, sound: true };

const DB_NAME = 'sumit';
const STORES = ['attempts', 'rounds', 'kv'] as const;
type Store = (typeof STORES)[number];

let dbp: Promise<IDBDatabase> | null = null;
function db() {
  return (dbp ??= new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('attempts', { keyPath: 'id' }).createIndex('ts', 'ts');
      d.createObjectStore('rounds', { keyPath: 'id' }).createIndex('ts', 'ts');
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}

const req = <T>(r: IDBRequest<T>) =>
  new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

async function tx<T>(stores: Store | Store[], mode: IDBTransactionMode, fn: (t: IDBTransaction) => Promise<T> | T) {
  const t = (await db()).transaction(stores, mode);
  const done = new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });
  const out = await fn(t);
  await done;
  return out;
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);

export const putAttempt = (a: Attempt) => tx('attempts', 'readwrite', (t) => { t.objectStore('attempts').put(a); });
export const putRound = (r: Round) => tx('rounds', 'readwrite', (t) => { t.objectStore('rounds').put(r); });

export const allAttempts = () =>
  tx('attempts', 'readonly', (t) => req(t.objectStore('attempts').index('ts').getAll() as IDBRequest<Attempt[]>));
export const allRounds = () =>
  tx('rounds', 'readonly', (t) => req(t.objectStore('rounds').index('ts').getAll() as IDBRequest<Round[]>));

export async function getSettings(): Promise<Settings> {
  const s = await tx('kv', 'readonly', (t) => req(t.objectStore('kv').get('settings')));
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}
export const saveSettings = (s: Settings) => tx('kv', 'readwrite', (t) => { t.objectStore('kv').put(s, 'settings'); });

export interface Dump {
  app: 'sumit';
  version: 1;
  exported: number;
  settings: Settings;
  attempts: Attempt[];
  rounds: Round[];
}

export async function exportAll(): Promise<Dump> {
  const [attempts, rounds, settings] = await Promise.all([allAttempts(), allRounds(), getSettings()]);
  return { app: 'sumit', version: 1, exported: Date.now(), settings, attempts, rounds };
}

/** Merges by id, so importing the same file twice is harmless. */
export async function importAll(d: Dump) {
  if (d?.app !== 'sumit' || !Array.isArray(d.attempts) || !Array.isArray(d.rounds)) throw new Error('bad file');
  await tx(['attempts', 'rounds'], 'readwrite', (t) => {
    const as = t.objectStore('attempts');
    const rs = t.objectStore('rounds');
    for (const a of d.attempts) as.put(a);
    for (const r of d.rounds) rs.put(r);
  });
  return { attempts: d.attempts.length, rounds: d.rounds.length };
}

export const wipe = () =>
  tx(['attempts', 'rounds'], 'readwrite', (t) => { t.objectStore('attempts').clear(); t.objectStore('rounds').clear(); });

/** Ask the browser not to evict our data under storage pressure. */
export async function persist() {
  try { if (navigator.storage?.persist && !(await navigator.storage.persisted())) await navigator.storage.persist(); } catch { /* ignore */ }
}
