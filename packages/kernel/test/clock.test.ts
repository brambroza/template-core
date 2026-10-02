import { afterEach, describe, expect, it } from 'vitest';
import { addDaysIso, nextDocNo, now, setClock, thaiDate, thaiToday, type Client } from '../src/index.ts';

afterEach(() => { setClock(null); delete process.env.ERP_CLOCK; });

describe('business clock (Asia/Bangkok)', () => {
  it('thaiDate shifts UTC instants to the Bangkok calendar day', () => {
    expect(thaiDate(new Date('2026-10-02T16:59:59Z'))).toBe('2026-10-02'); // 23:59:59 Bangkok
    expect(thaiDate(new Date('2026-10-02T17:00:00Z'))).toBe('2026-10-03'); // 00:00 Bangkok
    expect(thaiDate(new Date('2026-12-31T19:00:00Z'))).toBe('2027-01-01'); // 02:00 on new year's day
  });

  it('02:00 Bangkok is already today (UTC still says yesterday)', () => {
    setClock('2026-10-02T19:00:00Z');
    expect(now().toISOString().slice(0, 10)).toBe('2026-10-02');
    expect(thaiToday()).toBe('2026-10-03');
  });

  it('ERP_CLOCK env var drives the clock; setClock wins over it; null restores', () => {
    process.env.ERP_CLOCK = '2026-09-30T18:30:00Z';
    expect(thaiToday()).toBe('2026-10-01');
    setClock(new Date('2026-01-15T03:00:00Z'));
    expect(thaiToday()).toBe('2026-01-15');
    setClock(null);
    expect(thaiToday()).toBe('2026-10-01');
    delete process.env.ERP_CLOCK;
    expect(Math.abs(now().getTime() - Date.now())).toBeLessThan(1000);
  });

  it('a function clock and invalid input', () => {
    let t = Date.parse('2026-10-02T19:00:00Z');
    setClock(() => new Date(t));
    expect(thaiToday()).toBe('2026-10-03');
    t += 24 * 3600_000;
    expect(thaiToday()).toBe('2026-10-04');
    expect(() => setClock('not a date')).toThrow();
  });

  it('addDaysIso crosses months and years', () => {
    expect(addDaysIso('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysIso('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDaysIso('2026-10-03', 30)).toBe('2026-11-02');
  });

  it('nextDocNo defaults to the Thai year: 02:00 on 1 Jan 2027 Bangkok is 2570', async () => {
    const seen: unknown[][] = [];
    const fake = { query: async (_sql: string, params: unknown[]) => { seen.push(params); return { rows: [{ last: 1 }] }; } } as unknown as Client;
    setClock('2026-12-31T19:00:00Z');
    expect(await nextDocNo(fake, 'INV')).toBe('INV-2570-0001');
    expect(seen[0]).toEqual(['INV', 2570]);
  });
});
