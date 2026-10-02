/**
 * Demo data for the wave-5 modules — accounting, payroll, contracts — and real file attachments, all through the HTTP APIs.
 *
 * - `setupAccounting` runs early in seedDemo (before any purchase / sale), so the standard chart, the posting rules and the expense
 *   category mappings exist when the business events arrive and every journal posts to the right account.
 * - `seedPayroll` / `seedContracts` run in parallel with the other office modules (seedBusiness).
 * - `seedAttachments` and `closeBooks` run last: the files need records of several modules, and the books are checked and last month
 *   is closed only once every event of the seed has been posted.
 *
 * Dates are relative to "today" in Asia/Bangkok, so the demo always looks current.
 */
import { deflateSync } from 'node:zlib';

type Call = <T = any>(method: string, path: string, body?: unknown) => Promise<T>;
type User = { id: string; name: string; email: string };
export interface FinanceCtx {
  call: Call;
  as: Record<string, Call>;
  users: Record<string, User>;
  partners: Record<string, any>;
  has: (module: string) => boolean;
}

/* ------------------------------------------------------------------ dates (Asia/Bangkok) ------------------------------------------------------------------ */

const today = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
/** first day of the month `n` months from this one (0 = this month, -1 = last month) */
const monthStart = (n: number) => {
  const d = new Date(`${today().slice(0, 7)}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 10);
};
const monthEnd = (n: number) => addDays(monthStart(n + 1), -1);
/** last Mon–Fri on or before `date` */
const weekdayOnOrBefore = (date: string) => {
  let d = date;
  while ([0, 6].includes(new Date(`${d}T00:00:00Z`).getUTCDay())) d = addDays(d, -1);
  return d;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** poll `fn` until it returns a truthy value (events arrive asynchronously through the gateway's router) */
async function waitFor<T>(what: string, fn: () => Promise<T | undefined | null | false>, tries = 40, ms = 300): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = await fn();
    if (v) return v;
    await sleep(ms);
  }
  throw new Error(`timed out waiting for ${what}`);
}

/* ------------------------------------------------------------------ accounting: set-up ------------------------------------------------------------------ */

/** expense categories of the demo that the standard map does not know (else they would all land in 53900 เบ็ดเตล็ด) */
const EXTRA_CATEGORY_MAP: [string, string, string, string][] = [
  ['PERDIEM', 'เบี้ยเลี้ยงเดินทาง', '52510', 'เบี้ยเลี้ยงเดินทางไปพบลูกค้า/ผู้ขาย รวมกับค่าเดินทาง'],
  ['PARTS', 'อะไหล่/วัสดุซ่อมด่วน', '52700', 'อะไหล่ที่ซื้อหน้าร้าน = ค่าซ่อมแซมและบำรุงรักษา'],
  ['OFFICE', 'วัสดุสำนักงาน', '53200', ''],
  ['PARCEL', 'ค่าไปรษณีย์/ขนส่งเอกสาร', '52800', ''],
  ['OTMEAL', 'ค่าอาหารทำงานล่วงเวลา', '52150', 'สวัสดิการพนักงาน'],
];

/** Standard chart + posting rules + category mappings before the first business event. */
export async function setupAccounting(call: Call): Promise<void> {
  await call('POST', '/api/accounting/accounts/setup');
  const accounts = await call<any[]>('GET', '/api/accounting/accounts?postable=true');
  const byCode = new Map(accounts.map((a) => [a.code, a.id]));
  const have = new Set((await call<any[]>('GET', '/api/accounting/category-mappings')).map((m) => String(m.category_code).toUpperCase()));
  await Promise.all(EXTRA_CATEGORY_MAP.filter(([code]) => !have.has(code)).map(([categoryCode, categoryName, account, note]) =>
    call('POST', '/api/accounting/category-mappings', { categoryCode, categoryName, accountId: byCode.get(account), note: note || undefined })));
}

/* ------------------------------------------------------------------ payroll ------------------------------------------------------------------ */

type Pay = { salary: number; pvd?: number; spouse?: boolean; children?: number; parents?: number; life?: number; items?: [string, string, number, boolean?][] };
const DILIGENCE: [string, string, number, boolean?] = ['DILIGENCE', 'เบี้ยขยัน', 500];
/** monthly salaries (THB): operators 12,000–16,000 · office 18,000–35,000 · heads / MD 45,000–80,000 */
const PAY: Record<string, Pay> = {
  'EMP-001': { salary: 80000, pvd: 5, spouse: true, children: 2, parents: 2, life: 60000, items: [['CAR', 'ค่ารถประจำตำแหน่ง', 8000]] },
  'EMP-002': { salary: 26000, pvd: 3 },
  'EMP-003': { salary: 45000, pvd: 3, children: 1 },
  'EMP-004': { salary: 48000, pvd: 5, spouse: true },
  'EMP-005': { salary: 52000, pvd: 3, items: [['PHONE', 'ค่าโทรศัพท์', 1500], ['FUEL', 'ค่าน้ำมันรถ (เหมาจ่าย)', 3000]] },
  'EMP-006': { salary: 50000, pvd: 3, children: 2 },
  'EMP-007': { salary: 47000, pvd: 5, parents: 2 },
  'EMP-008': { salary: 55000, pvd: 5, life: 30000 },
  'EMP-009': { salary: 32000, items: [['PHONE', 'ค่าโทรศัพท์', 800]] },
  'EMP-010': { salary: 46000, pvd: 3 },
  'EMP-011': { salary: 24000, items: [['POSITION', 'ค่าตำแหน่งโฟร์แมน', 2000, true], DILIGENCE] },
  'EMP-012': { salary: 14500, items: [DILIGENCE] },
  'EMP-013': { salary: 13800, items: [DILIGENCE] },
  'EMP-014': { salary: 14200, items: [DILIGENCE] },
  'EMP-015': { salary: 13000, items: [DILIGENCE] },
  'EMP-016': { salary: 12000 },
  'EMP-017': { salary: 15500, items: [DILIGENCE] },
  'EMP-018': { salary: 16000, items: [['SKILL', 'ค่าทักษะช่างเชื่อม', 1000, true], DILIGENCE] },
  'EMP-019': { salary: 13500, items: [DILIGENCE] },
  'EMP-020': { salary: 14000, items: [DILIGENCE] },
  'EMP-021': { salary: 16000, items: [DILIGENCE] },
  'EMP-022': { salary: 15000, items: [DILIGENCE] },
  'EMP-023': { salary: 14500 },
  'EMP-024': { salary: 21000 },
  'EMP-025': { salary: 18000 },
  'EMP-026': { salary: 12500 },
  'EMP-027': { salary: 20000 },
};
const BANKS = ['กสิกรไทย', 'ไทยพาณิชย์', 'กรุงเทพ', 'กรุงไทย'];
/** OT hours (× 1.5) keyed in for last month — the press line ran overtime for the คูลแอร์ order */
const LAST_MONTH_OT: Record<string, number> = { 'EMP-011': 18, 'EMP-012': 24, 'EMP-013': 20, 'EMP-014': 16, 'EMP-015': 22, 'EMP-017': 12, 'EMP-018': 26, 'EMP-021': 8 };

/** Thai personal income tax on a year's net income (the default brackets of payroll's calc.ts) */
const incomeTax = (net: number) => {
  let tax = 0, lower = 0;
  for (const [upTo, rate] of [[150_000, 0], [300_000, 5], [500_000, 10], [750_000, 15], [1_000_000, 20], [2_000_000, 25], [5_000_000, 30], [Infinity, 35]]) {
    if (net > lower) tax += (Math.min(net, upTo) - lower) * rate / 100;
    lower = upTo;
  }
  return tax;
};

/**
 * The company went live on payroll last month: the months of this year before that were paid by the old system, so each profile
 * carries opening YTD balances (income, ภ.ง.ด.1 tax, SSO, PVD) and this year's withholding is annualised correctly.
 */
function openingBalances(pay: Pay, startDate: string | null) {
  const year = Number(today().slice(0, 4));
  const before = Number(monthStart(-1).slice(5, 7)) - 1; // Jan … the month before last month
  const months = Array.from({ length: Math.max(before, 0) }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}-01`).filter((m) => !startDate || startDate <= m).length;
  if (!months) return {};
  const items = (pay.items ?? []).reduce((sum, [, , amount]) => sum + amount, 0);
  const ssoWage = pay.salary + (pay.items ?? []).filter(([, , , sso]) => sso).reduce((sum, [, , amount]) => sum + amount, 0);
  // C1: statutory SSO ceiling of that year (17,500 from 2026/2569, 20,000 from 2029, 23,000 from 2032) — same schedule as payroll's sso_rules
  const ceiling = year >= 2032 ? 23_000 : year >= 2029 ? 20_000 : year >= 2026 ? 17_500 : 15_000;
  const sso = Math.round(Math.min(Math.max(ssoWage, 1650), ceiling) * 0.05);
  const pvd = Math.round(pay.salary * (pay.pvd ?? 0)) / 100;
  const income = (pay.salary + items) * 12;
  const net = income - Math.min(income * 0.5, 100_000) - 60_000 - (pay.spouse ? 60_000 : 0) - (pay.children ?? 0) * 30_000 - (pay.parents ?? 0) * 30_000
    - sso * 12 - Math.min(pvd * 12, income * 0.15, 500_000) - Math.min(pay.life ?? 0, 100_000);
  return {
    openingYear: year, openingIncome: (pay.salary + items) * months, openingSso: sso * months, openingPvd: pvd * months,
    openingTax: Math.round(incomeTax(Math.max(net, 0)) / 12 * months),
  };
}

export async function seedPayroll(x: FinanceCtx): Promise<string> {
  const { as } = x;
  const hr = as.hr;
  // pay profiles come from hr.employee_upserted (salary 0); wait until all of them — and the resignation — have arrived
  const profiles = await waitFor('pay profiles from HR', async () => {
    const rows = await hr<any[]>('GET', '/api/payroll/profiles?limit=500');
    const codes = new Set(rows.map((p) => p.employee_code));
    const resigned = rows.find((p) => p.employee_code === 'EMP-026');
    return Object.keys(PAY).every((c) => codes.has(c)) && resigned?.end_date ? rows : undefined;
  }, 60, 250);
  await Promise.all(profiles.filter((p) => PAY[p.employee_code]).map(async (p, i) => {
    const pay = PAY[p.employee_code];
    await hr('PATCH', `/api/payroll/profiles/${p.id}`, {
      baseSalary: pay.salary, ssoEnrolled: true, pvdEmployeePct: pay.pvd ?? 0, pvdEmployerPct: pay.pvd ?? 0,
      taxSpouse: !!pay.spouse, taxChildren: pay.children ?? 0, taxParents: pay.parents ?? 0, taxLifeInsurance: pay.life ?? 0,
      bankName: BANKS[i % BANKS.length], bankAccount: String(1000 + ((i * 7919) % 9000)),
      note: pay.pvd ? `สมาชิกกองทุนสำรองเลี้ยงชีพ ${pay.pvd}% · ยอดสะสมต้นปีจากระบบเงินเดือนเดิม` : 'ยอดสะสมต้นปีจากระบบเงินเดือนเดิม',
      ...openingBalances(pay, p.start_date),
    });
    for (const [code, name, amount, sso] of pay.items ?? []) {
      await hr('POST', `/api/payroll/profiles/${p.id}/items`, { kind: 'earning', code, name, amount, taxable: true, sso: !!sso });
    }
  }));

  // last month: calculated → OT keyed in → approved by the MD → paid by accounting (posts the salary journal)
  const lastPay = weekdayOnOrBefore(monthEnd(-1));
  const last = await hr('POST', '/api/payroll/runs', { period: monthStart(-1).slice(0, 7), payDate: lastPay, note: 'เงินเดือนประจำเดือน + OT ไลน์ปั๊ม' });
  const calc = await hr('POST', `/api/payroll/runs/${last.id}/calculate`);
  for (const line of calc.lines as any[]) {
    const ot = LAST_MONTH_OT[line.employee_code];
    if (ot) await hr('PUT', `/api/payroll/payslips/${line.id}/inputs`, { ot15Hours: ot, note: 'OT เร่งงานออเดอร์คูลแอร์' });
  }
  await as.admin('POST', `/api/payroll/runs/${last.id}/approve`);
  const paid = await as.acc('POST', `/api/payroll/runs/${last.id}/pay`, { paidDate: lastPay, reference: 'KBANK Payroll ' + lastPay.replace(/-/g, '') });

  // this month: calculated, waiting for the MD's approval
  const cur = await hr('POST', '/api/payroll/runs', { period: monthStart(0).slice(0, 7), payDate: weekdayOnOrBefore(monthEnd(0)) });
  const curCalc = await hr('POST', `/api/payroll/runs/${cur.id}/calculate`);
  return `payroll ${paid.no} paid ${paid.headcount} คน gross ${Number(paid.gross).toLocaleString()} WHT ${Number(paid.wht).toLocaleString()} net ${Number(paid.net).toLocaleString()}`
    + ` · ${curCalc.no} ${curCalc.status} net ${Number(curCalc.net).toLocaleString()}`;
}

/* ------------------------------------------------------------------ contracts ------------------------------------------------------------------ */

const PRESS_CHECKLIST = [
  'ตรวจระดับและสภาพน้ำมันไฮดรอลิก', 'ตรวจรอยรั่วซึมกระบอกสูบและข้อต่อ', 'ตรวจระยะฟรีคลัตช์และเบรก', 'อัดจาระบีจุดหล่อลื่นตามผัง',
  'ทดสอบเซ็นเซอร์ม่านแสงนิรภัย (Light curtain)', 'ตรวจแรงบิดน็อตยึดแม่พิมพ์',
];

export async function seedContracts(x: FinanceCtx): Promise<string> {
  const { call, as, users: u, partners } = x;
  const tech = { technicianId: u.tech.id, technicianName: u.tech.name };
  const cust = (code: string) => ({ customerId: partners[code].id, customerCode: code, customerName: partners[code].name });
  const create = (body: any) => call('POST', '/api/contracts/contracts', body);

  // 1) คูลแอร์: monthly PM + billing on the presses we run for their bracket line, started last month
  const cool = await create({
    ...cust('C-001'), ...tech, contactName: 'คุณสมพงษ์ (QC คูลแอร์)', contactPhone: '081-552-7781',
    title: 'บำรุงรักษาเครื่องปั๊มและแม่พิมพ์ ไลน์ขายึดคอมเพรสเซอร์', startDate: monthStart(-1), endDate: addDays(monthStart(11), -1),
    value: 216000, billingPlan: 'monthly', coverage: '24x7', slaResponseHours: 4, slaResolveHours: 24, pmEveryMonths: 1, firstPmDate: addDays(monthStart(-1), 9),
    checklist: PRESS_CHECKLIST, note: 'รวมค่าแรงและอะไหล่สิ้นเปลือง ไม่รวมอะไหล่หลัก (ปั๊มไฮดรอลิก มอเตอร์)',
    items: [
      { asset: 'เครื่องปั๊ม 80 ตัน AIDA', serialNo: 'AID2021-558120', location: 'คูลแอร์ อมตะนคร อาคาร B ไลน์ 2' },
      { asset: 'เครื่องปั๊ม 110 ตัน AIDA', serialNo: 'AID2022-661934', location: 'คูลแอร์ อมตะนคร อาคาร B ไลน์ 2' },
      { asset: 'เครื่องปั๊ม 200 ตัน Komatsu', serialNo: 'KOM2023-702215', location: 'คูลแอร์ อมตะนคร อาคาร B ไลน์ 3' },
      { asset: 'แม่พิมพ์ขายึด BRK-100 (Progressive die)', serialNo: 'DIE-BRK100-02', location: 'ห้องเก็บแม่พิมพ์' },
    ],
  });
  // 2) อีสเทิร์น อิเล็คทริค: quarterly, starts this month
  const eastern = await create({
    ...cust('C-002'), ...tech, contactName: 'คุณภาณุมาศ (QA)', contactPhone: '038-110-552',
    title: 'MA ตู้ควบคุมและระบบไฟฟ้าไลน์ประกอบ CASE-01', startDate: monthStart(0), endDate: addDays(monthStart(12), -1),
    value: 96000, billingPlan: 'quarterly', coverage: '8x5', slaResponseHours: 8, slaResolveHours: 48, pmEveryMonths: 3, firstPmDate: addDays(monthStart(0), 14),
    checklist: ['ตรวจขันขั้วสายไฟและเบรกเกอร์', 'วัดค่ากระแสและแรงดันแต่ละเฟส', 'ทำความสะอาดพัดลมระบายอากาศตู้', 'ถ่ายภาพความร้อน (Thermoscan) จุดต่อสาย'],
    items: [
      { asset: 'ตู้ควบคุมไลน์ประกอบ CASE-01 (MDB-2)', serialNo: 'MDB-2-2024', location: 'อีสเทิร์น อิเล็คทริค ปลวกแดง' },
      { asset: 'ตู้ควบคุมเครื่องพ่นสี', serialNo: 'CP-PAINT-07', location: 'อีสเทิร์น อิเล็คทริค ปลวกแดง' },
    ],
  });
  // 3) โฮมสโตร์: yearly contract keyed in mid-term, ends within 60 days (shows in "MA ใกล้หมด")
  const homeStart = addDays(today(), -320);
  // quarterly PM aligned so the last visit of the contract falls next month (9 months after the first)
  const homeFirstPm = (() => { const d = new Date(`${addDays(today(), 35)}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() - 9); return d.toISOString().slice(0, 10); })();
  const home = await create({
    ...cust('C-003'), ...tech, contactName: 'คุณเอกพล (สาขาลาดกระบัง)', contactPhone: '02-326-1144',
    title: 'ตรวจสภาพและขันแน่นชั้นวาง RACK-08 ทุกสาขา', startDate: homeStart, endDate: addDays(homeStart, 364),
    value: 48000, billingPlan: 'quarterly', coverage: '8x5', slaResponseHours: 24, slaResolveHours: 72, pmEveryMonths: 3, firstPmDate: homeFirstPm,
    checklist: ['ตรวจแนวดิ่งเสาชั้นวาง', 'ขันแน่นพุกและน็อตยึดคาน', 'ตรวจป้ายพิกัดรับน้ำหนัก'],
    items: [{ asset: 'ชั้นวาง RACK-08 จำนวน 36 ชุด', location: 'โฮมสโตร์ สาขาลาดกระบัง' }, { asset: 'ชั้นวาง RACK-08 จำนวน 24 ชุด', location: 'โฮมสโตร์ สาขาบางนา' }],
  });
  for (const c of [cool, eastern, home]) await call('POST', `/api/contracts/contracts/${c.id}/activate`);

  // installments already invoiced (keyed in mid-term / last month's) — the rest goes to Sales as draft service orders
  const billing = await call<any[]>('GET', '/api/contracts/billing?scope=all');
  let inv = 41;
  for (const i of billing.filter((b) => b.due_date < monthStart(0)).sort((a, b) => a.due_date.localeCompare(b.due_date))) {
    await call('POST', `/api/contracts/installments/${i.id}/bill`, { invoiceNo: `IV-${Number(i.due_date.slice(0, 4)) + 543}-${String(inv++).padStart(4, '0')}`, invoicedOn: i.due_date });
  }

  // PM visits through next month (→ helpdesk PM tickets); คูลแอร์'s visit of last month included and done with the customer's sign-off
  await call('POST', `/api/contracts/contracts/${cool.id}/generate-visits`, { until: monthEnd(1), includePast: true });
  await call('POST', '/api/contracts/visits/generate', { until: monthEnd(1) });
  const visits = await call<any[]>('GET', `/api/contracts/visits?contractId=${cool.id}`);
  const first = visits.filter((v) => v.status === 'planned').sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  if (first && first.due_date < today()) {
    const v = await as.tech('GET', `/api/contracts/visits/${first.id}`);
    const checks: any[] = v.checks ?? [];
    await as.tech('POST', `/api/contracts/visits/${first.id}/complete`, {
      signoffName: 'คุณสมพงษ์ รักงาน (หัวหน้า QC คูลแอร์)', doneOn: first.due_date, markRemainingPass: true,
      findings: 'ซีลกระบอกสูบ PRESS-02 เริ่มซึม — เสนอเปลี่ยนในรอบหน้า · เติมน้ำมันไฮดรอลิก ISO 68 จำนวน 8 ลิตร',
      results: checks.slice(0, 2).map((c, k) => ({ checkId: c.id, result: k === 1 ? 'fail' : 'pass', note: k === 1 ? 'คราบน้ำมันที่ข้อต่อกระบอกสูบ เครื่อง 110 ตัน' : undefined })),
    });
    // its PM ticket (opened by helpdesk from contracts.visit_due) is closed by the technician with the service report number
    if (x.has('helpdesk')) {
      const ticket = await waitFor('the PM ticket', async () => (await as.tech<any[]>('GET', `/api/helpdesk/tickets?q=${first.no}&limit=5`))[0], 30, 300).catch(() => undefined);
      if (ticket?.status === 'open') await as.tech('POST', `/api/helpdesk/tickets/${ticket.id}/start`);
      if (ticket) await as.tech('POST', `/api/helpdesk/tickets/${ticket.id}/resolve`, { resolution: `ทำ PM ตามรายงาน ${first.no} ลูกค้าเซ็นรับแล้ว — นัดเปลี่ยนซีลกระบอกสูบ 110 ตัน รอบหน้า` });
    }
  }
  const notified = await call('POST', '/api/contracts/billing/due/notify', { days: 0 });
  await call('POST', '/api/contracts/contracts/expiring/notify', { days: 60 });
  const all = await call<any[]>('GET', '/api/contracts/visits?limit=500');
  return `contracts 3 · visits ${all.length} (done ${all.filter((v) => v.status === 'done').length}) · installments sent to sales ${notified.notified}`;
}

/* ------------------------------------------------------------------ attachments ------------------------------------------------------------------ */

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (b: Buffer) => {
  let c = 0xffffffff;
  for (const x of b) c = CRC_TABLE[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

/** A minimal RGB PNG drawn by `pixel(x, y)` → [r, g, b]. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 3 + 1);
    raw[row] = 0; // filter: none
    for (let x = 0; x < width; x++) raw.set(pixel(x, y), row + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

/** a small till receipt: paper, printed lines, a bold total and a torn bottom edge */
const receiptPng = () => encodePng(120, 180, (x, y) => {
  const torn = y > 170 + ((x % 8) < 4 ? x % 4 : 4 - (x % 4));
  if (torn || x < 6 || x > 113) return [214, 219, 223];
  if (y >= 14 && y < 22 && x > 30 && x < 90) return [40, 40, 40]; // shop name
  const line = (y - 34) % 12;
  if (y >= 34 && y < 130 && line < 3) return x > 14 && x < 70 + ((y * 7) % 25) ? [90, 90, 90] : x > 86 && x < 106 ? [90, 90, 90] : [252, 252, 248];
  if (y >= 140 && y < 150 && x > 14 && x < 106) return x < 50 ? [20, 20, 20] : x > 70 ? [20, 20, 20] : [252, 252, 248];
  return [252, 252, 248];
});
/** a "photo" of the leaking cylinder: machine grey, yellow guard, an oil stain */
const machinePhotoPng = () => encodePng(160, 120, (x, y) => {
  const d = Math.hypot(x - 96, y - 78);
  if (d < 14) return [38, 30, 18];
  if (x > 40 && x < 120 && y > 20 && y < 100) return x > 74 && x < 86 ? [120, 128, 134] : [96, 104, 110];
  if (y > 104) return (x + y) % 16 < 8 ? [245, 197, 24] : [20, 28, 34];
  return [200, 206, 210];
});

/** A valid one-page PDF (Helvetica, ASCII text), xref offsets computed. */
export function minimalPdf(title: string, lines: string[]): Buffer {
  const esc = (s: string) => s.replace(/[\\()]/g, (c) => `\\${c}`).replace(/[^\x20-\x7e]/g, '?');
  const text = [`BT /F1 16 Tf 56 780 Td (${esc(title)}) Tj ET`, ...lines.map((l, i) => `BT /F1 11 Tf 56 ${748 - i * 18} Td (${esc(l)}) Tj ET`),
    '0.8 w 56 770 m 539 770 l S'].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(text, 'latin1')} >>\nstream\n${text}\nendstream`,
  ];
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((o, i) => { offsets.push(Buffer.byteLength(out, 'latin1')); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

export async function seedAttachments(x: FinanceCtx): Promise<string> {
  const { as, has } = x;
  const up = (who: Call, module: string, ref: string, fileName: string, data: Buffer) =>
    who('POST', `/api/${module}/_attachments`, { ref, fileName, dataBase64: data.toString('base64') });
  let n = 0;
  if (has('expense')) {
    const claim = (await as.sales<any[]>('GET', `/api/expense/claims?q=${encodeURIComponent('รับรองลูกค้า คูลแอร์')}`))[0];
    if (claim) { await up(as.sales, 'expense', `claim:${claim.id}`, 'ใบเสร็จ RC-23015.png', receiptPng()); n++; }
  }
  if (has('maintenance')) {
    const wo = (await as.tech<any[]>('GET', '/api/maintenance/work-orders?limit=200')).find((w) => String(w.title).startsWith('น้ำมันไฮดรอลิกรั่ว'));
    if (wo) {
      await up(as.tech, 'maintenance', `work-order:${wo.id}`, 'รูปกระบอกสูบรั่ว PRESS-02.png', machinePhotoPng());
      await up(as.tech, 'maintenance', `work-order:${wo.id}`, 'PRESS-02 hydraulic seal kit.pdf', minimalPdf('PRESS-02 Hydraulic cylinder seal kit', [
        'Machine: AIDA 110 t press (PRESS-02)', 'Seal kit: NOK piston seal 125 x 105 x 14, rod seal 70 x 85 x 12', 'Hydraulic oil: ISO VG 68, 8 L top-up',
        'Torque gland bolts to 85 N.m in a cross pattern', 'Run 10 dry strokes, check for seepage before production']));
      n += 2;
    }
  }
  if (has('quality')) {
    // the hole-pitch NCR of the failed BRK-100 final inspection (else whichever NCR exists)
    const ncr = await waitFor('an NCR', async () => {
      const rows = await as.qc<any[]>('GET', '/api/quality/ncrs?limit=50');
      return rows.find((r) => r.item_code === 'FG-BRK-100') ?? rows[0];
    }, 20, 300);
    await up(as.qc, 'quality', `ncr:${ncr.id}`, `${ncr.no} measurement report.pdf`, minimalPdf(`${ncr.no} - Measurement report`, [
      `Item: ${ncr.item_code ?? ''}`, 'Sample: 5 pcs, hole pitch spec 80.0 +/- 0.3 mm', 'Results: 80.6 / 80.5 / 80.1 / 80.6 / 80.2 mm', '3 of 5 out of tolerance -> lot on hold',
      'Inspector: Arunee T. (QC)']));
    n++;
  }
  if (has('crm')) {
    const quote = (await as.sales<any[]>('GET', '/api/crm/quotations?limit=100')).find((q) => q.customer_name === x.partners['C-001']?.name && q.status === 'sent');
    if (quote) {
      await up(as.sales, 'crm', `quotation:${quote.id}`, `${quote.no} customer drawing.pdf`, minimalPdf(`Drawing BRK-100 rev.C - ${quote.no}`, [
        'Customer: Cool Air Manufacturing Co., Ltd.', 'Part: Compressor bracket BRK-100, SPCC 1.2 mm, powder coat grey 80 um', 'Hole pitch 80.0 +/- 0.3 mm, bend 90 +/- 1 deg',
        'Volume: 3,500 pcs / month, 12-month price lock']));
      n++;
    }
  }
  return `attachments ${n}`;
}

/* ------------------------------------------------------------------ accounting: month-end ------------------------------------------------------------------ */

/**
 * After every event of the seed has posted: two manual JVs for last month (accrued electricity, depreciation), close last month,
 * and report the GL — journals, trial balance difference (must be 0) and open posting errors (must be none).
 */
export async function closeBooks(x: FinanceCtx): Promise<string> {
  const acc = x.as.acc;
  // wait until the auto-posted journals stop growing (the outbox dispatches every 400 ms)
  let journals: any[] = [];
  for (let i = 0, last = -1, still = 0; i < 40; i++) {
    journals = await acc<any[]>('GET', '/api/accounting/journals?limit=500');
    still = journals.length === last ? still + 1 : 0;
    if (still >= 2 && journals.some((j) => j.source_type === 'payroll.run_paid') === x.has('payroll')) break;
    last = journals.length;
    await sleep(400);
  }
  const ids = new Map((await acc<any[]>('GET', '/api/accounting/accounts?postable=true')).map((a) => [a.code, a.id]));
  const end = monthEnd(-1);
  const jv = (description: string, ref: string, note: string, lines: [string, number, number, string][]) => acc('POST', '/api/accounting/journals', {
    entryDate: end, description, ref, note, post: true,
    lines: lines.map(([code, debit, credit, d]) => ({ accountId: ids.get(code), debit, credit, description: d })),
  });
  const th = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${Number(d.slice(0, 4)) + 543}`;
  await jv(`ตั้งค่าไฟฟ้าและน้ำประปาค้างจ่าย เดือน ${th(end).slice(3)}`, 'ACR-UTIL', 'ใบแจ้งหนี้ กฟภ./กปภ. ยังไม่มาถึงวันปิดงวด — กลับรายการเมื่อได้รับใบแจ้งหนี้', [
    ['52300', 48650, 0, 'ค่าไฟฟ้า (ประมาณจากหน่วยมิเตอร์ 9,730 หน่วย)'], ['52300', 2180, 0, 'ค่าน้ำประปา'], ['21600', 0, 50830, 'ค่าใช้จ่ายค้างจ่าย'],
  ]);
  await jv(`ค่าเสื่อมราคาประจำเดือน ${th(end).slice(3)}`, 'DEP-MONTHLY', 'วิธีเส้นตรง ตามทะเบียนทรัพย์สิน: เครื่องจักร 10 ปี ยานพาหนะ 5 ปี คอมพิวเตอร์ 3 ปี เฟอร์นิเจอร์ 5 ปี', [
    ['52900', 158460, 0, 'เครื่องจักร'], ['52900', 39450, 0, 'ยานพาหนะ'], ['52900', 10380, 0, 'คอมพิวเตอร์และอุปกรณ์'], ['52900', 3910, 0, 'เฟอร์นิเจอร์และเครื่องใช้สำนักงาน'],
    ['12900', 0, 212200, 'ค่าเสื่อมราคาสะสม'],
  ]);
  await acc('POST', `/api/accounting/periods/${end.slice(0, 7)}/close`, { note: 'ปิดงวดหลังตรวจงบทดลองและกระทบยอดลูกหนี้' });
  journals = await acc<any[]>('GET', '/api/accounting/journals?limit=500');
  const tb = await acc('GET', `/api/accounting/reports/trial-balance?asOf=${today()}`);
  const errors = await acc<any[]>('GET', '/api/accounting/posting-errors?status=open');
  if (errors.length) console.error(`  demo seed: accounting has ${errors.length} posting error(s): ${errors.map((e) => e.reason).join(' | ')}`);
  if (Number(tb.totals?.difference) !== 0) console.error(`  demo seed: trial balance is off by ${tb.totals?.difference}`);
  return `accounting ${journals.length} JVs · TB diff ${tb.totals?.difference} · posting errors ${errors.length} · closed ${end.slice(0, 7)}`;
}
