import { auth, badRequest, conflict, forbidden, hasPerm, loadManifest, notFound, one, parse, requirePerm, s, z, type AuthContext, type Client, type ServiceDefinition } from '@erp/kernel';
import type { EventData } from '@erp/contracts';
import { bahtText, round, toBuddhistYear } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { calculateLine, mergeRules, postings, type PayrollRules, type RecurringItem, type RunTotals, type YearToDate } from './calc.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const optText = (max = 200) => z.string().trim().max(max).optional();
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'รูปแบบเดือนต้องเป็น YYYY-MM');
const pct = z.number().finite().min(0).max(15);
const count = (max: number) => z.number().int().min(0).max(max);
const IdParam = z.object({ id: s.uuid });
const flag = z.enum(['true', 'false', '1', '0']).optional().transform((v) => (v === undefined ? undefined : v === 'true' || v === '1'));

/** Never keep a full account number: accept what the user typed, store only its last 4 digits. */
const bankAccount = z.string().trim().max(40).transform((v, ctx) => {
  const digits = v.replace(/\D/g, '');
  if (digits.length < 4) { ctx.addIssue({ code: 'custom', message: 'เลขบัญชีต้องมีอย่างน้อย 4 หลัก' }); return z.NEVER; }
  return digits.slice(-4);
});

const ProfileFields = {
  employeeCode: s.code,
  employeeName: s.name,
  employeeId: s.uuid.nullable().optional(),
  department: optText(),
  position: optText(),
  userId: s.uuid.nullable().optional(),
  userName: optText(),
  payType: z.enum(['monthly', 'daily']),
  baseSalary: s.money,
  dailyWage: s.money,
  startDate: s.isoDate.nullable().optional(),
  endDate: s.isoDate.nullable().optional(),
  bankName: optText(100),
  /** full number or last 4 — only the last 4 digits are stored */
  bankAccount: bankAccount.optional(),
  ssoEnrolled: z.boolean(),
  pvdEmployeePct: pct,
  pvdEmployerPct: pct,
  taxSpouse: z.boolean(),
  taxChildren: count(30),
  taxChildren2018: count(30),
  taxParents: count(4),
  taxLifeInsurance: s.money,
  taxHealthInsurance: s.money,
  taxParentHealth: s.money,
  taxHomeLoan: s.money,
  taxOther: s.money,
  openingYear: z.number().int().min(2000).max(2600).nullable().optional(),
  openingIncome: s.money,
  openingTax: s.money,
  openingSso: s.money,
  openingPvd: s.money,
  active: z.boolean(),
  note: optText(1000),
};
const ProfileInput = z.object({
  ...ProfileFields,
  payType: ProfileFields.payType.default('monthly'),
  baseSalary: s.money.default(0), dailyWage: s.money.default(0), ssoEnrolled: z.boolean().default(true),
  pvdEmployeePct: pct.default(0), pvdEmployerPct: pct.default(0), taxSpouse: z.boolean().default(false),
  taxChildren: count(30).default(0), taxChildren2018: count(30).default(0), taxParents: count(4).default(0),
  taxLifeInsurance: s.money.default(0), taxHealthInsurance: s.money.default(0), taxParentHealth: s.money.default(0), taxHomeLoan: s.money.default(0), taxOther: s.money.default(0),
  openingIncome: s.money.default(0), openingTax: s.money.default(0), openingSso: s.money.default(0), openingPvd: s.money.default(0), active: z.boolean().default(true),
});
const ProfilePatch = z.object(ProfileFields).partial();

const PROFILE_COLS: Record<string, string> = {
  employeeCode: 'employee_code', employeeName: 'employee_name', employeeId: 'employee_id', department: 'department', position: 'position',
  userId: 'user_id', userName: 'user_name', payType: 'pay_type', baseSalary: 'base_salary', dailyWage: 'daily_wage', startDate: 'start_date', endDate: 'end_date',
  bankName: 'bank_name', bankAccount: 'bank_account_last4', ssoEnrolled: 'sso_enrolled', pvdEmployeePct: 'pvd_employee_pct', pvdEmployerPct: 'pvd_employer_pct',
  taxSpouse: 'tax_spouse', taxChildren: 'tax_children', taxChildren2018: 'tax_children2018', taxParents: 'tax_parents', taxLifeInsurance: 'tax_life_insurance',
  taxHealthInsurance: 'tax_health_insurance', taxParentHealth: 'tax_parent_health', taxHomeLoan: 'tax_home_loan', taxOther: 'tax_other',
  openingYear: 'opening_year', openingIncome: 'opening_income', openingTax: 'opening_tax', openingSso: 'opening_sso', openingPvd: 'opening_pvd',
  active: 'active', note: 'note',
};

const ItemInput = z.object({
  kind: z.enum(['earning', 'deduction']),
  code: s.code,
  name: s.name,
  amount: s.money,
  taxable: z.boolean().default(true),
  sso: z.boolean().default(false),
  balance: s.money.nullable().optional(),
  active: z.boolean().default(true),
  note: optText(500),
});
const ItemPatch = z.object({
  name: s.name.optional(), amount: s.money.optional(), taxable: z.boolean().optional(), sso: z.boolean().optional(),
  balance: s.money.nullable().optional(), active: z.boolean().optional(), note: optText(500),
});

const RunInput = z.object({ period, payDate: s.isoDate, note: optText(1000) });
const PayInput = z.object({ paidDate: s.isoDate.optional(), reference: optText(200) });
const NoteInput = z.object({ note: optText(1000) });

const hours = z.number().finite().min(0).max(744);
const LineInputs = z.object({
  workDays: z.number().finite().min(0).max(31).nullable().optional(),
  ot1Hours: hours.optional(), ot15Hours: hours.optional(), ot2Hours: hours.optional(), ot3Hours: hours.optional(),
  unpaidLeaveDays: z.number().finite().min(0).max(31).optional(),
  bonus: s.money.optional(), otherIncome: s.money.optional(), otherDeduction: s.money.optional(),
  note: optText(500),
});
const INPUT_COLS: Record<string, string> = {
  workDays: 'work_days', ot1Hours: 'ot1_hours', ot15Hours: 'ot15_hours', ot2Hours: 'ot2_hours', ot3Hours: 'ot3_hours',
  unpaidLeaveDays: 'unpaid_leave_days', bonus: 'bonus', otherIncome: 'other_income', otherDeduction: 'other_deduction', note: 'input_note',
};

const SettingsInput = z.object({
  ssoEmployeeRate: z.number().min(0).max(20), ssoEmployerRate: z.number().min(0).max(20),
  ssoWageMin: s.money, ssoWageMax: s.money, ssoIncludeOvertime: z.boolean(),
  expenseRatePct: z.number().min(0).max(100), expenseCap: s.money,
  personalAllowance: s.money, spouseAllowance: s.money, childAllowance: s.money, child2018Allowance: s.money, parentAllowance: s.money,
  lifeInsuranceCap: s.money, healthInsuranceCap: s.money, lifeHealthCap: s.money, parentHealthCap: s.money, homeLoanCap: s.money,
  pvdRateCapPct: z.number().min(0).max(100), pvdCap: s.money,
  brackets: z.array(z.object({ upTo: s.money.nullable(), rate: z.number().min(0).max(100) })).min(1).max(20),
  hoursPerDay: z.number().min(1).max(24), daysPerMonth: z.number().min(1).max(31),
  proration: z.enum(['calendar', 'days30']), defaultDailyWorkDays: z.number().min(0).max(31),
  otX1: z.number().min(0).max(10), otX15: z.number().min(0).max(10), otX2: z.number().min(0).max(10), otX3: z.number().min(0).max(10),
  ssoEmployerAccount: z.string().trim().max(50).nullable(), ssoBranch: z.string().trim().max(50).nullable(),
}).partial();

const ListQuery = s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) });

export const IMPORT_MAX_ROWS = 2000;
const ImportBody = z.object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(IMPORT_MAX_ROWS), dryRun: z.boolean().optional() });

/* ---------------- helpers ---------------- */

const STATUS_TH: Record<string, string> = { draft: 'ร่าง', calculated: 'คำนวณแล้ว', approved: 'อนุมัติแล้ว', paid: 'จ่ายแล้ว', cancelled: 'ยกเลิก' };
const PAY_TYPE_TH: Record<string, string> = { monthly: 'รายเดือน', daily: 'รายวัน' };
const MONTH_TH = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน', 'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const periodLabel = (p: string) => `${MONTH_TH[Number(p.slice(5, 7)) - 1]} ${Number(p.slice(0, 4)) + 543}`;
const bangkokToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const like = (q?: string) => (q?.trim() ? `%${q.trim()}%` : null);

/** Anyone who manages payroll (any payroll permission except self-service) */
const isPayrollStaff = (a: AuthContext) => ['payroll.profile.read', 'payroll.run.read'].some((p) => hasPerm(a, p));

async function loadRules(c: Client): Promise<{ rules: PayrollRules; row: any }> {
  const row = (await c.query('select * from payroll_settings')).rows[0] ?? null;
  return { rules: mergeRules(row?.rules), row };
}

function decorateProfile(p: any) {
  p.pay_type_label = PAY_TYPE_TH[p.pay_type] ?? p.pay_type;
  p.rate = p.pay_type === 'daily' ? p.daily_wage : p.base_salary;
  p.bank_account = p.bank_account_last4 ? `xxxxxx${p.bank_account_last4}` : null;
  return p;
}

async function loadProfile(c: Client, id: string) {
  const p = decorateProfile(await one(c, 'select * from pay_profiles where id = $1', [id], 'Pay profile'));
  p.items = (await c.query('select * from pay_items where profile_id = $1 order by kind, code', [id])).rows;
  return p;
}

/** Rules that span fields (checked after a PATCH is merged too). */
function checkProfile(p: Record<string, any>) {
  const fieldErrors: Record<string, string[]> = {};
  if (p.pay_type === 'monthly' && !(Number(p.base_salary) > 0)) fieldErrors.baseSalary = ['พนักงานรายเดือนต้องมีเงินเดือน'];
  if (p.pay_type === 'daily' && !(Number(p.daily_wage) > 0)) fieldErrors.dailyWage = ['พนักงานรายวันต้องมีค่าจ้างต่อวัน'];
  if (p.start_date && p.end_date && p.end_date < p.start_date) fieldErrors.endDate = ['วันสิ้นสุดต้องไม่ก่อนวันเริ่มงาน'];
  const ee = Number(p.pvd_employee_pct);
  const er = Number(p.pvd_employer_pct);
  if (ee > 0 && ee < 2) fieldErrors.pvdEmployeePct = ['เงินสะสมกองทุนสำรองเลี้ยงชีพต้อง 2–15% ของค่าจ้าง'];
  if (ee > 0 && er < ee) fieldErrors.pvdEmployerPct = ['เงินสมทบนายจ้างต้องไม่น้อยกว่าเงินสะสมของลูกจ้าง'];
  if (Object.keys(fieldErrors).length) throw badRequest(Object.values(fieldErrors)[0][0], { fieldErrors });
}

function toColumns(b: Record<string, unknown>, map: Record<string, string>) {
  const cols: string[] = [];
  const values: unknown[] = [];
  for (const [k, v] of Object.entries(b)) if (v !== undefined && map[k]) { cols.push(map[k]); values.push(v); }
  return { cols, values };
}

async function codeTaken(c: Client, code: string, exceptId?: string) {
  const r = await c.query('select 1 from pay_profiles where lower(employee_code) = lower($1) and ($2::uuid is null or id <> $2)', [code, exceptId ?? null]);
  if (r.rowCount) throw conflict(`รหัสพนักงาน ${code} มีข้อมูลเงินเดือนอยู่แล้ว`);
}

async function userTaken(c: Client, userId: string | null | undefined, exceptId?: string) {
  if (!userId) return;
  const r = await c.query('select employee_code from pay_profiles where user_id = $1 and ($2::uuid is null or id <> $2)', [userId, exceptId ?? null]);
  if (r.rowCount) throw conflict(`ผู้ใช้นี้ผูกกับพนักงาน ${r.rows[0].employee_code} อยู่แล้ว`);
}

async function loadRun(c: Client, id: string, lock = false) {
  const run = await one(c, `select * from pay_runs where id = $1 ${lock ? 'for update' : ''}`, [id], 'Payroll run');
  return decorateRun(run);
}

function decorateRun(r: any) {
  r.status_label = STATUS_TH[r.status] ?? r.status;
  r.period_label = periodLabel(r.period);
  r.employer_cost = round(Number(r.gross) + Number(r.sso_employer) + Number(r.pvd_employer));
  return r;
}

function decorateLine(l: any) {
  l.pay_type_label = PAY_TYPE_TH[l.pay_type] ?? l.pay_type;
  l.ot_hours = round(Number(l.ot1_hours) + Number(l.ot15_hours) + Number(l.ot2_hours) + Number(l.ot3_hours));
  l.warning_text = (l.warnings ?? []).join(' · ') || null;
  if (l.period) l.period_label = periodLabel(l.period);
  if (l.run_status) l.run_status_label = STATUS_TH[l.run_status] ?? l.run_status;
  return l;
}

async function runDetail(c: Client, id: string) {
  const run = await loadRun(c, id);
  run.lines = (await c.query('select * from pay_lines where run_id = $1 order by employee_code', [id])).rows.map(decorateLine);
  run.problems = run.lines.filter((l: any) => l.warnings?.length).map((l: any) => ({ employee_code: l.employee_code, employee_name: l.employee_name, message: l.warnings.join(' · ') }));
  run.net_text = bahtText(Number(run.net));
  return run;
}

/** 40(1) income, tax, SSO and PVD of a profile already counted this tax year before `period` (approved/paid runs + opening balances). */
async function yearToDate(c: Client, profile: any, per: string): Promise<YearToDate> {
  const year = per.slice(0, 4);
  const r = (await c.query(
    `select coalesce(sum(l.taxable_regular), 0) as regular, coalesce(sum(l.taxable_irregular), 0) as irregular, coalesce(sum(l.wht), 0) as tax,
            coalesce(sum(l.sso_employee), 0) as sso, coalesce(sum(l.pvd_employee), 0) as pvd
     from pay_lines l join pay_runs r on r.id = l.run_id
     where l.profile_id = $1 and r.status in ('approved', 'paid') and r.period like $2 and r.period < $3`, [profile.id, `${year}-%`, per])).rows[0];
  const open = profile.opening_year === Number(year);
  return {
    regular: Number(r.regular) + (open ? Number(profile.opening_income) : 0),
    irregular: Number(r.irregular),
    tax: Number(r.tax) + (open ? Number(profile.opening_tax) : 0),
    sso: Number(r.sso) + (open ? Number(profile.opening_sso) : 0),
    pvd: Number(r.pvd) + (open ? Number(profile.opening_pvd) : 0),
  };
}

const monthBounds = (per: string) => {
  const [y, m] = per.split('-').map(Number);
  return { first: `${per}-01`, last: `${per}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0')}` };
};

/** Make the run's lines match the active profiles employed during its month (inputs of kept lines stay). */
async function syncLines(c: Client, run: any) {
  const { first, last } = monthBounds(run.period);
  const eligible = `active and (start_date is null or start_date <= $2::date) and (end_date is null or end_date >= $1::date)`;
  await c.query(`delete from pay_lines where run_id = $3 and profile_id not in (select id from pay_profiles where ${eligible})`, [first, last, run.id]);
  // new lines start with the unpaid leave HR already approved for the month (hr.leave_decided → leave_inputs)
  await c.query(
    `insert into pay_lines (run_id, profile_id, employee_code, employee_name, department, position, user_id, bank_name, bank_account_last4, pay_type, base_salary, daily_wage, sso_enrolled,
       unpaid_leave_days)
     select $3, p.id, p.employee_code, p.employee_name, p.department, p.position, p.user_id, p.bank_name, p.bank_account_last4, p.pay_type, p.base_salary, p.daily_wage, p.sso_enrolled,
       coalesce((select sum(i.days) from leave_inputs i where i.period = $4 and i.status <> 'late'
                   and (i.profile_id = p.id or (i.profile_id is null and lower(i.employee_code) = lower(p.employee_code)))), 0)
     from pay_profiles p where ${eligible.replace(/(start_date|end_date|active)/g, 'p.$1')}
     on conflict (run_id, profile_id) do nothing`, [first, last, run.id, run.period]);
  await c.query(
    `update leave_inputs i set status = 'applied', run_id = $1, applied_at = now(), profile_id = l.profile_id
     from pay_lines l where l.run_id = $1 and i.period = $2 and i.status = 'pending'
       and (i.profile_id = l.profile_id or (i.profile_id is null and lower(i.employee_code) = lower(l.employee_code)))`, [run.id, run.period]);
}

/* ---------------- HR → payroll (events) ---------------- */

/** The pay profile of an HR employee: linked by HR id, else an unlinked profile with the same employee code. */
async function profileOfEmployee(c: Client, employeeId: string | undefined, code: string | undefined) {
  return (await c.query(
    `select * from pay_profiles where ($1::uuid is not null and employee_id = $1)
        or ($2::text is not null and lower(employee_code) = lower($2) and (employee_id is null or $1::uuid is null))
     order by ($1::uuid is not null and employee_id = $1) desc limit 1`, [employeeId ?? null, code ?? null])).rows[0] ?? null;
}

/**
 * `hr.employee_upserted` → create / update the pay profile snapshot (code, name, department, position, login, start / last day).
 * Salary, bank, tax and SSO settings are payroll's own and never touched. Conflicts (code or login used by another profile) keep the old value.
 */
export async function syncEmployee(c: Client, e: EventData<'hr.employee_upserted'>) {
  const cur = await profileOfEmployee(c, e.employeeId, e.code);
  const codeFree = !(await c.query('select 1 from pay_profiles where employee_code = $1 and ($2::uuid is null or id <> $2)', [e.code, cur?.id ?? null])).rowCount;
  const userFree = e.userId ? !(await c.query('select 1 from pay_profiles where user_id = $1 and ($2::uuid is null or id <> $2)', [e.userId, cur?.id ?? null])).rowCount : true;
  const endDate = e.status === 'resigned' ? e.resignedDate : null;
  if (!cur) {
    if (!codeFree) return; // another employee's profile already uses the code — HR must fix the duplicate code
    await c.query(
      `insert into pay_profiles (employee_code, employee_name, employee_id, department, position, user_id, start_date, end_date, hr_synced_at, note)
       values ($1, $2, $3, $4, $5, $6, $7, $8, now(), 'สร้างจากข้อมูลพนักงาน (ฝ่ายบุคคล) — กรอกเงินเดือน บัญชีธนาคาร และค่าลดหย่อน')`,
      [e.code, e.name, e.employeeId, e.departmentName, e.positionName, userFree ? e.userId : null, e.startDate, endDate]);
    return;
  }
  await c.query(
    `update pay_profiles set employee_code = $2, employee_name = $3, employee_id = $4, department = $5, position = $6,
       user_id = $7, start_date = $8, end_date = $9, hr_synced_at = now(), updated_at = now() where id = $1`,
    [cur.id, codeFree ? e.code : cur.employee_code, e.name, e.employeeId, e.departmentName, e.positionName,
      e.userId === null ? null : userFree ? e.userId : cur.user_id, e.startDate, endDate]);
}

/**
 * `hr.leave_decided` (approved, unpaid type) → unpaid leave days per pay month. Added to the open (draft / calculated) run's line at once
 * (a calculated run is recalculated); otherwise kept `pending` for the run created later, or `late` when that month is already approved / paid.
 * Idempotent per leave + month. Never throws for business reasons.
 */
export async function recordUnpaidLeave(c: Client, e: EventData<'hr.leave_decided'>) {
  if (e.decision !== 'approved' || !e.unpaid || !e.employeeCode) return;
  const months = e.byMonth?.length ? e.byMonth : e.from && e.days !== undefined ? [{ period: e.from.slice(0, 7), days: e.days }] : [];
  const profile = await profileOfEmployee(c, e.employeeId, e.employeeCode);
  for (const m of months) {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m.period) || !(m.days > 0)) continue;
    const ins = (await c.query(
      `insert into leave_inputs (leave_id, leave_no, type_name, employee_id, employee_code, employee_name, profile_id, period, days, from_date, to_date)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict (tenant_id, leave_id, period) do nothing returning id`,
      [e.leaveId, e.no, e.typeName, e.employeeId ?? null, e.employeeCode, e.employeeName, profile?.id ?? null, m.period, m.days, e.from ?? null, e.to ?? null])).rows[0];
    if (!ins) continue;
    const run = (await c.query(`select * from pay_runs where period = $1 and status <> 'cancelled' for update`, [m.period])).rows[0];
    if (!run) continue;
    if (!['draft', 'calculated'].includes(run.status)) {
      await c.query(`update leave_inputs set status = 'late', run_id = $2 where id = $1`, [ins.id, run.id]);
      continue;
    }
    const line = profile ? (await c.query('select id from pay_lines where run_id = $1 and profile_id = $2', [run.id, profile.id])).rows[0] : null;
    if (!line) continue; // picked up when the run's lines are synced
    await c.query('update pay_lines set unpaid_leave_days = unpaid_leave_days + $2, calculated = false, updated_at = now() where id = $1', [line.id, m.days]);
    await c.query(`update leave_inputs set status = 'applied', run_id = $2, applied_at = now() where id = $1`, [ins.id, run.id]);
    if (run.status === 'calculated') {
      await c.query('savepoint payroll_recalc');
      try {
        await calculateRun(c, run.id);
        await c.query('release savepoint payroll_recalc');
      } catch {
        await c.query('rollback to savepoint payroll_recalc'); // the line stays "not calculated": approve refuses until someone recalculates
      }
    }
  }
}

const TOTAL_COLS = ['salary', 'overtime', 'allowances', 'bonus', 'other_income', 'gross', 'unpaid_leave', 'sso_employee', 'sso_employer',
  'pvd_employee', 'pvd_employer', 'wht', 'loans', 'other_deduction', 'total_deductions', 'net'] as const;

/** Calculate every line of a draft/calculated run and its totals; the run becomes `calculated`. */
async function calculateRun(c: Client, runId: string) {
  const run = await loadRun(c, runId, true);
  if (!['draft', 'calculated'].includes(run.status)) throw conflict(`คำนวณรอบเงินเดือนที่${run.status_label}ไม่ได้`);
  await syncLines(c, run);
  const { rules } = await loadRules(c);
  const lines = (await c.query('select * from pay_lines where run_id = $1', [runId])).rows;
  for (const l of lines) {
    const p = (await c.query('select * from pay_profiles where id = $1', [l.profile_id])).rows[0];
    const items: RecurringItem[] = (await c.query('select * from pay_items where profile_id = $1 and active order by kind, code', [p.id])).rows
      .map((x) => ({ id: x.id, kind: x.kind, code: x.code, name: x.name, amount: Number(x.amount), taxable: x.taxable, sso: x.sso, balance: x.balance === null ? null : Number(x.balance) }));
    const r = calculateLine({
      period: run.period, payType: p.pay_type, baseSalary: Number(p.base_salary), dailyWage: Number(p.daily_wage), startDate: p.start_date, endDate: p.end_date,
      workDays: l.work_days === null ? null : Number(l.work_days),
      ot: { x1: Number(l.ot1_hours), x15: Number(l.ot15_hours), x2: Number(l.ot2_hours), x3: Number(l.ot3_hours) },
      unpaidLeaveDays: Number(l.unpaid_leave_days), bonus: Number(l.bonus), otherIncome: Number(l.other_income), otherDeduction: Number(l.other_deduction),
      recurring: items, ssoEnrolled: p.sso_enrolled, pvdEmployeePct: Number(p.pvd_employee_pct), pvdEmployerPct: Number(p.pvd_employer_pct),
      tax: {
        spouse: p.tax_spouse, children: p.tax_children, children2018: p.tax_children2018, parents: p.tax_parents, lifeInsurance: Number(p.tax_life_insurance),
        healthInsurance: Number(p.tax_health_insurance), parentHealthInsurance: Number(p.tax_parent_health), homeLoanInterest: Number(p.tax_home_loan), otherDeductions: Number(p.tax_other),
      },
      ytd: await yearToDate(c, p, run.period),
    }, rules);
    await c.query(
      `update pay_lines set employee_code = $2, employee_name = $3, department = $4, position = $5, user_id = $6, bank_name = $7, bank_account_last4 = $8,
         pay_type = $9, base_salary = $10, daily_wage = $11, sso_enrolled = $12, employed_days = $13, work_days = coalesce(work_days, $14),
         salary = $15, overtime = $16, allowances = $17, gross = $18, unpaid_leave = $19, sso_wage = $20, sso_employee = $21, sso_employer = $22,
         pvd_employee = $23, pvd_employer = $24, wht = $25, loans = $26, total_deductions = $27, net = $28, taxable_regular = $29, taxable_irregular = $30,
         earnings = $31, deductions = $32, recurring_taken = $33, tax_detail = $34, warnings = $35, calculated = true, updated_at = now()
       where id = $1`,
      [l.id, p.employee_code, p.employee_name, p.department, p.position, p.user_id, p.bank_name, p.bank_account_last4, p.pay_type, p.base_salary, p.daily_wage, p.sso_enrolled,
        r.employedDays, l.work_days === null && p.pay_type === 'daily' ? r.workDays : null,
        r.salary, r.overtime, r.allowances, r.gross, r.unpaidLeave, r.ssoWage, r.ssoEmployee, r.ssoEmployer, r.pvdEmployee, r.pvdEmployer, r.wht, r.loans,
        r.totalDeductions, r.net, r.taxableRegular, r.taxableIrregular, JSON.stringify(r.earnings), JSON.stringify(r.deductions), JSON.stringify(r.recurringTaken),
        JSON.stringify(r.tax), JSON.stringify(r.warnings)]);
  }
  await c.query(
    `update pay_runs r set ${TOTAL_COLS.map((col) => `${col} = t.${col}`).join(', ')}, headcount = t.n, status = 'calculated', calculated_at = now(), updated_at = now()
     from (select count(*)::int as n, ${TOTAL_COLS.map((col) => `coalesce(sum(${col}), 0) as ${col}`).join(', ')} from pay_lines where run_id = $1) t
     where r.id = $1`, [runId]);
}

function runTotals(run: any): RunTotals {
  const n = (k: string) => Number(run[k]);
  return {
    salary: n('salary'), overtime: n('overtime'), allowances: n('allowances'), bonus: n('bonus'), otherIncome: n('other_income'), gross: n('gross'),
    unpaidLeave: n('unpaid_leave'), ssoEmployee: n('sso_employee'), ssoEmployer: n('sso_employer'), pvdEmployee: n('pvd_employee'), pvdEmployer: n('pvd_employer'),
    wht: n('wht'), loans: n('loans'), otherDeduction: n('other_deduction'), totalDeductions: n('total_deductions'), net: n('net'),
  };
}

/** One payslip with year-to-date figures (approved/paid runs of the same year up to and including this month, + opening balances). */
async function payslip(c: Client, where: string, params: unknown[]) {
  const l = (await c.query(
    `select l.*, r.no as run_no, r.period, r.pay_date, r.status as run_status, r.paid_at from pay_lines l join pay_runs r on r.id = l.run_id where ${where}`, params)).rows[0];
  if (!l) throw notFound('Payslip');
  decorateLine(l);
  const p = (await c.query('select * from pay_profiles where id = $1', [l.profile_id])).rows[0];
  const before = await yearToDate(c, p, l.period);
  const counts = ['approved', 'paid'].includes(l.run_status);
  l.ytd_income = round(before.regular + before.irregular + (counts ? Number(l.taxable_regular) + Number(l.taxable_irregular) : 0));
  l.ytd_tax = round(before.tax + (counts ? Number(l.wht) : 0));
  l.ytd_sso = round(before.sso + (counts ? Number(l.sso_employee) : 0));
  l.ytd_pvd = round(before.pvd + (counts ? Number(l.pvd_employee) : 0));
  l.net_text = bahtText(Number(l.net));
  l.heading = `${l.employee_code} ${l.period_label}`;
  l.bank_text = l.bank_name ? `${l.bank_name}${l.bank_account_last4 ? ` ลงท้าย ${l.bank_account_last4}` : ''}` : null;
  return l;
}

/* ---- CSV import helpers: values arrive as text from Excel ---- */

function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'number') return v;
  const t = String(v).replace(/[,\s฿]/g, '');
  if (t === '') return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : (NaN as number);
}
function bool(v: unknown): boolean | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const t = String(v).trim().toLowerCase();
  if (['1', 'true', 'y', 'yes', 'ใช่', 'มี', 'สมัคร', 'x', '✓'].includes(t)) return true;
  if (['0', 'false', 'n', 'no', 'ไม่', 'ไม่ใช่', 'ไม่มี', '-'].includes(t)) return false;
  return undefined;
}
/** "2026-10-16", "16/10/2026" or "16/10/2569" (พ.ศ.) */
function date(v: unknown): string | undefined {
  if (v === undefined || v === null || v === '') return undefined;
  const t = String(v).trim();
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return t;
  const y = Number(m[3]) > 2400 ? Number(m[3]) - 543 : Number(m[3]);
  return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
}
const str = (v: unknown) => (v === undefined || v === null || String(v).trim() === '' ? undefined : String(v).trim());
const PAY_TYPE_IN: Record<string, string> = { 'รายเดือน': 'monthly', 'รายวัน': 'daily', monthly: 'monthly', daily: 'daily' };

function profileRow(raw: Record<string, unknown>) {
  const out: Record<string, unknown> = {
    employeeCode: str(raw.employeeCode), employeeName: str(raw.employeeName), department: str(raw.department), position: str(raw.position),
    payType: raw.payType === undefined || raw.payType === '' ? undefined : PAY_TYPE_IN[String(raw.payType).trim().toLowerCase()] ?? raw.payType,
    baseSalary: num(raw.baseSalary), dailyWage: num(raw.dailyWage), startDate: date(raw.startDate), endDate: date(raw.endDate),
    bankName: str(raw.bankName), bankAccount: str(raw.bankAccount), ssoEnrolled: bool(raw.ssoEnrolled),
    pvdEmployeePct: num(raw.pvdEmployeePct), pvdEmployerPct: num(raw.pvdEmployerPct),
    taxSpouse: bool(raw.taxSpouse), taxChildren: num(raw.taxChildren), taxChildren2018: num(raw.taxChildren2018), taxParents: num(raw.taxParents),
    taxLifeInsurance: num(raw.taxLifeInsurance), taxHealthInsurance: num(raw.taxHealthInsurance),
  };
  return Object.fromEntries(Object.entries(out).filter(([, v]) => v !== undefined));
}

const issues = (e: z.ZodError, row: number) => e.issues.map((i) => ({ row, ...(i.path.length ? { field: String(i.path[0]) } : {}), message: i.message }));

/* ---------------- routes ---------------- */

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ----- settings ----- */

    app.get('/settings', async (req) => {
      const a = auth(req);
      if (!isPayrollStaff(a) && !hasPerm(a, 'payroll.setup.write')) throw forbidden('Missing permission: payroll.run.read');
      return k.db.tx(a.tenantId, async (c) => {
        const { rules: r, row } = await loadRules(c);
        return {
          title: 'ตั้งค่าเงินเดือน ประกันสังคม และภาษี',
          ssoEmployeeRate: r.sso.employeeRate, ssoEmployerRate: r.sso.employerRate, ssoWageMin: r.sso.wageMin, ssoWageMax: r.sso.wageMax, ssoIncludeOvertime: r.sso.includeOvertime,
          ssoMaxContribution: Math.round((r.sso.wageMax * r.sso.employeeRate) / 100 * 100) / 100,
          expenseRatePct: r.tax.expenseRate * 100, expenseCap: r.tax.expenseCap,
          personalAllowance: r.tax.personal, spouseAllowance: r.tax.spouse, childAllowance: r.tax.child, child2018Allowance: r.tax.child2018, parentAllowance: r.tax.parent,
          lifeInsuranceCap: r.tax.lifeInsuranceCap, healthInsuranceCap: r.tax.healthInsuranceCap, lifeHealthCap: r.tax.lifeHealthCap, parentHealthCap: r.tax.parentHealthCap,
          homeLoanCap: r.tax.homeLoanCap, pvdRateCapPct: r.tax.pvdRateCap * 100, pvdCap: r.tax.pvdCap,
          brackets: r.tax.brackets.map((b, i, all) => ({ ...b, from: i ? (all[i - 1].upTo ?? 0) + 1 : 0, label: b.upTo === null ? `เกิน ${(all[i - 1]?.upTo ?? 0).toLocaleString('en-US')}` : `ถึง ${b.upTo.toLocaleString('en-US')}` })),
          hoursPerDay: r.hoursPerDay, daysPerMonth: r.daysPerMonth, proration: r.proration, defaultDailyWorkDays: r.defaultDailyWorkDays,
          otX1: r.ot.x1, otX15: r.ot.x15, otX2: r.ot.x2, otX3: r.ot.x3,
          ssoEmployerAccount: row?.sso_employer_account ?? null, ssoBranch: row?.sso_branch ?? null, updatedAt: row?.updated_at ?? null,
        };
      });
    });

    app.put('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.setup.write');
      const b = parse(SettingsInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const { rules: cur, row } = await loadRules(c);
        const pick = <T>(v: T | undefined, d: T) => (v === undefined ? d : v);
        const next: PayrollRules = {
          sso: {
            employeeRate: pick(b.ssoEmployeeRate, cur.sso.employeeRate), employerRate: pick(b.ssoEmployerRate, cur.sso.employerRate),
            wageMin: pick(b.ssoWageMin, cur.sso.wageMin), wageMax: pick(b.ssoWageMax, cur.sso.wageMax), includeOvertime: pick(b.ssoIncludeOvertime, cur.sso.includeOvertime),
          },
          tax: {
            expenseRate: b.expenseRatePct === undefined ? cur.tax.expenseRate : b.expenseRatePct / 100, expenseCap: pick(b.expenseCap, cur.tax.expenseCap),
            personal: pick(b.personalAllowance, cur.tax.personal), spouse: pick(b.spouseAllowance, cur.tax.spouse), child: pick(b.childAllowance, cur.tax.child),
            child2018: pick(b.child2018Allowance, cur.tax.child2018), parent: pick(b.parentAllowance, cur.tax.parent),
            lifeInsuranceCap: pick(b.lifeInsuranceCap, cur.tax.lifeInsuranceCap), healthInsuranceCap: pick(b.healthInsuranceCap, cur.tax.healthInsuranceCap),
            lifeHealthCap: pick(b.lifeHealthCap, cur.tax.lifeHealthCap), parentHealthCap: pick(b.parentHealthCap, cur.tax.parentHealthCap), homeLoanCap: pick(b.homeLoanCap, cur.tax.homeLoanCap),
            pvdRateCap: b.pvdRateCapPct === undefined ? cur.tax.pvdRateCap : b.pvdRateCapPct / 100, pvdCap: pick(b.pvdCap, cur.tax.pvdCap),
            brackets: pick(b.brackets, cur.tax.brackets),
          },
          hoursPerDay: pick(b.hoursPerDay, cur.hoursPerDay), daysPerMonth: pick(b.daysPerMonth, cur.daysPerMonth),
          proration: pick(b.proration, cur.proration), defaultDailyWorkDays: pick(b.defaultDailyWorkDays, cur.defaultDailyWorkDays),
          ot: { x1: pick(b.otX1, cur.ot.x1), x15: pick(b.otX15, cur.ot.x15), x2: pick(b.otX2, cur.ot.x2), x3: pick(b.otX3, cur.ot.x3) },
        };
        if (next.sso.wageMin > next.sso.wageMax) throw badRequest('ฐานค่าจ้างต่ำสุดต้องไม่เกินเพดานค่าจ้าง', { fieldErrors: { ssoWageMin: ['ต้องไม่เกินเพดาน'] } });
        const bounds = next.tax.brackets.map((x) => x.upTo);
        if (bounds.slice(0, -1).some((x, i) => x === null || (i && x <= (bounds[i - 1] as number))) || bounds[bounds.length - 1] !== null) {
          throw badRequest('ขั้นภาษีต้องเรียงจากน้อยไปมาก และขั้นสุดท้ายไม่มีเพดาน (upTo = null)', { fieldErrors: { brackets: ['ขั้นภาษีไม่ถูกต้อง'] } });
        }
        await c.query(
          `insert into payroll_settings (rules, sso_employer_account, sso_branch) values ($1, $2, $3)
           on conflict (tenant_id) do update set rules = excluded.rules, sso_employer_account = excluded.sso_employer_account, sso_branch = excluded.sso_branch, updated_at = now()`,
          [JSON.stringify(next), b.ssoEmployerAccount === undefined ? row?.sso_employer_account ?? null : b.ssoEmployerAccount,
            b.ssoBranch === undefined ? row?.sso_branch ?? null : b.ssoBranch]);
        return { ok: true, rules: next };
      });
    });

    /* ----- pay profiles ----- */

    app.get('/profiles', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.read');
      const q = parse(ListQuery.extend({ active: flag, payType: z.enum(['monthly', 'daily']).optional(), department: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from pay_profiles
         where ($1::text is null or employee_code ilike $1 or employee_name ilike $1 or department ilike $1)
           and ($2::boolean is null or active = $2) and ($3::text is null or pay_type = $3) and ($4::text is null or department ilike $4)
         order by employee_code limit $5 offset $6`,
        [like(q.q), q.active ?? null, q.payType ?? null, like(q.department), q.limit, q.offset])).rows.map(decorateProfile));
    });

    app.get('/profiles/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const p = await loadProfile(c, id);
        p.recent = (await c.query(
          `select l.id, r.no as run_no, r.period, r.status as run_status, l.gross, l.total_deductions, l.net
           from pay_lines l join pay_runs r on r.id = l.run_id where l.profile_id = $1 order by r.period desc limit 12`, [id])).rows.map(decorateLine);
        return p;
      });
    });

    app.post('/profiles', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.write');
      const b = parse(ProfileInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await codeTaken(c, b.employeeCode);
        await userTaken(c, b.userId);
        const { cols, values } = toColumns(b, PROFILE_COLS);
        checkProfile(Object.fromEntries(cols.map((col, i) => [col, values[i]])));
        const row = (await c.query(`insert into pay_profiles (${cols.join(', ')}) values (${cols.map((_, i) => `$${i + 1}`).join(', ')}) returning id`, values)).rows[0];
        return loadProfile(c, row.id);
      });
    });

    app.patch('/profiles/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ProfilePatch, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const cur = await one(c, 'select * from pay_profiles where id = $1 for update', [id], 'Pay profile');
        if (b.employeeCode) await codeTaken(c, b.employeeCode, id);
        if (b.userId) await userTaken(c, b.userId, id);
        const { cols, values } = toColumns(b, PROFILE_COLS);
        checkProfile({ ...cur, ...Object.fromEntries(cols.map((col, i) => [col, values[i]])) });
        if (cols.length) {
          await c.query(`update pay_profiles set ${cols.map((col, i) => `${col} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...values]);
        }
        return loadProfile(c, id);
      });
    });

    /**
     * Bulk upsert from a spreadsheet (e.g. the HR employee list or the old payroll program's export), by employee code.
     * An existing profile changes only in the columns the file filled. A full bank account number is cut to its last 4 digits.
     */
    app.post('/profiles/import', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.write');
      const body = parse(ImportBody, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const errors: { row: number; field?: string; message: string }[] = [];
        const existing = new Map((await c.query('select * from pay_profiles')).rows.map((p) => [p.employee_code.toLowerCase(), p]));
        const seen = new Map<string, number>();
        const valid: { row: number; data: Record<string, unknown>; current?: any }[] = [];
        body.rows.forEach((raw, i) => {
          const row = i + 1;
          const input = profileRow(raw);
          const code = String(input.employeeCode ?? '').toLowerCase();
          const current = code ? existing.get(code) : undefined;
          const r = (current ? ProfilePatch.extend({ employeeCode: s.code }) : ProfileInput).safeParse(input);
          if (!r.success) return void errors.push(...issues(r.error, row));
          if (seen.has(code)) return void errors.push({ row, field: 'employeeCode', message: `รหัสซ้ำกับแถวที่ ${seen.get(code)}` });
          seen.set(code, row);
          const { cols, values } = toColumns(r.data, PROFILE_COLS);
          try {
            checkProfile({ ...(current ?? {}), ...Object.fromEntries(cols.map((col, j) => [col, values[j]])) });
          } catch (e: any) {
            return void errors.push({ row, field: Object.keys(e.details?.fieldErrors ?? {})[0], message: e.message });
          }
          valid.push({ row, data: r.data, current });
        });
        const updated = valid.filter((v) => v.current).length;
        const result = { dryRun: !!body.dryRun, total: body.rows.length, created: valid.length - updated, updated, errors };
        if (body.dryRun) return result;
        if (errors.length) throw badRequest(`นำเข้าไม่ได้: พบปัญหา ${errors.length} จุดในไฟล์ ยังไม่ได้บันทึกข้อมูลใด`, { errors });
        for (const v of valid) {
          const { cols, values } = toColumns(v.data, PROFILE_COLS);
          if (v.current) {
            const set = cols.map((col, j) => [col, values[j]] as const).filter(([col]) => col !== 'employee_code');
            if (set.length) await c.query(`update pay_profiles set ${set.map(([col], j) => `${col} = $${j + 2}`).join(', ')}, updated_at = now() where id = $1`, [v.current.id, ...set.map(([, v2]) => v2)]);
          } else {
            await c.query(`insert into pay_profiles (${cols.join(', ')}) values (${cols.map((_, j) => `$${j + 1}`).join(', ')})`, values);
          }
        }
        return result;
      });
    });

    /* ----- recurring items (allowances, loans) ----- */

    app.get('/items', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.read');
      const q = parse(ListQuery.extend({ kind: z.enum(['earning', 'deduction']).optional(), profileId: s.uuid.optional(), active: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select i.*, p.employee_code, p.employee_name from pay_items i join pay_profiles p on p.id = i.profile_id
         where ($1::text is null or i.code ilike $1 or i.name ilike $1 or p.employee_code ilike $1 or p.employee_name ilike $1)
           and ($2::text is null or i.kind = $2) and ($3::uuid is null or i.profile_id = $3) and ($4::boolean is null or i.active = $4)
         order by p.employee_code, i.kind, i.code limit $5 offset $6`,
        [like(q.q), q.kind ?? null, q.profileId ?? null, q.active ?? null, q.limit, q.offset])).rows
        .map((i) => ({ ...i, kind_label: i.kind === 'earning' ? 'รายได้' : 'รายการหัก' })));
    });

    app.post('/profiles/:id/items', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ItemInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from pay_profiles where id = $1', [id], 'Pay profile');
        if (b.kind === 'earning' && b.balance != null) throw badRequest('ยอดคงเหลือใช้กับรายการหัก (เงินกู้) เท่านั้น', { fieldErrors: { balance: ['ใช้กับรายการหักเท่านั้น'] } });
        await c.query(
          `insert into pay_items (profile_id, kind, code, name, amount, taxable, sso, balance, active, note) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [id, b.kind, b.code, b.name, b.amount, b.kind === 'earning' ? b.taxable : false, b.kind === 'earning' ? b.sso : false, b.balance ?? null, b.active, b.note ?? null]);
        return loadProfile(c, id);
      });
    });

    app.patch('/items/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ItemPatch, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from pay_items where id = $1', [id], 'Pay item');
        return (await c.query(
          `update pay_items set name = coalesce($2, name), amount = coalesce($3, amount), taxable = coalesce($4, taxable), sso = coalesce($5, sso),
             balance = case when $6 then $7::numeric else balance end, active = coalesce($8, active), note = coalesce($9, note), updated_at = now()
           where id = $1 returning *`,
          [id, b.name ?? null, b.amount ?? null, b.taxable ?? null, b.sso ?? null, b.balance !== undefined, b.balance ?? null, b.active ?? null, b.note ?? null])).rows[0];
      });
    });

    app.delete('/items/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.profile.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'delete from pay_items where id = $1 returning id', [id], 'Pay item');
        return { ok: true };
      });
    });

    /* ----- payroll runs ----- */

    app.get('/runs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const q = parse(ListQuery.extend({ status: z.string().optional(), year: z.coerce.number().int().optional() }), req.query);
      const year = q.year && q.year > 2400 ? q.year - 543 : q.year;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from pay_runs where ($1::text is null or no ilike $1 or period ilike $1 or note ilike $1) and ($2::text is null or status = $2)
           and ($3::int is null or period like $3::text || '-%')
         order by period desc, created_at desc limit $4 offset $5`,
        [like(q.q), q.status ?? null, year ?? null, q.limit, q.offset])).rows.map(decorateRun));
    });

    app.post('/runs', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.write');
      const b = parse(RunInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const live = (await c.query(`select no from pay_runs where period = $1 and status <> 'cancelled'`, [b.period])).rows[0];
        if (live) throw conflict(`เดือน ${periodLabel(b.period)} มีรอบเงินเดือน ${live.no} อยู่แล้ว`);
        const base = `PR-${toBuddhistYear(`${b.period}-15`)}-${b.period.slice(5, 7)}`;
        const used = (await c.query('select count(*)::int as n from pay_runs where no = $1 or no like $2', [base, `${base}-%`])).rows[0].n;
        const no = used ? `${base}-${used + 1}` : base;
        const run = (await c.query(
          `insert into pay_runs (no, period, pay_date, note, created_by, created_by_name) values ($1,$2,$3,$4,$5,$6) returning *`,
          [no, b.period, b.payDate, b.note ?? null, a.userId, a.userName ?? null])).rows[0];
        await syncLines(c, run);
        await c.query(`update pay_runs set headcount = (select count(*) from pay_lines where run_id = $1) where id = $1`, [run.id]);
        return runDetail(c, run.id);
      });
    });

    app.get('/runs/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => runDetail(c, id));
    });

    app.post('/runs/:id/calculate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        await calculateRun(c, id);
        return runDetail(c, id);
      });
    });

    app.post('/runs/:id/approve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.approve');
      const { id } = parse(IdParam, req.params);
      parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const run = await loadRun(c, id, true);
        if (run.status !== 'calculated') throw conflict(`อนุมัติได้เฉพาะรอบที่คำนวณแล้ว (สถานะตอนนี้: ${run.status_label})`);
        const bad = (await c.query('select employee_code from pay_lines where run_id = $1 and (net < 0 or not calculated) order by employee_code', [id])).rows;
        if (bad.length) throw conflict(`พนักงาน ${bad.map((x) => x.employee_code).join(', ')} ยังคำนวณไม่ได้หรือเงินได้สุทธิติดลบ — แก้แล้วคำนวณใหม่ก่อนอนุมัติ`);
        if (!run.headcount) throw conflict('รอบนี้ไม่มีพนักงาน');
        await c.query(`update pay_runs set status = 'approved', approved_by = $2, approved_by_name = $3, approved_at = now(), updated_at = now() where id = $1`, [id, a.userId, a.userName ?? null]);
        return runDetail(c, id);
      });
    });

    /** Approved → back to calculated for corrections (before money moves). */
    app.post('/runs/:id/reopen', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.approve');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const run = await loadRun(c, id, true);
        if (run.status !== 'approved') throw conflict(`เปิดแก้ไขได้เฉพาะรอบที่อนุมัติแล้วแต่ยังไม่จ่าย (สถานะตอนนี้: ${run.status_label})`);
        const later = (await c.query(`select no from pay_runs where period > $1 and status in ('approved', 'paid') limit 1`, [run.period])).rows[0];
        if (later) throw conflict(`มีรอบเดือนถัดไป ${later.no} อนุมัติแล้ว ซึ่งใช้ยอดสะสมของรอบนี้ — เปิดแก้ไขไม่ได้`);
        await c.query(`update pay_runs set status = 'calculated', approved_by = null, approved_by_name = null, approved_at = null, updated_at = now() where id = $1`, [id]);
        return runDetail(c, id);
      });
    });

    app.post('/runs/:id/pay', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.pay');
      const { id } = parse(IdParam, req.params);
      const b = parse(PayInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const run = await loadRun(c, id, true);
        if (run.status !== 'approved') throw conflict(`บันทึกจ่ายได้เฉพาะรอบที่อนุมัติแล้ว (สถานะตอนนี้: ${run.status_label})`);
        const paidDate = b.paidDate ?? bangkokToday();
        // loans: reduce the balance by what was deducted; a loan paid off stops
        const taken = (await c.query('select recurring_taken from pay_lines where run_id = $1', [id])).rows.flatMap((l) => l.recurring_taken ?? []);
        for (const t of taken as { itemId: string; amount: number }[]) {
          await c.query(
            `update pay_items set balance = greatest(balance - $2, 0), active = case when balance - $2 <= 0 then false else active end, updated_at = now()
             where id = $1 and balance is not null`, [t.itemId, t.amount]);
        }
        await c.query(`update pay_runs set status = 'paid', paid_by = $2, paid_by_name = $3, paid_at = $4::date, pay_reference = $5, updated_at = now() where id = $1`,
          [id, a.userId, a.userName ?? null, paidDate, b.reference ?? null]);
        const t = runTotals(run);
        await k.emit(c, 'payroll.run_paid', {
          runId: run.id, no: run.no, period: run.period, payDate: run.pay_date, paidDate, headcount: run.headcount,
          totals: {
            gross: t.gross, salary: t.salary, overtime: t.overtime, allowances: t.allowances, bonus: t.bonus, otherIncome: t.otherIncome, unpaidLeave: t.unpaidLeave,
            ssoEmployee: t.ssoEmployee, ssoEmployer: t.ssoEmployer, pvdEmployee: t.pvdEmployee, pvdEmployer: t.pvdEmployer, wht: t.wht,
            otherDeductions: round(t.loans + t.otherDeduction), totalDeductions: t.totalDeductions, net: t.net,
          },
          postings: postings(t),
        });
        return runDetail(c, id);
      });
    });

    app.post('/runs/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const run = await loadRun(c, id, true);
        if (!['draft', 'calculated'].includes(run.status)) throw conflict(`ยกเลิกรอบที่${run.status_label}ไม่ได้ — ต้องเปิดแก้ไขก่อน หรือจ่ายแล้วยกเลิกไม่ได้`);
        await c.query(`update pay_runs set status = 'cancelled', cancelled_at = now(), note = coalesce($2, note), updated_at = now() where id = $1`, [id, b.note ?? null]);
        return runDetail(c, id);
      });
    });

    /* ----- payslips (one line of a run) ----- */

    app.get('/payslips', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const q = parse(ListQuery.extend({ runId: s.uuid.optional(), period: z.string().optional(), profileId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select l.*, r.no as run_no, r.period, r.status as run_status from pay_lines l join pay_runs r on r.id = l.run_id
         where r.status <> 'cancelled' and ($1::text is null or l.employee_code ilike $1 or l.employee_name ilike $1 or l.department ilike $1 or r.no ilike $1)
           and ($2::uuid is null or l.run_id = $2) and ($3::text is null or r.period = $3) and ($4::uuid is null or l.profile_id = $4)
         order by r.period desc, l.employee_code limit $5 offset $6`,
        [like(q.q), q.runId ?? null, q.period?.trim() || null, q.profileId ?? null, q.limit, q.offset])).rows.map(decorateLine));
    });

    app.get('/payslips/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => payslip(c, 'l.id = $1', [id]));
    });

    /** Inputs of the month for one employee (OT hours, days, unpaid leave, bonus…); a calculated run is recalculated. */
    app.put('/payslips/:id/inputs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(LineInputs, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const line = await one(c, 'select run_id from pay_lines where id = $1', [id], 'Payslip');
        const run = await loadRun(c, line.run_id, true);
        if (!['draft', 'calculated'].includes(run.status)) throw conflict(`แก้ไขข้อมูลของรอบที่${run.status_label}ไม่ได้`);
        const { cols, values } = toColumns(b, INPUT_COLS);
        if (cols.length) await c.query(`update pay_lines set ${cols.map((col, i) => `${col} = $${i + 2}`).join(', ')}, calculated = false, updated_at = now() where id = $1`, [id, ...values]);
        if (run.status === 'calculated') await calculateRun(c, run.id);
        return payslip(c, 'l.id = $1', [id]);
      });
    });

    /**
     * Monthly inputs from a spreadsheet (e.g. HR's monthly attendance summary): one row per employee and month,
     * matched to the open (draft / calculated) run of that month. All rows or none; calculated runs are recalculated.
     */
    app.post('/inputs/import', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.write');
      const body = parse(ImportBody, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const errors: { row: number; field?: string; message: string }[] = [];
        const runs = new Map((await c.query(`select * from pay_runs where status <> 'cancelled'`)).rows.map((r) => [r.period, r]));
        const valid: { row: number; lineId: string; runId: string; data: Record<string, unknown> }[] = [];
        const seen = new Map<string, number>();
        for (const [i, raw] of body.rows.entries()) {
          const row = i + 1;
          const per = str(raw.period);
          const code = str(raw.employeeCode);
          if (!per || !/^\d{4}-(0[1-9]|1[0-2])$/.test(per)) { errors.push({ row, field: 'period', message: 'เดือนต้องเป็น YYYY-MM เช่น 2026-10' }); continue; }
          if (!code) { errors.push({ row, field: 'employeeCode', message: 'กรอกรหัสพนักงาน' }); continue; }
          const run = runs.get(per);
          if (!run) { errors.push({ row, field: 'period', message: `ยังไม่มีรอบเงินเดือนเดือน ${periodLabel(per)}` }); continue; }
          if (!['draft', 'calculated'].includes(run.status)) { errors.push({ row, field: 'period', message: `รอบ ${run.no} ${STATUS_TH[run.status]} แก้ไขไม่ได้` }); continue; }
          const key = `${per}|${code.toLowerCase()}`;
          if (seen.has(key)) { errors.push({ row, field: 'employeeCode', message: `ซ้ำกับแถวที่ ${seen.get(key)}` }); continue; }
          seen.set(key, row);
          const line = (await c.query('select id from pay_lines where run_id = $1 and lower(employee_code) = lower($2)', [run.id, code])).rows[0];
          if (!line) { errors.push({ row, field: 'employeeCode', message: `ไม่พบพนักงาน ${code} ในรอบ ${run.no}` }); continue; }
          const input = Object.fromEntries(Object.entries({
            workDays: num(raw.workDays), ot1Hours: num(raw.ot1Hours), ot15Hours: num(raw.ot15Hours), ot2Hours: num(raw.ot2Hours), ot3Hours: num(raw.ot3Hours),
            unpaidLeaveDays: num(raw.unpaidLeaveDays), bonus: num(raw.bonus), otherIncome: num(raw.otherIncome), otherDeduction: num(raw.otherDeduction), note: str(raw.note),
          }).filter(([, v]) => v !== undefined));
          const r = LineInputs.safeParse(input);
          if (!r.success) { errors.push(...issues(r.error, row)); continue; }
          valid.push({ row, lineId: line.id, runId: run.id, data: r.data });
        }
        const result = { dryRun: !!body.dryRun, total: body.rows.length, created: 0, updated: valid.length, errors };
        if (body.dryRun) return result;
        if (errors.length) throw badRequest(`นำเข้าไม่ได้: พบปัญหา ${errors.length} จุดในไฟล์ ยังไม่ได้บันทึกข้อมูลใด`, { errors });
        for (const v of valid) {
          const { cols, values } = toColumns(v.data, INPUT_COLS);
          if (cols.length) await c.query(`update pay_lines set ${cols.map((col, i) => `${col} = $${i + 2}`).join(', ')}, calculated = false, updated_at = now() where id = $1`, [v.lineId, ...values]);
        }
        for (const runId of new Set(valid.map((v) => v.runId))) {
          if ((await c.query(`select 1 from pay_runs where id = $1 and status = 'calculated'`, [runId])).rowCount) await calculateRun(c, runId);
        }
        return result;
      });
    });

    /* ----- self-service: my own payslips (paid runs only) ----- */

    app.get('/my-payslips', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.payslip.self');
      const q = parse(ListQuery.extend({ year: z.coerce.number().int().optional() }), req.query);
      const year = q.year && q.year > 2400 ? q.year - 543 : q.year;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select l.id, l.employee_code, l.employee_name, l.gross, l.total_deductions, l.net, r.no as run_no, r.period, r.pay_date, r.status as run_status
         from pay_lines l join pay_runs r on r.id = l.run_id join pay_profiles p on p.id = l.profile_id
         where p.user_id = $1 and r.status = 'paid' and ($2::int is null or r.period like $2::text || '-%')
           and ($3::text is null or r.period ilike $3 or r.no ilike $3)
         order by r.period desc limit $4 offset $5`,
        [a.userId, year ?? null, like(q.q), q.limit, q.offset])).rows.map(decorateLine));
    });

    app.get('/my-payslips/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.payslip.self');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => payslip(c, `l.id = $1 and r.status = 'paid' and l.profile_id in (select id from pay_profiles where user_id = $2)`, [id, a.userId]));
    });

    /* ----- reports of a run ----- */

    /** Bank transfer list (net pay per employee). Only the last 4 digits of accounts are known here. */
    app.get('/runs/:id/bank-transfer', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const run = await loadRun(c, id);
        const rows = (await c.query(
          `select id, employee_code, employee_name, bank_name, bank_account_last4, net from pay_lines where run_id = $1 and net > 0 order by bank_name nulls last, employee_code`, [id])).rows;
        const banks = (await c.query(
          `select coalesce(bank_name, 'ไม่ระบุธนาคาร') as bank_name, count(*)::int as people, sum(net) as total from pay_lines where run_id = $1 and net > 0 group by 1 order by 1`, [id])).rows;
        return { run_no: run.no, period: run.period, period_label: run.period_label, pay_date: run.pay_date, total: run.net, rows, banks, missingBank: rows.filter((r) => !r.bank_name).length };
      });
    });

    /** สปส.1-10 (ส่วนที่ 2) data: wage (capped) and employee contribution per insured person, plus totals for ส่วนที่ 1. */
    app.get('/runs/:id/sso', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const run = await loadRun(c, id);
        const { rules, row: settings } = await loadRules(c);
        const rows = (await c.query(
          `select id, employee_code, employee_name, sso_wage, sso_employee, sso_employer from pay_lines where run_id = $1 and sso_enrolled and sso_employee > 0 order by employee_code`, [id])).rows
          .map((r, i) => ({ ...r, seq: i + 1, id_card: '', wage: Math.min(Number(r.sso_wage), rules.sso.wageMax) }));
        const sum = (k2: string) => round(rows.reduce((s2, r: any) => s2 + Number(r[k2]), 0));
        return {
          run_no: run.no, period: run.period, period_label: run.period_label, employer_account: settings?.sso_employer_account ?? null, branch: settings?.sso_branch ?? null,
          rate: rules.sso.employeeRate, employer_rate: rules.sso.employerRate, wage_max: rules.sso.wageMax,
          insured: rows.length, total_wages: sum('wage'), employee_total: sum('sso_employee'), employer_total: sum('sso_employer'),
          total: round(sum('sso_employee') + sum('sso_employer')), rows,
        };
      });
    });

    /** ภ.ง.ด.1 for the month: 40(1) income paid and tax withheld per employee. `?withheldOnly=1` lists only people with tax withheld. */
    app.get('/runs/:id/pnd1', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const { id } = parse(IdParam, req.params);
      const q = parse(z.object({ withheldOnly: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const run = await loadRun(c, id);
        const rows = (await c.query(
          `select id, employee_code, employee_name, taxable_regular + taxable_irregular as income, wht from pay_lines
           where run_id = $1 and taxable_regular + taxable_irregular > 0 and ($2::boolean is not true or wht > 0) order by employee_code`, [id, q.withheldOnly ?? null])).rows
          .map((r, i) => ({ ...r, seq: i + 1, tax_id: '', condition: '1', condition_label: 'หัก ณ ที่จ่าย' }));
        const income = round(rows.reduce((s2, r) => s2 + Number(r.income), 0));
        const tax = round(rows.reduce((s2, r) => s2 + Number(r.wht), 0));
        return { run_no: run.no, period: run.period, period_label: run.period_label, pay_date: run.pay_date, people: rows.length, total_income: income, total_tax: tax, total_tax_text: bahtText(tax), rows };
      });
    });

    /* ----- 50 ทวิ (annual withholding certificate) ----- */

    const certificateRows = async (c: Client, year: number, q: string | null, profileId: string | null) => (await c.query(
      `select p.id as profile_id, p.employee_code, p.employee_name, p.department, p.user_id,
              coalesce(sum(l.taxable_regular + l.taxable_irregular), 0) + case when p.opening_year = $1::int then p.opening_income else 0 end as income,
              coalesce(sum(l.wht), 0) + case when p.opening_year = $1::int then p.opening_tax else 0 end as tax,
              coalesce(sum(l.sso_employee), 0) + case when p.opening_year = $1::int then p.opening_sso else 0 end as sso,
              coalesce(sum(l.pvd_employee), 0) + case when p.opening_year = $1::int then p.opening_pvd else 0 end as pvd,
              count(l.id)::int as months
       from pay_profiles p
       left join (pay_lines l join pay_runs r on r.id = l.run_id and r.status = 'paid' and r.period like $4::text) on l.profile_id = p.id
       where ($2::text is null or p.employee_code ilike $2 or p.employee_name ilike $2) and ($3::uuid is null or p.id = $3)
       group by p.id
       having count(l.id) > 0 or p.opening_year = $1::int
       order by p.employee_code`, [year, q, profileId, `${year}-%`])).rows.map((r) => ({ ...r, id: `${r.profile_id}_${year}`, year, year_be: year + 543 }));

    app.get('/certificates', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const q = parse(ListQuery.extend({ year: z.coerce.number().int().optional() }), req.query);
      const year = q.year ? (q.year > 2400 ? q.year - 543 : q.year) : Number(bangkokToday().slice(0, 4));
      return k.db.tx(a.tenantId, (c) => certificateRows(c, year, like(q.q), null));
    });

    /** `:id` = `<profileId>_<year>` (ค.ศ.); the employee may open their own certificate with payroll.payslip.self. */
    app.get('/certificates/:id', async (req) => {
      const a = auth(req);
      const { id } = parse(z.object({ id: z.string().regex(/^[0-9a-f-]{36}_\d{4}$/i, 'expected <profileId>_<year>') }), req.params);
      const [profileId, y] = id.split('_');
      const year = Number(y) > 2400 ? Number(y) - 543 : Number(y);
      const staff = hasPerm(a, 'payroll.run.read');
      if (!staff) requirePerm(a, 'payroll.payslip.self');
      return k.db.tx(a.tenantId, async (c) => {
        const row = (await certificateRows(c, year, null, profileId))[0];
        if (!row || (!staff && row.user_id !== a.userId)) throw notFound('Certificate');
        const months = (await c.query(
          `select r.period, l.taxable_regular + l.taxable_irregular as income, l.wht, l.sso_employee, l.pvd_employee
           from pay_lines l join pay_runs r on r.id = l.run_id where l.profile_id = $1 and r.status = 'paid' and r.period like $2 order by r.period`,
          [profileId, `${year}-%`])).rows.map((m) => ({ ...m, period_label: periodLabel(m.period) }));
        return {
          ...row, heading: `${row.employee_code} ปีภาษี ${year + 543}`, months,
          income_type: 'เงินเดือน ค่าจ้าง เบี้ยเลี้ยง โบนัส ฯลฯ ตามมาตรา 40(1)', form: 'ภ.ง.ด.1ก', payer_condition: '(1) หัก ณ ที่จ่าย',
          payee_tax_id: '…………………………………… (กรอกเลขประจำตัวผู้เสียภาษีของผู้มีเงินได้)', tax_text: bahtText(Number(row.tax)),
        };
      });
    });

    /* ----- dashboard ----- */

    /** Unpaid leave HR approved (hr.leave_decided) per pay month, and whether it reached the run. */
    app.get('/leave-inputs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      const q = parse(ListQuery.extend({ period: z.string().optional(), status: z.enum(['pending', 'applied', 'late']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select i.*, r.no as run_no,
           case i.status when 'pending' then 'รอสร้างรอบเงินเดือน' when 'applied' then 'ใส่ในรอบเงินเดือนแล้ว' else 'รอบอนุมัติแล้ว — กรอกเอง' end as status_label
         from leave_inputs i left join pay_runs r on r.id = i.run_id
         where ($1::text is null or i.period = $1) and ($2::text is null or i.status = $2)
           and ($3::text is null or i.employee_code ilike $3 or i.employee_name ilike $3 or i.leave_no ilike $3)
         order by i.period desc, i.employee_code limit $4 offset $5`,
        [q.period?.trim() || null, q.status ?? null, like(q.q), q.limit, q.offset])).rows);
    });

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'payroll.run.read');
      return k.db.tx(a.tenantId, async (c) => {
        const p = (await c.query(
          `select count(*) filter (where active)::int as active, count(*) filter (where active and pay_type = 'daily')::int as daily,
                  count(*) filter (where active and user_id is null)::int as unlinked, count(*) filter (where active and bank_name is null)::int as no_bank
           from pay_profiles`)).rows[0];
        const r = (await c.query(
          `select count(*) filter (where status = 'calculated')::int as to_approve, count(*) filter (where status = 'approved')::int as to_pay,
                  count(*) filter (where status = 'draft')::int as drafts from pay_runs`)).rows[0];
        const last = (await c.query(`select * from pay_runs where status <> 'cancelled' order by period desc limit 1`)).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(r.net), 0) as net, coalesce(sum(r.gross), 0) as gross,
                  coalesce(sum(r.gross + r.sso_employer + r.pvd_employer), 0) as cost, coalesce(max(r.headcount), 0)::int as headcount
           from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m
           left join pay_runs r on r.period = to_char(m, 'YYYY-MM') and r.status in ('approved', 'paid')
           group by m order by m`)).rows;
        const rows = (await c.query(
          `select id, no, period, status, net, headcount from pay_runs where status <> 'cancelled' order by period desc limit 12`)).rows.map(decorateRun);
        return {
          activeProfiles: p.active, dailyProfiles: p.daily, unlinkedProfiles: p.unlinked, profilesWithoutBank: p.no_bank,
          toApprove: r.to_approve, toPay: r.to_pay, drafts: r.drafts,
          lastRunNo: last?.no ?? null, lastPeriod: last ? periodLabel(last.period) : null, lastNet: last ? Number(last.net) : 0,
          lastCost: last ? round(Number(last.gross) + Number(last.sso_employer) + Number(last.pvd_employer)) : 0,
          lastWht: last ? Number(last.wht) : 0, lastSso: last ? round(Number(last.sso_employee) + Number(last.sso_employer)) : 0,
          months, rows,
        };
      });
    });

  },
  handlers: {
    'hr.employee_upserted': async (e, { client }) => syncEmployee(client, e),
    'hr.leave_decided': async (e, { client }) => recordUnpaidLeave(client, e),
  },
};

