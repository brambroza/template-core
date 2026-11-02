import { describe, expect, it } from 'vitest';
import { calendarWeeks, paginate, parseDateText, shiftIsoDay, shiftIsoMonth, thaiDateText } from '../src/index.ts';

describe('paginate', () => {
  it('slices and clamps', () => {
    expect(paginate(82, 1, 25)).toMatchObject({ page: 1, pages: 4, start: 0, end: 25 });
    expect(paginate(82, 4, 25)).toMatchObject({ page: 4, start: 75, end: 82 });
    expect(paginate(82, 99, 25).page).toBe(4);
    expect(paginate(0, 1, 25)).toMatchObject({ page: 1, pages: 1, start: 0, end: 0, items: [1] });
  });

  it('draws first, last and neighbours with gaps, never a gap of one page', () => {
    expect(paginate(300, 6, 25).items).toEqual([1, '…', 5, 6, 7, '…', 12]);
    expect(paginate(300, 1, 25).items).toEqual([1, 2, 3, 4, '…', 12]);
    expect(paginate(300, 12, 25).items).toEqual([1, '…', 9, 10, 11, 12]);
    expect(paginate(300, 4, 25).items).toEqual([1, 2, 3, 4, 5, '…', 12]); // 1 … 3 would hide only page 2: show it
    expect(paginate(125, 3, 25).items).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('Thai date text', () => {
  it('formats ISO dates and months in Buddhist years without depending on the machine locale', () => {
    expect(thaiDateText('2026-10-31')).toBe('31 ต.ค. 2569');
    expect(thaiDateText('2027-01-05')).toBe('5 ม.ค. 2570');
    expect(thaiDateText('2026-10', 'month')).toBe('ต.ค. 2569');
    expect(thaiDateText('')).toBe('');
    expect(thaiDateText('nonsense')).toBe('');
  });

  it('parses what people type: ISO, d/m/BE, d/m/CE, 2-digit years, Thai month names', () => {
    for (const t of ['2026-10-31', '31/10/2569', '31/10/2026', '31-10-69', '31.10.26', '31 ต.ค. 2569', '31 ตุลาคม 2569', '31ต.ค.69', '  31 / 10 / 2569 '.replace(/ /g, '')]) {
      expect(parseDateText(t), t).toBe('2026-10-31');
    }
    expect(parseDateText('')).toBe('');
    expect(parseDateText('31/02/2569')).toBeNull(); // not a real day
    expect(parseDateText('31/10')).toBeNull(); // not finished yet
    expect(parseDateText('29/2/2567')).toBe('2024-02-29'); // leap year in BE
  });

  it('parses months', () => {
    for (const t of ['2026-10', '10/2569', '10/2026', 'ต.ค. 2569', 'ตุลาคม 2569', 'ต.ค.69']) expect(parseDateText(t, 'month'), t).toBe('2026-10');
    expect(parseDateText('13/2569', 'month')).toBeNull();
  });
});

describe('calendar grid', () => {
  it('starts on Sunday and covers the whole month', () => {
    const weeks = calendarWeeks(2026, 10); // 1 Oct 2026 is a Thursday
    expect(weeks[0].map((d) => d.day)).toEqual([27, 28, 29, 30, 1, 2, 3]);
    expect(weeks[0][4]).toEqual({ iso: '2026-10-01', day: 1, inMonth: true });
    expect(weeks.flat().filter((d) => d.inMonth)).toHaveLength(31);
    expect(weeks.every((w) => w.length === 7)).toBe(true);
  });

  it('moves days and months safely', () => {
    expect(shiftIsoDay('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftIsoMonth('2026-01-31', 1)).toBe('2026-02-28');
    expect(shiftIsoMonth('2026-03-15', -3)).toBe('2025-12-15');
  });
});
