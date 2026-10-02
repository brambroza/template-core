/**
 * Thai payroll calculation engine — pure functions, no database, no I/O (unit-tested in test/calc.test.ts).
 *
 * Every legal number (SSO rate and wage band, tax allowances, brackets, OT multipliers) comes from `PayrollRules`
 * so a customer can follow a change in the law from the settings screen without a code change.
 * Defaults are the rules as of 2026 that we could confirm — see DEFAULT_RULES and the module CLAUDE.md.
 * SSO rates and wage band are effective-dated (`ssoSchedule`, picked by the pay month) so a law change never rewrites old months.
 */
import { round } from '@erp/thai';

export interface TaxBracket {
  /** upper bound of net income for this band (inclusive); null = no upper bound */
  upTo: number | null;
  /** percent, e.g. 5 */
  rate: number;
}

export interface PayrollRules {
  sso: {
    /** percent of the wage base, e.g. 5 */
    employeeRate: number;
    employerRate: number;
    /** wage base floor / ceiling (บาท/เดือน) */
    wageMin: number;
    wageMax: number;
    /** count overtime pay as wage for SSO (default false: OT is not "ค่าจ้างในเวลาทำงานปกติ") */
    includeOvertime: boolean;
  };
  tax: {
    /** ค่าใช้จ่าย 40(1): rate (0.5) and cap (100,000) */
    expenseRate: number;
    expenseCap: number;
    personal: number;
    spouse: number;
    /** per child */
    child: number;
    /** per second-or-later child born 2018 or later */
    child2018: number;
    /** per parent supported (max 4) */
    parent: number;
    lifeInsuranceCap: number;
    healthInsuranceCap: number;
    /** life + health together */
    lifeHealthCap: number;
    parentHealthCap: number;
    homeLoanCap: number;
    /** provident fund: max share of wages and absolute cap */
    pvdRateCap: number;
    pvdCap: number;
    brackets: TaxBracket[];
  };
  /** hours in a normal working day (hourly rate = daily rate / hoursPerDay) */
  hoursPerDay: number;
  /** daily rate of a monthly employee = salary / daysPerMonth (LPA: 30) */
  daysPerMonth: number;
  /** pro-rata of a monthly salary for a partial month: by calendar days of the month, or salary / 30 × days */
  proration: 'calendar' | 'days30';
  /** default paid days of a daily-wage employee for a full month when none are entered */
  defaultDailyWorkDays: number;
  /** OT multipliers of the hourly rate */
  ot: { x1: number; x15: number; x2: number; x3: number };
  /**
   * Effective-dated SSO rates and wage band (C1): the row in force on the 1st of the pay month wins over `sso`'s
   * rates/band (`sso.includeOvertime` stays a company setting). Empty/absent = use `sso` as is.
   */
  ssoSchedule?: SsoRule[];
}

/** One effective-dated SSO rule (มาตรา 33): rates and wage band from `effectiveFrom` (YYYY-MM-DD) until the next rule. */
export interface SsoRule {
  effectiveFrom: string;
  employeeRate: number;
  employerRate: number;
  wageMin: number;
  wageMax: number;
  /** true = the company's own override row; false = statutory row shipped with the software */
  custom?: boolean;
  note?: string | null;
}

/**
 * Statutory SSO schedule shipped with the software (mirrored by migrations/003_sso_rules.sql seed rows).
 * Ceiling 15,000 until 2025; cabinet-approved steps (ครม. ธ.ค. 2568): 17,500 from 1 Jan 2026 (2569), 20,000 from 2029 (2572),
 * 23,000 from 2032 (2575). Floor 1,650, 5% + 5%. Temporary rate cuts are entered by the company as their own rows.
 */
export const STATUTORY_SSO_SCHEDULE: SsoRule[] = [
  { effectiveFrom: '1990-01-01', employeeRate: 5, employerRate: 5, wageMin: 1_650, wageMax: 15_000, note: 'เพดานค่าจ้างเดิม 15,000 บาท' },
  { effectiveFrom: '2026-01-01', employeeRate: 5, employerRate: 5, wageMin: 1_650, wageMax: 17_500, note: 'ครม. อนุมัติ ธ.ค. 2568 — เพดาน 17,500 สมทบสูงสุด 875' },
  { effectiveFrom: '2029-01-01', employeeRate: 5, employerRate: 5, wageMin: 1_650, wageMax: 20_000, note: 'ขั้นที่ 2 ตามแผน (2572–2574) — เพดาน 20,000' },
  { effectiveFrom: '2032-01-01', employeeRate: 5, employerRate: 5, wageMin: 1_650, wageMax: 23_000, note: 'ขั้นที่ 3 ตามแผน (2575 เป็นต้นไป) — เพดาน 23,000' },
];

/**
 * Merge statutory and company rows into one schedule sorted by date; on the same date the company row wins.
 * A later statutory step supersedes an earlier company override (a change in the law applies to everyone).
 */
export function buildSsoSchedule(statutory: SsoRule[], custom: SsoRule[] = []): SsoRule[] {
  const byDate = new Map<string, SsoRule>();
  for (const r of statutory) byDate.set(r.effectiveFrom, { ...r, custom: false });
  for (const r of custom) byDate.set(r.effectiveFrom, { ...r, custom: true });
  return [...byDate.values()].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
}

/** The SSO rule in force for a pay month (YYYY-MM) or a date (YYYY-MM-DD): the latest row with effectiveFrom ≤ the 1st of that month. */
export function ssoRuleFor(periodOrDate: string, schedule: SsoRule[]): SsoRule | null {
  const day = periodOrDate.length === 7 ? `${periodOrDate}-01` : periodOrDate.slice(0, 7) + '-01';
  let hit: SsoRule | null = null;
  for (const r of schedule) if (r.effectiveFrom <= day && (!hit || r.effectiveFrom >= hit.effectiveFrom)) hit = r;
  return hit;
}

/** `rules.sso` with the rates/band of the schedule row in force for the period (unchanged when no row applies). */
export function ssoFor(period: string, rules: PayrollRules): PayrollRules['sso'] {
  const r = rules.ssoSchedule?.length ? ssoRuleFor(period, rules.ssoSchedule) : null;
  if (!r) return rules.sso;
  return { ...rules.sso, employeeRate: r.employeeRate, employerRate: r.employerRate, wageMin: r.wageMin, wageMax: r.wageMax };
}

export const DEFAULT_BRACKETS: TaxBracket[] = [
  { upTo: 150_000, rate: 0 },
  { upTo: 300_000, rate: 5 },
  { upTo: 500_000, rate: 10 },
  { upTo: 750_000, rate: 15 },
  { upTo: 1_000_000, rate: 20 },
  { upTo: 2_000_000, rate: 25 },
  { upTo: 5_000_000, rate: 30 },
  { upTo: null, rate: 35 },
];

export const DEFAULT_RULES: PayrollRules = {
  sso: { employeeRate: 5, employerRate: 5, wageMin: 1_650, wageMax: 15_000, includeOvertime: false },
  tax: {
    expenseRate: 0.5, expenseCap: 100_000,
    personal: 60_000, spouse: 60_000, child: 30_000, child2018: 60_000, parent: 30_000,
    lifeInsuranceCap: 100_000, healthInsuranceCap: 25_000, lifeHealthCap: 100_000, parentHealthCap: 15_000, homeLoanCap: 100_000,
    pvdRateCap: 0.15, pvdCap: 500_000,
    brackets: DEFAULT_BRACKETS,
  },
  hoursPerDay: 8,
  daysPerMonth: 30,
  proration: 'calendar',
  defaultDailyWorkDays: 26,
  ot: { x1: 1, x15: 1.5, x2: 2, x3: 3 },
  ssoSchedule: STATUTORY_SSO_SCHEDULE,
};

/** Deep-merge stored settings over the defaults (unknown keys ignored). */
export function mergeRules(stored: unknown): PayrollRules {
  const s = (stored ?? {}) as Partial<PayrollRules>;
  return {
    ...DEFAULT_RULES,
    ...pick(s, ['hoursPerDay', 'daysPerMonth', 'proration', 'defaultDailyWorkDays']),
    sso: { ...DEFAULT_RULES.sso, ...(s.sso ?? {}) },
    tax: { ...DEFAULT_RULES.tax, ...(s.tax ?? {}), brackets: s.tax?.brackets?.length ? s.tax.brackets : DEFAULT_RULES.tax.brackets },
    ot: { ...DEFAULT_RULES.ot, ...(s.ot ?? {}) },
    // the schedule never comes from the stored settings json — it lives in the sso_rules table (service passes it in)
    ssoSchedule: DEFAULT_RULES.ssoSchedule,
  };
}

function pick<T extends object>(o: T, keys: (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

/* ---------------- building blocks ---------------- */

/** Round half up to whole baht (SSO: "เศษตั้งแต่ 50 สตางค์ขึ้นไปปัดเป็นหนึ่งบาท ต่ำกว่านั้นปัดทิ้ง"). */
export function roundBaht(x: number): number {
  return Math.floor(round(x, 2) + 0.5);
}

/** SSO contribution on a monthly wage: 0 when no wage, else rate × wage clamped to [wageMin, wageMax], whole baht. */
export function ssoContribution(wage: number, rate: number, rules: PayrollRules['sso']): number {
  if (!(wage > 0) || !(rate > 0)) return 0;
  const base = Math.min(Math.max(wage, rules.wageMin), rules.wageMax);
  return roundBaht((base * rate) / 100);
}

/** Progressive personal income tax on annual net income. */
export function progressiveTax(netIncome: number, brackets: TaxBracket[]): number {
  let tax = 0;
  let lower = 0;
  for (const b of brackets) {
    const upper = b.upTo ?? Infinity;
    if (netIncome > lower) tax += ((Math.min(netIncome, upper) - lower) * b.rate) / 100;
    if (netIncome <= upper) break;
    lower = upper;
  }
  return round(tax, 2);
}

export interface TaxProfile {
  spouse: boolean;
  children: number;
  children2018: number;
  parents: number;
  lifeInsurance: number;
  healthInsurance: number;
  parentHealthInsurance: number;
  homeLoanInterest: number;
  /** any other annual deduction the employee declared (ลดหย่อนอื่นๆ, e.g. RMF/SSF/donation after limits) */
  otherDeductions: number;
}

export const NO_TAX_PROFILE: TaxProfile = {
  spouse: false, children: 0, children2018: 0, parents: 0, lifeInsurance: 0, healthInsurance: 0, parentHealthInsurance: 0, homeLoanInterest: 0, otherDeductions: 0,
};

/** Annual net income for tax (เงินได้สุทธิ) and the deductions used, from annual 40(1) income. */
export function annualNetIncome(income: number, sso: number, pvd: number, p: TaxProfile, rules: PayrollRules['tax']) {
  const expense = Math.min(income * rules.expenseRate, rules.expenseCap);
  const life = Math.min(Math.max(p.lifeInsurance, 0), rules.lifeInsuranceCap);
  const health = Math.min(Math.max(p.healthInsurance, 0), rules.healthInsuranceCap);
  const deductions = {
    expense,
    personal: rules.personal,
    spouse: p.spouse ? rules.spouse : 0,
    children: Math.max(p.children, 0) * rules.child + Math.max(p.children2018, 0) * rules.child2018,
    parents: Math.min(Math.max(p.parents, 0), 4) * rules.parent,
    sso: Math.max(sso, 0),
    pvd: Math.min(Math.max(pvd, 0), income * rules.pvdRateCap, rules.pvdCap),
    insurance: Math.min(life + health, rules.lifeHealthCap),
    parentHealth: Math.min(Math.max(p.parentHealthInsurance, 0), rules.parentHealthCap),
    homeLoan: Math.min(Math.max(p.homeLoanInterest, 0), rules.homeLoanCap),
    other: Math.max(p.otherDeductions, 0),
  };
  const total = Object.values(deductions).reduce((s, v) => s + v, 0);
  return { net: round(Math.max(0, income - total), 2), deductions };
}

/** Days of `period` (YYYY-MM) during which the person was employed, and the days in the month. */
export function employedDays(period: string, startDate?: string | null, endDate?: string | null) {
  const [y, m] = period.split('-').map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const first = `${period}-01`;
  const last = `${period}-${String(daysInMonth).padStart(2, '0')}`;
  const from = startDate && startDate > first ? startDate : first;
  const to = endDate && endDate < last ? endDate : last;
  if (from > to) return { days: 0, daysInMonth };
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  return { days, daysInMonth };
}

/** Monthly salary for the employed part of the month. */
export function proratedSalary(salary: number, days: number, daysInMonth: number, rules: PayrollRules): number {
  if (days >= daysInMonth) return round(salary, 2);
  if (days <= 0) return 0;
  return rules.proration === 'days30'
    ? round(Math.min(salary, (salary / rules.daysPerMonth) * days), 2)
    : round((salary * days) / daysInMonth, 2);
}

/* ---------------- one employee, one month ---------------- */

export interface RecurringItem {
  id?: string;
  kind: 'earning' | 'deduction';
  code: string;
  name: string;
  amount: number;
  /** earnings: part of 40(1) taxable income (default true) */
  taxable?: boolean;
  /** earnings: part of the SSO wage (default false) */
  sso?: boolean;
  /** deductions: remaining balance of a loan; the deduction never exceeds it (null = no balance) */
  balance?: number | null;
}

export interface YearToDate {
  /** 40(1) income already paid this tax year (before this period) — regular part (salary-like) */
  regular: number;
  /** irregular part (OT, bonus, other one-off income) */
  irregular: number;
  tax: number;
  sso: number;
  pvd: number;
}

export const NO_YTD: YearToDate = { regular: 0, irregular: 0, tax: 0, sso: 0, pvd: 0 };

export interface LineInput {
  /** YYYY-MM */
  period: string;
  payType: 'monthly' | 'daily';
  baseSalary: number;
  dailyWage: number;
  startDate?: string | null;
  endDate?: string | null;
  /** daily-wage employees: paid days (null = rules.defaultDailyWorkDays, pro-rata for a partial month) */
  workDays?: number | null;
  ot: { x1: number; x15: number; x2: number; x3: number };
  /** monthly employees: unpaid leave days, deducted at salary / daysPerMonth per day */
  unpaidLeaveDays: number;
  /** irregular taxable income */
  bonus: number;
  otherIncome: number;
  otherDeduction: number;
  recurring: RecurringItem[];
  ssoEnrolled: boolean;
  pvdEmployeePct: number;
  pvdEmployerPct: number;
  tax: TaxProfile;
  ytd: YearToDate;
}

export interface Entry {
  code: string;
  name: string;
  amount: number;
  itemId?: string;
}

export interface LineResult {
  employedDays: number;
  daysInMonth: number;
  workDays: number | null;
  dailyRate: number;
  hourlyRate: number;
  salary: number;
  overtime: number;
  allowances: number;
  bonus: number;
  otherIncome: number;
  gross: number;
  unpaidLeave: number;
  ssoWage: number;
  ssoEmployee: number;
  ssoEmployer: number;
  pvdEmployee: number;
  pvdEmployer: number;
  wht: number;
  loans: number;
  otherDeduction: number;
  totalDeductions: number;
  net: number;
  taxableRegular: number;
  taxableIrregular: number;
  earnings: Entry[];
  deductions: Entry[];
  /** recurring deductions taken this month (to reduce loan balances when the run is paid) */
  recurringTaken: { itemId: string; amount: number }[];
  tax: {
    remainingPeriods: number;
    projectedIncome: number;
    projectedSso: number;
    projectedPvd: number;
    netIncome: number;
    annualTax: number;
    regularPart: number;
    irregularPart: number;
  };
  warnings: string[];
}

const nn = (x: number | null | undefined) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? x : 0);

/**
 * Monthly withholding (ภ.ง.ด.1) by the annualised method with year-to-date correction:
 *  - regular income is projected over the rest of the year: YTD regular + this month + full month × (remaining periods − 1);
 *  - tax on (projection + YTD irregular), minus tax already withheld, is spread over the remaining periods;
 *  - irregular income of this month (OT, bonus, other) is taxed in full now at the marginal rate:
 *    tax(with it) − tax(without it).
 * A joiner's projection covers only the months they are employed; a leaver's last month has 1 remaining period.
 */
export function calculateLine(i: LineInput, rules: PayrollRules = DEFAULT_RULES): LineResult {
  const warnings: string[] = [];
  const { days, daysInMonth } = employedDays(i.period, i.startDate, i.endDate);
  const fraction = daysInMonth ? days / daysInMonth : 0;
  const monthly = i.payType === 'monthly';

  // base pay
  let salary: number;
  let workDays: number | null = null;
  let dailyRate: number;
  if (monthly) {
    dailyRate = round(nn(i.baseSalary) / rules.daysPerMonth, 4);
    salary = proratedSalary(nn(i.baseSalary), days, daysInMonth, rules);
  } else {
    dailyRate = nn(i.dailyWage);
    workDays = i.workDays ?? (days ? Math.round(rules.defaultDailyWorkDays * fraction) : 0);
    salary = round(dailyRate * workDays, 2);
    if (i.workDays == null && days) warnings.push(`ไม่ได้กรอกวันทำงาน ใช้ค่าเริ่มต้น ${workDays} วัน`);
  }
  const hourlyRate = round(dailyRate / rules.hoursPerDay, 4);
  if (!days) warnings.push('ไม่ได้อยู่ในช่วงจ้างงานของเดือนนี้');
  // e.g. a profile created from HR (hr.employee_upserted) whose pay has not been keyed in yet
  if (days && !(monthly ? nn(i.baseSalary) : nn(i.dailyWage))) warnings.push('ยังไม่ได้กรอกเงินเดือน/ค่าจ้างในข้อมูลเงินเดือนพนักงาน');

  // unpaid leave (monthly only — a daily employee is simply not paid for days not worked)
  const unpaidLeave = monthly ? round(Math.min(salary, nn(i.unpaidLeaveDays) * dailyRate), 2) : 0;
  if (!monthly && nn(i.unpaidLeaveDays)) warnings.push('พนักงานรายวัน: วันลาไม่รับค่าจ้างไม่ถูกหัก (นับเฉพาะวันทำงาน)');

  const otUnits = nn(i.ot.x1) * rules.ot.x1 + nn(i.ot.x15) * rules.ot.x15 + nn(i.ot.x2) * rules.ot.x2 + nn(i.ot.x3) * rules.ot.x3;
  const overtime = round(hourlyRate * otUnits, 2);

  // recurring items — monthly earnings are pro-rated for a partial month
  const earnings: Entry[] = [{ code: 'SALARY', name: monthly ? 'เงินเดือน' : `ค่าจ้างรายวัน (${workDays} วัน)`, amount: salary }];
  if (overtime) earnings.push({ code: 'OT', name: 'ค่าล่วงเวลา', amount: overtime });
  let allowances = 0;
  let allowTaxable = 0;
  let allowSso = 0;
  let allowTaxableFull = 0;
  let allowSsoFull = 0;
  for (const it of i.recurring.filter((x) => x.kind === 'earning')) {
    const full = round(nn(it.amount), 2);
    const amount = monthly && days < daysInMonth ? round(full * fraction, 2) : full;
    if (!amount) continue;
    allowances += amount;
    if (it.taxable !== false) { allowTaxable += amount; allowTaxableFull += full; }
    if (it.sso) { allowSso += amount; allowSsoFull += full; }
    earnings.push({ code: it.code, name: it.name, amount, ...(it.id ? { itemId: it.id } : {}) });
  }
  allowances = round(allowances, 2);
  const bonus = round(nn(i.bonus), 2);
  const otherIncome = round(nn(i.otherIncome), 2);
  if (bonus) earnings.push({ code: 'BONUS', name: 'โบนัส', amount: bonus });
  if (otherIncome) earnings.push({ code: 'OTHER', name: 'รายได้อื่น', amount: otherIncome });
  const gross = round(salary + overtime + allowances + bonus + otherIncome, 2);

  // SSO
  const sso = ssoFor(i.period, rules);
  const ssoWage = round(salary - unpaidLeave + allowSso + (sso.includeOvertime ? overtime : 0), 2);
  const ssoEmployee = i.ssoEnrolled ? ssoContribution(ssoWage, sso.employeeRate, sso) : 0;
  const ssoEmployer = i.ssoEnrolled ? ssoContribution(ssoWage, sso.employerRate, sso) : 0;

  // provident fund on basic wages actually earned
  const pvdBase = salary - unpaidLeave;
  const pvdEmployee = round((pvdBase * nn(i.pvdEmployeePct)) / 100, 2);
  const pvdEmployer = round((pvdBase * nn(i.pvdEmployerPct)) / 100, 2);

  // taxable income
  const taxableRegular = round(salary - unpaidLeave + allowTaxable, 2);
  const taxableIrregular = round(overtime + bonus + otherIncome, 2);

  // projection
  const month = Number(i.period.slice(5, 7));
  const lastDay = `${i.period}-${String(daysInMonth).padStart(2, '0')}`;
  const leaving = !!i.endDate && i.endDate <= lastDay;
  const remaining = leaving ? 1 : 13 - month;
  const fullMonth = monthly ? nn(i.baseSalary) : round(nn(i.dailyWage) * rules.defaultDailyWorkDays, 2);
  const future = remaining - 1;
  const futureSsoWage = fullMonth + allowSsoFull;
  const projectedRegular = i.ytd.regular + taxableRegular + (fullMonth + allowTaxableFull) * future;
  const projectedSso = i.ytd.sso + ssoEmployee + (i.ssoEnrolled ? ssoContribution(futureSsoWage, sso.employeeRate, sso) : 0) * future;
  const projectedPvd = i.ytd.pvd + pvdEmployee + round((fullMonth * nn(i.pvdEmployeePct)) / 100, 2) * future;
  const baseIncome = projectedRegular + i.ytd.irregular;
  const without = annualNetIncome(baseIncome, projectedSso, projectedPvd, i.tax, rules.tax);
  const withIrr = annualNetIncome(baseIncome + taxableIrregular, projectedSso, projectedPvd, i.tax, rules.tax);
  const taxWithout = progressiveTax(without.net, rules.tax.brackets);
  const taxWith = progressiveTax(withIrr.net, rules.tax.brackets);
  const regularPart = round(Math.max(0, (taxWithout - i.ytd.tax) / remaining), 2);
  const irregularPart = round(Math.max(0, taxWith - taxWithout), 2);
  const wht = round(regularPart + irregularPart, 2);

  // deductions
  const deductions: Entry[] = [];
  if (ssoEmployee) deductions.push({ code: 'SSO', name: 'ประกันสังคม', amount: ssoEmployee });
  if (wht) deductions.push({ code: 'WHT', name: 'ภาษีหัก ณ ที่จ่าย', amount: wht });
  if (pvdEmployee) deductions.push({ code: 'PVD', name: 'กองทุนสำรองเลี้ยงชีพ', amount: pvdEmployee });
  if (unpaidLeave) deductions.push({ code: 'UNPAID', name: `ลาไม่รับค่าจ้าง ${nn(i.unpaidLeaveDays)} วัน`, amount: unpaidLeave });
  const recurringTaken: { itemId: string; amount: number }[] = [];
  let loans = 0;
  for (const it of i.recurring.filter((x) => x.kind === 'deduction')) {
    const cap = it.balance === null || it.balance === undefined ? Infinity : Math.max(0, it.balance);
    const amount = round(Math.min(nn(it.amount), cap), 2);
    if (!amount) continue;
    loans += amount;
    deductions.push({ code: it.code, name: it.name, amount, ...(it.id ? { itemId: it.id } : {}) });
    if (it.id) recurringTaken.push({ itemId: it.id, amount });
  }
  loans = round(loans, 2);
  const otherDeduction = round(nn(i.otherDeduction), 2);
  if (otherDeduction) deductions.push({ code: 'OTHER', name: 'รายการหักอื่น', amount: otherDeduction });
  const totalDeductions = round(ssoEmployee + wht + pvdEmployee + unpaidLeave + loans + otherDeduction, 2);
  const net = round(gross - totalDeductions, 2);
  if (net < 0) warnings.push('ยอดหักมากกว่ารายได้ — เงินได้สุทธิติดลบ');

  return {
    employedDays: days, daysInMonth, workDays, dailyRate, hourlyRate,
    salary, overtime, allowances, bonus, otherIncome, gross,
    unpaidLeave, ssoWage, ssoEmployee, ssoEmployer, pvdEmployee, pvdEmployer, wht, loans, otherDeduction, totalDeductions, net,
    taxableRegular, taxableIrregular, earnings, deductions, recurringTaken,
    tax: {
      remainingPeriods: remaining, projectedIncome: round(baseIncome + taxableIrregular, 2), projectedSso: round(projectedSso, 2), projectedPvd: round(projectedPvd, 2),
      netIncome: withIrr.net, annualTax: taxWith, regularPart, irregularPart,
    },
    warnings,
  };
}

/* ---------------- accounting summary of a paid run ---------------- */

export interface RunTotals {
  salary: number; overtime: number; allowances: number; bonus: number; otherIncome: number; gross: number;
  unpaidLeave: number; ssoEmployee: number; ssoEmployer: number; pvdEmployee: number; pvdEmployer: number;
  wht: number; loans: number; otherDeduction: number; totalDeductions: number; net: number;
}

export type PostingCategory =
  | 'salary_expense' | 'overtime_expense' | 'allowance_expense' | 'bonus_expense' | 'other_income_expense'
  | 'sso_employer_expense' | 'pvd_employer_expense'
  | 'sso_payable' | 'wht_payable' | 'pvd_payable' | 'employee_deductions' | 'net_pay_payable';

/** Balanced debit/credit lines per account category, for accounting to map to its chart of accounts. Zero lines are left out. */
export function postings(t: RunTotals): { category: PostingCategory; side: 'debit' | 'credit'; amount: number }[] {
  const rows: { category: PostingCategory; side: 'debit' | 'credit'; amount: number }[] = [
    { category: 'salary_expense', side: 'debit', amount: round(t.salary - t.unpaidLeave, 2) },
    { category: 'overtime_expense', side: 'debit', amount: t.overtime },
    { category: 'allowance_expense', side: 'debit', amount: t.allowances },
    { category: 'bonus_expense', side: 'debit', amount: t.bonus },
    { category: 'other_income_expense', side: 'debit', amount: t.otherIncome },
    { category: 'sso_employer_expense', side: 'debit', amount: t.ssoEmployer },
    { category: 'pvd_employer_expense', side: 'debit', amount: t.pvdEmployer },
    { category: 'sso_payable', side: 'credit', amount: round(t.ssoEmployee + t.ssoEmployer, 2) },
    { category: 'wht_payable', side: 'credit', amount: t.wht },
    { category: 'pvd_payable', side: 'credit', amount: round(t.pvdEmployee + t.pvdEmployer, 2) },
    { category: 'employee_deductions', side: 'credit', amount: round(t.loans + t.otherDeduction, 2) },
    { category: 'net_pay_payable', side: 'credit', amount: t.net },
  ];
  return rows.filter((r) => r.amount !== 0);
}
