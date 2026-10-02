import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULES, NO_TAX_PROFILE, NO_YTD, annualNetIncome, calculateLine, employedDays, mergeRules, postings, progressiveTax, roundBaht, ssoContribution,
  type LineInput,
} from '../src/calc.ts';

const base = (over: Partial<LineInput> = {}): LineInput => ({
  period: '2026-01', payType: 'monthly', baseSalary: 15_000, dailyWage: 0, startDate: '2020-01-01', endDate: null, workDays: null,
  ot: { x1: 0, x15: 0, x2: 0, x3: 0 }, unpaidLeaveDays: 0, bonus: 0, otherIncome: 0, otherDeduction: 0, recurring: [],
  ssoEnrolled: true, pvdEmployeePct: 0, pvdEmployerPct: 0, tax: NO_TAX_PROFILE, ytd: NO_YTD, ...over,
});

describe('social security (ประกันสังคม)', () => {
  it('takes 5% of 15,000 = 750 for both employee and employer', () => {
    const r = calculateLine(base());
    expect(r).toMatchObject({ ssoWage: 15_000, ssoEmployee: 750, ssoEmployer: 750, wht: 0, net: 14_250 });
  });

  it('caps the wage base at the ceiling and lifts it to the floor, rounding half up to whole baht', () => {
    expect(ssoContribution(30_000, 5, DEFAULT_RULES.sso)).toBe(750);
    expect(ssoContribution(1_000, 5, DEFAULT_RULES.sso)).toBe(83); // 1,650 × 5% = 82.50 → 83
    expect(ssoContribution(10_009, 5, DEFAULT_RULES.sso)).toBe(500); // 500.45 → 500
    expect(ssoContribution(0, 5, DEFAULT_RULES.sso)).toBe(0);
    expect(roundBaht(82.5)).toBe(83);
  });

  it('follows a new ceiling from settings (e.g. 17,500) without code changes', () => {
    const rules = mergeRules({ sso: { wageMax: 17_500 } });
    expect(calculateLine(base({ baseSalary: 30_000 }), rules).ssoEmployee).toBe(875);
    expect(rules.tax.personal).toBe(60_000);
  });

  it('is zero for an employee not enrolled', () => {
    expect(calculateLine(base({ ssoEnrolled: false })).ssoEmployee).toBe(0);
  });

  it('excludes overtime from the SSO wage by default and reduces it by unpaid leave', () => {
    const r = calculateLine(base({ ot: { x1: 0, x15: 10, x2: 0, x3: 0 }, unpaidLeaveDays: 2 }));
    expect(r.hourlyRate).toBe(62.5); // 15,000 / 30 / 8
    expect(r.overtime).toBe(937.5);
    expect(r.unpaidLeave).toBe(1_000);
    expect(r.ssoWage).toBe(14_000);
    expect(r.ssoEmployee).toBe(700);
    expect(calculateLine(base({ baseSalary: 10_000, ot: { x1: 0, x15: 10, x2: 0, x3: 0 } }), mergeRules({ sso: { includeOvertime: true } })).ssoWage).toBeCloseTo(10_625);
  });
});

describe('withholding tax ภ.ง.ด.1 (annualised)', () => {
  it('30,000/month from January: net income 191,000 → 2,050 a year → 170.83 a month', () => {
    const r = calculateLine(base({ baseSalary: 30_000 }));
    expect(r.tax).toMatchObject({ remainingPeriods: 12, projectedIncome: 360_000, projectedSso: 9_000, netIncome: 191_000, annualTax: 2_050 });
    expect(r.wht).toBe(170.83);
    expect(r.net).toBe(29_079.17);
  });

  it('corrects with year-to-date figures so the year adds up', () => {
    const r = calculateLine(base({ period: '2026-10', baseSalary: 30_000, ytd: { regular: 270_000, irregular: 0, tax: 1_537.47, sso: 6_750, pvd: 0 } }));
    expect(r.tax.remainingPeriods).toBe(3);
    expect(r.wht).toBe(170.84);
  });

  it('taxes a bonus in full in the month paid (marginal method)', () => {
    const r = calculateLine(base({ period: '2026-12', baseSalary: 30_000, bonus: 60_000, ytd: { regular: 330_000, irregular: 0, tax: 1_879.13, sso: 8_250, pvd: 0 } }));
    expect(r.tax.regularPart).toBe(170.87);
    expect(r.tax.irregularPart).toBe(3_000); // 5,050 − 2,050
    expect(r.wht).toBe(3_170.87);
  });

  it('applies spouse / children allowances and provident fund contributions', () => {
    expect(calculateLine(base({ baseSalary: 50_000 })).wht).toBe(1_716.67);
    expect(calculateLine(base({ baseSalary: 50_000, tax: { ...NO_TAX_PROFILE, spouse: true, children: 2 } })).wht).toBe(716.67);
    const pvd = calculateLine(base({ baseSalary: 30_000, pvdEmployeePct: 5, pvdEmployerPct: 5 }));
    expect(pvd).toMatchObject({ pvdEmployee: 1_500, pvdEmployer: 1_500, wht: 95.83 });
  });

  it('progressive brackets and caps on deductions', () => {
    expect(progressiveTax(150_000, DEFAULT_RULES.tax.brackets)).toBe(0);
    expect(progressiveTax(300_000, DEFAULT_RULES.tax.brackets)).toBe(7_500);
    expect(progressiveTax(1_000_000, DEFAULT_RULES.tax.brackets)).toBe(115_000);
    expect(progressiveTax(6_000_000, DEFAULT_RULES.tax.brackets)).toBe(1_615_000);
    const n = annualNetIncome(1_000_000, 9_000, 400_000, { ...NO_TAX_PROFILE, lifeInsurance: 90_000, healthInsurance: 40_000, parents: 6 }, DEFAULT_RULES.tax);
    expect(n.deductions).toMatchObject({ expense: 100_000, pvd: 150_000, insurance: 100_000, parents: 120_000 });
  });
});

describe('proration, daily wages and deductions', () => {
  it('pays a mid-month joiner by calendar days and projects tax only over the months employed', () => {
    const r = calculateLine(base({ period: '2026-10', baseSalary: 31_000, startDate: '2026-10-16' }));
    expect(r).toMatchObject({ employedDays: 16, daysInMonth: 31, salary: 16_000, ssoEmployee: 750, wht: 0 });
    expect(r.tax).toMatchObject({ remainingPeriods: 3, projectedIncome: 78_000 });
    expect(calculateLine(base({ period: '2026-10', baseSalary: 31_000, startDate: '2026-10-16' }), mergeRules({ proration: 'days30' })).salary).toBe(16_533.33);
  });

  it('pays a leaver up to the last day and withholds as a final period', () => {
    const r = calculateLine(base({ period: '2026-03', baseSalary: 31_000, endDate: '2026-03-10' }));
    expect(r.salary).toBe(10_000);
    expect(r.tax.remainingPeriods).toBe(1);
  });

  it('counts employed days inside the month only', () => {
    expect(employedDays('2026-02', '2025-01-01', null)).toEqual({ days: 28, daysInMonth: 28 });
    expect(employedDays('2026-02', '2026-03-01', null).days).toBe(0);
    expect(calculateLine(base({ period: '2026-02', startDate: '2026-03-01' })).warnings[0]).toContain('ไม่ได้อยู่ในช่วงจ้างงาน');
  });

  it('pays daily-wage staff for days worked, with OT at the hourly rate', () => {
    const r = calculateLine(base({ payType: 'daily', baseSalary: 0, dailyWage: 400, workDays: 20, ot: { x1: 0, x15: 4, x2: 0, x3: 2 } }));
    expect(r).toMatchObject({ salary: 8_000, hourlyRate: 50, overtime: 600, ssoEmployee: 400 });
    const d = calculateLine(base({ payType: 'daily', baseSalary: 0, dailyWage: 400, workDays: null }));
    expect(d.workDays).toBe(26);
    expect(d.warnings.join()).toContain('ค่าเริ่มต้น 26 วัน');
  });

  it('pro-rates recurring allowances, keeps loans within their balance and itemises the payslip', () => {
    const r = calculateLine(base({
      period: '2026-10', baseSalary: 31_000, startDate: '2026-10-16',
      recurring: [
        { id: 'a1', kind: 'earning', code: 'POS', name: 'ค่าตำแหน่ง', amount: 3_100, sso: true },
        { id: 'a2', kind: 'earning', code: 'PERDIEM', name: 'เบี้ยเลี้ยง', amount: 1_000, taxable: false },
        { id: 'l1', kind: 'deduction', code: 'LOAN', name: 'เงินกู้', amount: 1_000, balance: 500 },
      ],
    }));
    expect(r.allowances).toBeCloseTo(1_600 + 516.13, 2);
    expect(r.taxableRegular).toBe(17_600);
    expect(r.loans).toBe(500);
    expect(r.recurringTaken).toEqual([{ itemId: 'l1', amount: 500 }]);
    expect(r.earnings.map((e) => e.code)).toEqual(['SALARY', 'POS', 'PERDIEM']);
    expect(r.deductions.map((e) => e.code)).toEqual(['SSO', 'LOAN']);
    expect(r.net).toBe(round2(r.gross - r.totalDeductions));
  });

  it('warns when deductions exceed pay', () => {
    expect(calculateLine(base({ otherDeduction: 20_000 })).warnings.join()).toContain('ติดลบ');
  });
});

describe('accounting postings', () => {
  it('balance debits and credits', () => {
    const r = calculateLine(base({ baseSalary: 30_000, pvdEmployeePct: 3, pvdEmployerPct: 5, unpaidLeaveDays: 1, bonus: 5_000, ot: { x1: 0, x15: 2, x2: 0, x3: 0 },
      recurring: [{ id: 'l', kind: 'deduction', code: 'LOAN', name: 'เงินกู้', amount: 700 }] }));
    const p = postings({ ...r, totalDeductions: r.totalDeductions });
    const sum = (side: string) => round2(p.filter((x) => x.side === side).reduce((s, x) => s + x.amount, 0));
    expect(sum('debit')).toBe(sum('credit'));
    expect(p.find((x) => x.category === 'net_pay_payable')!.amount).toBe(r.net);
  });
});

function round2(x: number) { return Math.round(x * 100) / 100; }
