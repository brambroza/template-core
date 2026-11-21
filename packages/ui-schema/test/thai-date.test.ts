import { describe, expect, it } from 'vitest';
import { calendarWeeks, dateInputText, monthInputText, parseDateInput, parseMonthInput } from '../src/index.ts';

describe('Thai date entry (พ.ศ. on screen, ISO underneath)', () => {
  it('shows ISO dates as dd/mm/พ.ศ.', () => {
    expect(dateInputText('2026-10-03')).toBe('03/10/2569');
    expect(dateInputText('2026-10-03T08:00:00Z')).toBe('03/10/2569');
    expect(dateInputText('')).toBe('');
    expect(dateInputText(null)).toBe('');
  });

  it('reads what people type', () => {
    expect(parseDateInput('3/10/2569')).toBe('2026-10-03');
    expect(parseDateInput('03-10-2569')).toBe('2026-10-03');
    expect(parseDateInput('3.10.69')).toBe('2026-10-03');
    expect(parseDateInput('3/10/2026')).toBe('2026-10-03');
    expect(parseDateInput('03102569')).toBe('2026-10-03');
    expect(parseDateInput('2026-10-03')).toBe('2026-10-03');
    expect(parseDateInput(' 3 ต.ค. 2569 ')).toBe('2026-10-03');
    expect(parseDateInput('3 ต.ค 69')).toBe('2026-10-03');
    expect(parseDateInput('3 ตุลาคม 2569')).toBe('2026-10-03');
  });

  it('refuses dates that do not exist', () => {
    expect(parseDateInput('31/02/2569')).toBeNull();
    expect(parseDateInput('29/02/2569')).toBeNull(); // 2026 is not a leap year
    expect(parseDateInput('29/02/2567')).toBe('2024-02-29');
    expect(parseDateInput('13/13/2569')).toBeNull();
    expect(parseDateInput('3/10')).toBeNull();
    expect(parseDateInput('พรุ่งนี้')).toBeNull();
    expect(parseDateInput('')).toBeNull();
  });

  it('months: shows ตุลาคม 2569, reads several spellings', () => {
    expect(monthInputText('2026-10')).toBe('ตุลาคม 2569');
    expect(monthInputText('2026-13')).toBe('');
    expect(parseMonthInput('10/2569')).toBe('2026-10');
    expect(parseMonthInput('10/69')).toBe('2026-10');
    expect(parseMonthInput('ต.ค. 2569')).toBe('2026-10');
    expect(parseMonthInput('ตุลาคม 2569')).toBe('2026-10');
    expect(parseMonthInput('2026-10')).toBe('2026-10');
    expect(parseMonthInput('13/2569')).toBeNull();
    expect(parseMonthInput('ตุลา')).toBeNull();
  });

  it('builds a Sunday-first 6-week grid', () => {
    const w = calendarWeeks(2026, 10); // 1 Oct 2026 is a Thursday
    expect(w).toHaveLength(6);
    expect(w.every((r) => r.length === 7)).toBe(true);
    expect(w[0][0]).toEqual({ iso: '2026-09-27', inMonth: false });
    expect(w[0][4]).toEqual({ iso: '2026-10-01', inMonth: true });
    expect(w.flat().filter((d) => d.inMonth)).toHaveLength(31);
  });
});
