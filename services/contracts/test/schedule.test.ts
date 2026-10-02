import { describe, expect, it } from 'vitest';
import { addDays, addMonths, billingSchedule, daysBetween, pmDueDates, renewalPeriod } from '../src/schedule.ts';

const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((t, x) => t + x.amount * 100, 0)) / 100;

describe('contract schedule arithmetic', () => {
  it('adds calendar months anchored on the day of month', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2027-12-15', 3)).toBe('2028-03-15');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-01-01', '2026-12-31')).toBe(364);
  });

  it('monthly over 12 months = 12 installments summing to the value', () => {
    const s = billingSchedule('2026-01-01', '2026-12-31', 'monthly', 100000);
    expect(s).toHaveLength(12);
    expect(sum(s)).toBe(100000);
    expect(s[0]).toEqual({ seq: 1, dueDate: '2026-01-01', amount: 8333.33 });
    expect(s[11]).toEqual({ seq: 12, dueDate: '2026-12-01', amount: 8333.37 });
  });

  it('quarterly, yearly and one-time plans', () => {
    const q = billingSchedule('2026-01-15', '2027-01-14', 'quarterly', 120000);
    expect(q.map((x) => x.dueDate)).toEqual(['2026-01-15', '2026-04-15', '2026-07-15', '2026-10-15']);
    expect(q.every((x) => x.amount === 30000)).toBe(true);
    const y = billingSchedule('2026-01-01', '2027-12-31', 'yearly', 99999.99);
    expect(y.map((x) => x.amount)).toEqual([49999.99, 50000]);
    expect(sum(y)).toBe(99999.99);
    expect(billingSchedule('2026-03-01', '2027-02-28', 'one_time', 45000)).toEqual([{ seq: 1, dueDate: '2026-03-01', amount: 45000 }]);
  });

  it('PM due dates every N months within the contract and up to `until`', () => {
    expect(pmDueDates('2026-01-01', 3, '2026-12-31', '2030-01-01')).toEqual(['2026-01-01', '2026-04-01', '2026-07-01', '2026-10-01']);
    expect(pmDueDates('2026-01-01', 6, '2026-12-31', '2026-05-01')).toEqual(['2026-01-01']);
    expect(pmDueDates('2026-01-01', 0, '2026-12-31', '2030-01-01')).toEqual([]);
  });

  it('renewal period follows the old one (whole months or same days)', () => {
    expect(renewalPeriod('2026-01-01', '2026-12-31')).toEqual({ startDate: '2027-01-01', endDate: '2027-12-31' });
    expect(renewalPeriod('2026-03-15', '2028-03-14')).toEqual({ startDate: '2028-03-15', endDate: '2030-03-14' });
    expect(renewalPeriod('2026-01-01', '2026-01-20')).toEqual({ startDate: '2026-01-21', endDate: '2026-02-09' });
  });
});
