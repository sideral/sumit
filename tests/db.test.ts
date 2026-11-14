import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { allAttempts, allRounds, exportAll, getSettings, importAll, putAttempt, putRound, saveSettings, wipe } from '../src/db';

describe('db', () => {
  it('erases rounds and attempts but keeps settings; export/import round-trips', async () => {
    await saveSettings({ ...(await getSettings()), theme: 'dark' });
    await putRound({ id: 'r1', ts: 1, op: 'add', mode: '2', duration: 1, score: 10, count: 1, speed: 1 });
    await putAttempt({ id: 'a1', ts: 1, round: 'r1', op: 'add', a: 12, b: 30, given: 42, correct: true, ms: 1500 });

    const dump = await exportAll();
    expect(dump.rounds).toHaveLength(1);
    expect(dump.attempts).toHaveLength(1);

    await wipe();
    expect(await allRounds()).toHaveLength(0);
    expect(await allAttempts()).toHaveLength(0);
    expect((await getSettings()).theme).toBe('dark');

    await importAll(dump);
    await importAll(dump); // merging twice is harmless
    expect(await allRounds()).toHaveLength(1);
    expect(await allAttempts()).toHaveLength(1);
  });

  it('rejects files that are not SumIt exports', async () => {
    await expect(importAll({ nope: true } as never)).rejects.toThrow();
  });
});
