/**
 * Demo data for the office / service modules (hr, approvals, expense, booking, crm, helpdesk, projects, assets, quality)
 * of "บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด". Everything goes through the real HTTP APIs, as the people who would do it
 * (each demo user logs in and files their own requests, claims, bookings, tickets and hours).
 *
 * - `seedQualityPlans` runs BEFORE purchasing/production in seedDemo, so goods receipts and production completions
 *   create real QC inspections through events.
 * - `seedBusiness` runs at the end: extra users/roles, then every installed module in parallel.
 *
 * Dates are relative to "today" in Asia/Bangkok, so the demo always looks current.
 */

export type Call = <T = any>(method: string, path: string, body?: unknown) => Promise<T>;
type Item = { itemId: string; itemCode: string; itemName: string };

export interface BusinessCtx {
  call: Call;
  /** log in as another demo user (password demo1234) */
  loginAs: (email: string) => Promise<Call>;
  has: (module: string) => boolean;
  /** installed module ids (role templates keep only their permissions) */
  modules: string[];
  items: Record<string, Item>;
  partners: Record<string, any>;
}

/* ------------------------------------------------------------------ dates (Asia/Bangkok) ------------------------------------------------------------------ */

const BKK_MS = 7 * 3600 * 1000;
const bkkDate = (d: Date = new Date()) => new Date(d.getTime() + BKK_MS).toISOString().slice(0, 10);
const bkkMinutesNow = () => {
  const s = new Date(Date.now() + BKK_MS).toISOString();
  return Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
};
const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const weekday = (date: string) => new Date(`${date}T00:00:00Z`).getUTCDay();
const hm = (mins: number) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
const iso = (date: string, time: string) => `${date}T${time}:00+07:00`;
/** deterministic 0..1 noise so every demo looks the same */
const noise = (n: number) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

/** Thai public holidays 2026 (พ.ศ. 2569) incl. substitution days. Lunar dates per the Cabinet's announced calendar. */
const HOLIDAYS: [string, string][] = [
  ['2026-01-01', 'วันขึ้นปีใหม่'], ['2026-01-02', 'วันหยุดพิเศษ (ต่อเนื่องปีใหม่)'], ['2026-03-03', 'วันมาฆบูชา'],
  ['2026-04-06', 'วันจักรี'], ['2026-04-13', 'วันสงกรานต์'], ['2026-04-14', 'วันสงกรานต์'], ['2026-04-15', 'วันสงกรานต์'],
  ['2026-05-01', 'วันแรงงานแห่งชาติ'], ['2026-05-04', 'วันฉัตรมงคล'], ['2026-06-01', 'ชดเชยวันวิสาขบูชา'],
  ['2026-06-03', 'วันเฉลิมพระชนมพรรษาสมเด็จพระราชินี'], ['2026-07-28', 'วันเฉลิมพระชนมพรรษา ร.10'], ['2026-07-29', 'วันอาสาฬหบูชา'],
  ['2026-07-30', 'วันเข้าพรรษา'], ['2026-08-12', 'วันแม่แห่งชาติ'], ['2026-10-13', 'วันคล้ายวันสวรรคต ร.9'],
  ['2026-10-23', 'วันปิยมหาราช'], ['2026-12-07', 'ชดเชยวันพ่อแห่งชาติ'], ['2026-12-10', 'วันรัฐธรรมนูญ'], ['2026-12-31', 'วันสิ้นปี'],
];
const HOLIDAY_SET = new Set(HOLIDAYS.map(([d]) => d));
const isWorkday = (d: string) => weekday(d) !== 0 && weekday(d) !== 6 && !HOLIDAY_SET.has(d);

/** n-th working day from today: 0 = today (or the last working day), -1 = previous working day, +1 = next working day. */
function wd(n: number, from = bkkDate()): string {
  let d = from;
  if (n <= 0) {
    while (!isWorkday(d)) d = addDays(d, -1);
    for (let i = 0; i < -n; i++) do d = addDays(d, -1); while (!isWorkday(d));
  } else {
    for (let i = 0; i < n; i++) do d = addDays(d, 1); while (!isWorkday(d));
  }
  return d;
}
const dayBack = (n: number) => addDays(bkkDate(), -n);

/* ------------------------------------------------------------------ people ------------------------------------------------------------------ */

const PW = 'demo1234';
/** users added by this seed (the core seed already has admin, store, buyer, sales, tech, plan) */
const NEW_USERS: [string, string][] = [
  ['hr@demo.co.th', 'นภาพร ใจงาม'], ['acc@demo.co.th', 'สุดารัตน์ บุญมา'], ['it@demo.co.th', 'ธนากร พึ่งบุญ'], ['qc@demo.co.th', 'อรุณี ทองดี'],
];
/**
 * Wave 8 (round-2 N3): every demo user gets Identity's suggested role templates — exactly what a customer gets from
 * "สร้างจากแม่แบบ" — plus self-service (พนักงานทั่วไป). No hand-made `inventory.*`-style roles, so what buyers try in the demo
 * is what they will have on day one. Template ids per user (the admin keeps `*`).
 */
export const DEMO_USER_TEMPLATES: Record<string, string[]> = {
  'store@demo.co.th': ['warehouse'], 'buyer@demo.co.th': ['purchasing'], 'sales@demo.co.th': ['sales'], 'tech@demo.co.th': ['technician'],
  'plan@demo.co.th': ['pm', 'planner'], 'hr@demo.co.th': ['hr'], 'acc@demo.co.th': ['accounting'], 'it@demo.co.th': ['it'], 'qc@demo.co.th': ['qc'],
};
/** templates every demo user also gets; `executive` is created for the admin screens (ผู้บริหาร) but no demo user holds it */
const BASE_TEMPLATES = ['staff'];

/**
 * Roles made from Identity's role templates (`POST /roles/from-template`), keeping only the installed modules' permissions.
 * A role whose name already exists is reused (re-running on an existing company). Returns template id → role id.
 */
export async function templateRoles(call: Call, modules: string[], templates: string[]): Promise<Record<string, string>> {
  const byName: Record<string, string> = {};
  for (const r of await call<any[]>('GET', '/api/identity/roles')) byName[r.name] = r.id;
  const list = await call<any[]>('GET', `/api/identity/role-templates?modules=${modules.join(',')}`);
  const out: Record<string, string> = {};
  for (const id of templates) {
    const tpl = list.find((x) => x.id === id);
    if (!tpl) throw new Error(`demo seed: unknown role template ${id}`);
    out[id] = byName[tpl.name] ?? (await call('POST', '/api/identity/roles/from-template', { template: id, modules })).id;
  }
  return out;
}

/** role ids of a demo user: their templates + self-service */
export const demoRoleIds = (email: string, roles: Record<string, string>) =>
  [...new Set([...(DEMO_USER_TEMPLATES[email] ?? []), ...BASE_TEMPLATES].map((t) => roles[t]).filter(Boolean))];

type User = { id: string; name: string; email: string };
interface Ctx extends BusinessCtx {
  users: Record<string, User>; // by short key: admin, store, buyer, sales, tech, plan, hr, acc, it, qc
  as: Record<string, Call>;
  dept: Record<string, string>; // user key -> Thai department name
}

const ref = (u: User) => ({ userId: u.id, userName: u.name });

/* ------------------------------------------------------------------ entry points ------------------------------------------------------------------ */

/** Inspection plans first, so the core seed's goods receipts / production completions raise real QC inspections. */
export async function seedQualityPlans(call: Call, items: Record<string, Item>): Promise<void> {
  const plan = (code: string, stage: string, name: string, samplingMode: string, samplingValue: number, checkpoints: any[]) =>
    call('POST', '/api/quality/plans', { ...items[code], stage, name, samplingMode, samplingValue, checkpoints });
  await Promise.all([
    plan('RM-SPCC-12', 'incoming', 'ตรวจรับเหล็กแผ่น SPCC 1.2 มม.', 'fixed', 5, [
      { name: 'ความหนา', method: 'ไมโครมิเตอร์ 5 จุดต่อแผ่น', type: 'measure', unit: 'มม.', target: 1.2, min: 1.14, max: 1.26, critical: true },
      { name: 'ความกว้างแผ่น', method: 'ตลับเมตร', type: 'measure', unit: 'มม.', target: 1219, min: 1217, max: 1222 },
      { name: 'ผิวไม่มีสนิม/รอยขีดข่วน', method: 'ตรวจด้วยสายตา', type: 'visual' },
      { name: 'ใบรับรองวัสดุ (Mill certificate) ตรงล็อต', type: 'pass_fail', critical: true },
    ]),
    plan('RM-SUS304', 'incoming', 'ตรวจรับสแตนเลส SUS304 1.0 มม.', 'fixed', 3, [
      { name: 'ความหนา', method: 'ไมโครมิเตอร์', type: 'measure', unit: 'มม.', target: 1.0, min: 0.95, max: 1.05, critical: true },
      { name: 'ทดสอบแม่เหล็ก (ไม่ดูด)', method: 'แม่เหล็กทดสอบ', type: 'pass_fail', critical: true },
      { name: 'ฟิล์มกันรอยครบ ผิวไม่มีรอย', type: 'visual' },
    ]),
    plan('FG-BRK-100', 'final', 'ตรวจก่อนส่งมอบ ขายึดแอร์ BRK-100', 'percent', 1, [
      { name: 'ระยะห่างรูยึด', method: 'เวอร์เนียร์ / Jig ตรวจ', type: 'measure', unit: 'มม.', target: 80, min: 79.7, max: 80.3, critical: true },
      { name: 'มุมพับ', method: 'ฉากวัดมุม', type: 'measure', unit: 'องศา', target: 90, min: 89, max: 91 },
      { name: 'ความหนาสีฝุ่น', method: 'เครื่องวัดความหนาสี', type: 'measure', unit: 'ไมครอน', target: 80, min: 60, max: 100 },
      { name: 'ผิวสีเรียบ ไม่มีเม็ด/ด่าง', type: 'visual' },
    ]),
    plan('FG-BRK-200', 'final', 'ตรวจก่อนส่งมอบ ขายึดแอร์ BRK-200 (สแตนเลส)', 'fixed', 5, [
      { name: 'ระยะห่างรูยึด', type: 'measure', unit: 'มม.', target: 80, min: 79.7, max: 80.3, critical: true },
      { name: 'ครีบคม/ครีบเหล็ก (Burr)', type: 'pass_fail' },
      { name: 'ผิวสแตนเลสไม่มีรอยขีดข่วน', type: 'visual' },
    ]),
  ]);
}

export async function seedBusiness(base: BusinessCtx): Promise<void> {
  const mods = ['hr', 'approvals', 'expense', 'booking', 'crm', 'helpdesk', 'projects', 'assets', 'quality', 'sales', 'contracts'].filter(base.has);
  // payroll's profiles come from HR's employee events
  if (base.has('payroll') && base.has('hr')) mods.push('payroll');
  if (!mods.length) return;
  const t0 = Date.now();
  const ctx = await people(base);
  const finance = await import('./demo-finance.ts');
  const notes: string[] = [];
  const note = (p: Promise<string>) => p.then((s) => { notes.push(s); });
  const seeders: Record<string, (x: Ctx) => Promise<unknown>> = {
    hr: seedHr, approvals: seedApprovals, expense: seedExpense, booking: seedBooking, crm: seedCrm,
    helpdesk: seedHelpdesk, projects: seedProjects, assets: seedAssets, quality: seedQualityWork, sales: seedReceivables,
    payroll: (x) => note(finance.seedPayroll(x)), contracts: (x) => note(finance.seedContracts(x)),
  };
  const failed: string[] = [];
  const timings: string[] = [];
  await Promise.all(mods.map(async (m) => {
    const s = Date.now();
    try {
      await seeders[m](ctx);
      timings.push(`${m} ${((Date.now() - s) / 1000).toFixed(1)}s`);
    } catch (err) {
      failed.push(m);
      console.error(`demo seed: ${m} failed —`, err instanceof Error ? err.message : err);
    }
  }));
  // last, once the other modules' events have been delivered: a few personal flows, so they sit at the top of each person's bell
  await finale(ctx).catch((err) => { failed.push('finale'); console.error('demo seed: finale failed —', err instanceof Error ? err.message : err); });
  // files on records of several modules, then the books: check them and close last month once every event has posted
  await note(finance.seedAttachments(ctx)).catch((err) => { failed.push('attachments'); console.error('demo seed: attachments failed —', err instanceof Error ? err.message : err); });
  // wave 9 tax documents of the past months (credit/debit notes, supplier bills, payments with WHT) — before the books close last month
  const tax = await import('./demo-tax.ts');
  await note(tax.seedTaxDocuments(ctx)).catch((err) => { failed.push('tax documents'); console.error('demo seed: tax documents failed —', err instanceof Error ? err.message : err); });
  if (base.has('accounting')) {
    await note(finance.closeBooks(ctx)).catch((err) => { failed.push('accounting'); console.error('demo seed: accounting close failed —', err instanceof Error ? err.message : err); });
  }
  // ภ.พ.30 filing records (every past month but this one) and e-Tax, once everything has posted and last month is closed
  await note(tax.seedTaxFilings(ctx)).catch((err) => { failed.push('tax filings'); console.error('demo seed: tax filings / e-Tax failed —', err instanceof Error ? err.message : err); });
  console.log(`  business modules seeded in ${((Date.now() - t0) / 1000).toFixed(1)}s (${timings.join(', ')})`);
  for (const n of notes) console.log(`  ${n}`);
  if (failed.length) console.error(`  demo seed: incomplete modules: ${failed.join(', ')}`);
}

/**
 * Wave 4 notifications are personal: each person's bell shows what is addressed to them. Acting through the real flows here means
 * the newest items are — admin: sales' new request to approve; sales@: "อนุมัติแล้ว" and "จ่ายเงินแล้ว"; acc@: QC's budget request.
 */
async function finale(x: Ctx) {
  const { as, has, users: u, dept } = x;
  await new Promise((r) => setTimeout(r, 1500));
  if (has('approvals')) {
    const types = await as.admin<any[]>('GET', '/api/approvals/types');
    const typeId = (code: string) => types.find((t) => t.code === code)?.id;
    const expo = (await as.admin<any[]>('GET', '/api/approvals/inbox')).find((r) => r.title?.startsWith('ออกบูธงาน Manufacturing Expo'));
    if (expo) await as.admin('POST', `/api/approvals/requests/${expo.id}/approve`, { note: 'อนุมัติ ขอรายชื่อลูกค้าที่นัดพบที่บูธด้วย' });
    await as.qc('POST', '/api/approvals/requests', {
      typeId: typeId('BUDGET'), title: 'ส่งหัวหน้างาน 2 คนอบรม Internal Auditor ISO 9001', detail: 'หลักสูตร 2 วัน สถาบันรับรองมาตรฐาน — เตรียมตรวจติดตามภายในก่อน Surveillance audit',
      amount: 8500, neededBy: wd(8), department: dept.qc, submit: true,
    });
    await as.sales('POST', '/api/approvals/requests', {
      typeId: typeId('TRAVEL'), title: 'เยี่ยมลูกค้าใหม่ ไทยโฮม แอพพลายแอนซ์ ส่งตัวอย่างขายึดคอมเพรสเซอร์', detail: 'นำตัวอย่าง 20 ชิ้นและใบเสนอราคาไปนำเสนอฝ่ายจัดซื้อและวิศวกรรม',
      amount: 1800, neededBy: wd(3), department: dept.sales, submit: true,
    });
  }
  if (has('expense')) {
    // accounting pays the salesman's approved entertainment claim: he gets "จ่ายเงินแล้ว"
    const toPay = (await as.acc<any>('GET', '/api/expense/reports/outstanding')).items ?? [];
    const claim = toPay.find((c: any) => c.claimant_id === u.sales.id && String(c.purpose).startsWith('รับรองลูกค้า อีสเทิร์น'));
    if (claim) await as.acc('POST', `/api/expense/claims/${claim.id}/pay`, { method: 'transfer', paidDate: bkkDate(), reference: 'KBANK-7731' });
  }
}

/** Extra users, everybody on Identity's role templates + self-service, then one session per user. */
async function people(base: BusinessCtx): Promise<Ctx> {
  const { call } = base;
  const templates = [...new Set([...Object.values(DEMO_USER_TEMPLATES).flat(), ...BASE_TEMPLATES, 'executive', 'supervisor'])];
  const roles = await templateRoles(call, base.modules, templates);
  const existing = await call<any[]>('GET', '/api/identity/users');
  const have = new Set(existing.map((u) => u.email));
  await Promise.all(NEW_USERS.filter(([e]) => !have.has(e)).map(([email, name]) => call('POST', '/api/identity/users', { email, name, password: PW, roleIds: [] })));
  const all = await call<any[]>('GET', '/api/identity/users');
  await Promise.all(all.filter((u) => u.email in DEMO_USER_TEMPLATES).map((u) => call('PUT', `/api/identity/users/${u.id}/roles`, { roleIds: demoRoleIds(u.email, roles) })));
  const users: Record<string, User> = {};
  for (const u of all) {
    const key = u.email.split('@')[0];
    users[key] = { id: u.id, name: u.name, email: u.email };
  }
  const as: Record<string, Call> = { admin: call };
  await Promise.all(Object.entries(users).filter(([k]) => k !== 'admin').map(async ([k, u]) => { as[k] = await base.loginAs(u.email); }));
  const dept = {
    admin: 'ผลิต', plan: 'ผลิต', store: 'คลังสินค้า', buyer: 'จัดซื้อ', sales: 'ขาย', tech: 'ซ่อมบำรุง',
    hr: 'บุคคล', acc: 'บัญชี', it: 'ไอที', qc: 'QC',
  };
  return { ...base, users, as, dept };
}

/* ------------------------------------------------------------------ hr ------------------------------------------------------------------ */

const EMPLOYEES: { code: string; prefix: string; first: string; last: string; nick: string; dept: string; pos: string; start: string; user?: string; status?: string; phone: string }[] = [
  { code: 'EMP-001', prefix: 'นาย', first: 'สมศักดิ์', last: 'ศรีสวัสดิ์', nick: 'ศักดิ์', dept: 'PROD', pos: 'MD', start: '2012-04-02', user: 'admin', phone: '081-234-5501' },
  { code: 'EMP-002', prefix: 'นางสาว', first: 'กมลชนก', last: 'วางแผน', nick: 'ฝน', dept: 'PROD', pos: 'PLAN', start: '2019-06-03', user: 'plan', phone: '089-114-2290' },
  { code: 'EMP-003', prefix: 'นาย', first: 'สมชาย', last: 'คลังดี', nick: 'ชาย', dept: 'WH', pos: 'HEAD', start: '2016-01-04', user: 'store', phone: '086-552-1803' },
  { code: 'EMP-004', prefix: 'นางสาว', first: 'วิไลวรรณ', last: 'จัดซื้อ', nick: 'วิ', dept: 'PUR', pos: 'HEAD', start: '2017-08-01', user: 'buyer', phone: '092-771-4410' },
  { code: 'EMP-005', prefix: 'นาย', first: 'ปิยะพงษ์', last: 'ขายเก่ง', nick: 'ปิง', dept: 'SALES', pos: 'HEAD', start: '2018-02-01', user: 'sales', phone: '081-909-3321' },
  { code: 'EMP-006', prefix: 'นาย', first: 'ประเสริฐ', last: 'ช่างใหญ่', nick: 'เสริฐ', dept: 'MT', pos: 'HEAD', start: '2013-05-02', user: 'tech', phone: '087-440-1192' },
  { code: 'EMP-007', prefix: 'นาง', first: 'นภาพร', last: 'ใจงาม', nick: 'นก', dept: 'HR', pos: 'HEAD', start: '2015-07-01', user: 'hr', phone: '085-118-7746' },
  { code: 'EMP-008', prefix: 'นางสาว', first: 'สุดารัตน์', last: 'บุญมา', nick: 'ดา', dept: 'ACC', pos: 'HEAD', start: '2016-09-01', user: 'acc', phone: '089-552-0187' },
  { code: 'EMP-009', prefix: 'นาย', first: 'ธนากร', last: 'พึ่งบุญ', nick: 'ต้น', dept: 'IT', pos: 'OFF', start: '2021-03-01', user: 'it', phone: '094-332-8810' },
  { code: 'EMP-010', prefix: 'นางสาว', first: 'อรุณี', last: 'ทองดี', nick: 'อร', dept: 'QC', pos: 'HEAD', start: '2017-11-01', user: 'qc', phone: '082-660-4519' },
  { code: 'EMP-011', prefix: 'นาย', first: 'บุญเลิศ', last: 'แก้วมณี', nick: 'เลิศ', dept: 'PROD', pos: 'SUP', start: '2014-06-02', phone: '081-775-6034' },
  { code: 'EMP-012', prefix: 'นาย', first: 'สุรชัย', last: 'อินทร์แก้ว', nick: 'ชัย', dept: 'PROD', pos: 'OP', start: '2018-10-01', phone: '063-118-2245' },
  { code: 'EMP-013', prefix: 'นาย', first: 'อนุชา', last: 'มีสุข', nick: 'นุ', dept: 'PROD', pos: 'OP', start: '2020-01-06', phone: '095-448-1120' },
  { code: 'EMP-014', prefix: 'นางสาว', first: 'จันทร์เพ็ญ', last: 'ศรีสุข', nick: 'เพ็ญ', dept: 'PROD', pos: 'OP', start: '2019-04-01', phone: '061-552-9087' },
  { code: 'EMP-015', prefix: 'นาย', first: 'วีระพงษ์', last: 'สายทอง', nick: 'วี', dept: 'PROD', pos: 'OP', start: '2022-02-01', phone: '098-221-4473' },
  { code: 'EMP-016', prefix: 'นาย', first: 'ณัฐวุฒิ', last: 'คำแสน', nick: 'ณัฐ', dept: 'PROD', pos: 'OP', start: dayBack(70), status: 'probation', phone: '064-998-1302' },
  { code: 'EMP-017', prefix: 'นาง', first: 'สมพร', last: 'พรหมมา', nick: 'พร', dept: 'PROD', pos: 'OP', start: '2015-03-02', phone: '089-030-5561' },
  { code: 'EMP-018', prefix: 'นาย', first: 'ชาตรี', last: 'บุญยืน', nick: 'ตรี', dept: 'PROD', pos: 'WELD', start: '2017-05-15', phone: '086-771-0045' },
  { code: 'EMP-019', prefix: 'นาย', first: 'เอกชัย', last: 'ทองคำ', nick: 'เอก', dept: 'WH', pos: 'STORE', start: '2020-08-03', phone: '091-224-6618' },
  { code: 'EMP-020', prefix: 'นาย', first: 'ไพโรจน์', last: 'ดวงแก้ว', nick: 'โรจน์', dept: 'WH', pos: 'DRV', start: '2016-11-01', phone: '081-443-2097' },
  { code: 'EMP-021', prefix: 'นาย', first: 'ศักดิ์ชัย', last: 'เพชรรัตน์', nick: 'ชัย', dept: 'MT', pos: 'TECH', start: '2018-07-02', phone: '087-115-3364' },
  { code: 'EMP-022', prefix: 'นาย', first: 'วิทยา', last: 'จันทร์หอม', nick: 'วิทย์', dept: 'MT', pos: 'TECH', start: '2021-09-01', phone: '090-662-1178' },
  { code: 'EMP-023', prefix: 'นางสาว', first: 'ปวีณา', last: 'แสงจันทร์', nick: 'แพร', dept: 'QC', pos: 'INSP', start: '2022-06-01', phone: '062-337-9915' },
  { code: 'EMP-024', prefix: 'นางสาว', first: 'ศิริพร', last: 'คงสวัสดิ์', nick: 'ศิ', dept: 'ACC', pos: 'OFF', start: '2020-03-02', phone: '084-881-2236' },
  { code: 'EMP-025', prefix: 'นางสาว', first: 'ธิดารัตน์', last: 'วงศ์ใหญ่', nick: 'ธิดา', dept: 'SALES', pos: 'OFF', start: dayBack(45), status: 'probation', phone: '093-110-7782' },
  { code: 'EMP-026', prefix: 'นาย', first: 'กิตติศักดิ์', last: 'บุญประเสริฐ', nick: 'กิต', dept: 'PROD', pos: 'OP', start: '2023-01-09', phone: '096-405-3318' },
  { code: 'EMP-027', prefix: 'นางสาว', first: 'พิมพ์ชนก', last: 'ศรีเมือง', nick: 'พิม', dept: 'HR', pos: 'OFF', start: '2021-07-01', phone: '095-771-2048' },
];

/**
 * Org chart (wave 4: leave goes to the manager, not to one HR inbox). Department heads approve their team; the heads report to the MD
 * (EMP-001 = admin@), whose own leave falls to HR. EMP-009 is the only IT person, so he heads IT and reports to the MD as well.
 */
const DEPT_HEADS: Record<string, string> = {
  PROD: 'EMP-001', WH: 'EMP-003', MT: 'EMP-006', PUR: 'EMP-004', SALES: 'EMP-005', ACC: 'EMP-008', HR: 'EMP-007', IT: 'EMP-009', QC: 'EMP-010',
};
const HEADS = new Set(Object.values(DEPT_HEADS));
/** the employee who approves `code`'s leave (null = HR decides) — mirrors hr's APPROVER_JOIN for the seed's own bookkeeping */
const leaveApprover = (code: string): string | null => {
  if (code === 'EMP-001') return null;
  if (HEADS.has(code)) return 'EMP-001';
  return DEPT_HEADS[EMPLOYEES.find((e) => e.code === code)!.dept] ?? null;
};
const userOf = (code: string | null) => (code ? EMPLOYEES.find((e) => e.code === code)?.user : undefined);

/** [employee, type, from (working-day offset), working days, halfDay, reason, outcome, decision note] */
const LEAVES: [string, string, number, number, boolean, string, 'approved' | 'pending' | 'rejected' | 'cancelled', string?][] = [
  ['EMP-012', 'SICK', -38, 1, false, 'ไข้หวัด มีใบรับรองแพทย์', 'approved'],
  ['EMP-014', 'ANNUAL', -33, 3, false, 'พาครอบครัวไปเที่ยวเชียงใหม่', 'approved', 'อนุมัติ ฝากงานพับให้พี่เลิศแล้ว'],
  ['EMP-019', 'BUSINESS', -29, 1, false, 'ติดต่อราชการที่อำเภอ', 'approved'],
  ['EMP-003', 'SICK', -26, 1, true, 'ไปพบแพทย์ตามนัด ช่วงเช้า', 'approved'],
  ['EMP-021', 'ANNUAL', -22, 2, false, 'กลับบ้านต่างจังหวัด งานบุญประจำปี', 'approved'],
  ['EMP-016', 'BUSINESS', -19, 1, false, 'ธุระส่วนตัว', 'rejected', 'ช่วงนั้นมีออเดอร์เร่งของคูลแอร์ ขอเลื่อนเป็นสัปดาห์ถัดไป'],
  ['EMP-024', 'SICK', -15, 2, false, 'อาหารเป็นพิษ มีใบรับรองแพทย์', 'approved'],
  ['EMP-005', 'ANNUAL', -12, 1, false, 'พักร้อน', 'approved'],
  ['EMP-013', 'BUSINESS', -10, 1, true, 'ไปธนาคาร ทำเรื่องสินเชื่อบ้าน', 'approved'],
  ['EMP-017', 'ANNUAL', -7, 1, false, 'ไปงานรับปริญญาลูก', 'cancelled', 'ยกเลิกเอง — งานเลื่อน'],
  ['EMP-027', 'ANNUAL', -9, 1, false, 'พาคุณแม่ไปทำบุญต่างจังหวัด', 'approved', 'อนุมัติ ฝากเรื่องสรุปเวลาทำงานไว้กับพี่นกแล้ว'],
  ['EMP-022', 'SICK', -5, 1, false, 'ปวดหลัง ไปหาหมอ', 'approved'],
  ['EMP-009', 'SICK', -1, 1, false, 'ไข้สูง ส่งใบรับรองแพทย์ย้อนหลัง', 'pending'],
  ['EMP-018', 'SICK', 0, 1, false, 'ไข้หวัด แจ้งทางไลน์เช้านี้', 'approved', 'หายไวๆ นะ'],
  ['EMP-023', 'BUSINESS', 3, 1, false, 'พาแม่ไปโรงพยาบาลตามนัด', 'pending'],
  ['EMP-011', 'ANNUAL', 5, 2, false, 'งานบวชน้องชายที่ร้อยเอ็ด', 'pending'],
  ['EMP-002', 'ANNUAL', 10, 3, false, 'ท่องเที่ยวต่างประเทศกับครอบครัว (จองตั๋วแล้ว)', 'pending'],
];

async function seedHr(x: Ctx) {
  const { call, users, as } = x;
  await call('PUT', '/api/hr/schedule', { startTime: '08:00', endTime: '17:00', graceMinutes: 5, saturdayWorkday: false });
  const [types] = await Promise.all([
    call('POST', '/api/hr/leave-types/defaults').then((r: any) => Object.fromEntries(r.types.map((t: any) => [t.code, t.id]))),
    ...HOLIDAYS.map(([date, name]) => call('POST', '/api/hr/holidays', { date, name })),
  ]);
  const depts: Record<string, string> = {};
  const positions: Record<string, string> = {};
  await Promise.all([
    ...([['PROD', 'ผลิต'], ['WH', 'คลังสินค้า'], ['MT', 'ซ่อมบำรุง'], ['PUR', 'จัดซื้อ'], ['SALES', 'ขาย'], ['ACC', 'บัญชี'],
      ['HR', 'บุคคล'], ['IT', 'ไอที'], ['QC', 'QC']] as const)
      .map(async ([code, name]) => { depts[code] = (await call('POST', '/api/hr/departments', { code, name })).id; }),
    ...([['MD', 'กรรมการผู้จัดการ'], ['HEAD', 'หัวหน้าแผนก'], ['SUP', 'หัวหน้างาน (โฟร์แมน)'], ['PLAN', 'เจ้าหน้าที่วางแผนการผลิต'],
      ['OFF', 'เจ้าหน้าที่'], ['OP', 'พนักงานฝ่ายผลิต'], ['WELD', 'ช่างเชื่อม'], ['TECH', 'ช่างซ่อมบำรุง'], ['STORE', 'พนักงานคลังสินค้า'],
      ['DRV', 'พนักงานขับรถ'], ['INSP', 'พนักงานตรวจสอบคุณภาพ']] as const)
      .map(async ([code, name]) => { positions[code] = (await call('POST', '/api/hr/positions', { code, name })).id; }),
  ]);
  const emp: Record<string, string> = {};
  await Promise.all(EMPLOYEES.map(async (e, i) => {
    const r = await call('POST', '/api/hr/employees', {
      code: e.code, prefix: e.prefix, firstName: e.first, lastName: e.last, nickname: e.nick, departmentId: depts[e.dept], positionId: positions[e.pos],
      startDate: e.start, birthDate: `${1972 + (i * 7) % 28}-${String(1 + (i * 5) % 12).padStart(2, '0')}-${String(3 + (i * 11) % 25).padStart(2, '0')}`,
      phone: e.phone, email: e.user ? users[e.user]?.email : undefined, status: e.status ?? 'active', userId: e.user ? users[e.user]?.id : undefined,
    });
    emp[e.code] = r.id;
  }));
  await call('POST', `/api/hr/employees/${emp['EMP-026']}/resign`, { resignedOn: wd(-22) });
  // org chart: department heads, and every head reports to the MD
  await Promise.all([
    ...Object.entries(DEPT_HEADS).map(([d, head]) => call('PATCH', `/api/hr/departments/${depts[d]}`, { managerEmployeeId: emp[head] })),
    ...[...HEADS].filter((h) => h !== 'EMP-001').map((h) => call('PATCH', `/api/hr/employees/${emp[h]}`, { managerId: emp['EMP-001'] })),
  ]);

  // leave: oldest first so LV numbers follow the calendar. Staff with a login file their own (self-service); HR keys in the paper forms
  // of the shop floor. The employee's manager decides — the request lands in their "ใบลาลูกทีม" inbox and bell — HR only when nobody is above.
  const onLeave = new Set<string>();
  for (const [code, type, off, days, halfDay, reason, outcome, note] of LEAVES) {
    const fromDate = wd(off);
    let toDate = wd(off + days - 1);
    if (toDate.slice(0, 4) !== fromDate.slice(0, 4)) toDate = fromDate;
    const self = userOf(code);
    const lv = self
      ? await as[self]('POST', '/api/hr/leave-requests', { leaveTypeId: types[type], fromDate, toDate, halfDay, reason })
      : await as.hr('POST', '/api/hr/leave-requests', { employeeId: emp[code], leaveTypeId: types[type], fromDate, toDate, halfDay, reason });
    const boss = as[userOf(leaveApprover(code)) ?? 'hr'];
    if (outcome === 'approved' || outcome === 'cancelled') await boss('POST', `/api/hr/leave-requests/${lv.id}/approve`, { note });
    if (outcome === 'rejected') await boss('POST', `/api/hr/leave-requests/${lv.id}/reject`, { note });
    if (outcome === 'cancelled') await boss('POST', `/api/hr/leave-requests/${lv.id}/cancel`, { note });
    if (outcome === 'approved' && !halfDay) for (let d = fromDate; d <= toDate; d = addDays(d, 1)) onLeave.add(`${code}|${d}`);
  }

  // attendance: the last 5 working days + this morning (admin-recorded scans with the real times)
  const today = bkkDate();
  const past = [-5, -4, -3, -2, -1].map((n) => wd(n));
  const nowMin = bkkMinutesNow();
  const working = EMPLOYEES.filter((e) => e.code !== 'EMP-026');
  await Promise.all(working.map(async (e, i) => {
    const id = emp[e.code];
    if (e.start > past[0]) return;
    for (const [j, day] of past.entries()) {
      if (onLeave.has(`${e.code}|${day}`)) continue;
      const late = noise(i * 31 + j * 7) < 0.12;
      const inMin = late ? 8 * 60 + 6 + Math.floor(noise(i + j * 13) * 30) : 7 * 60 + 28 + Math.floor(noise(i * 3 + j) * 30);
      const ot = e.dept === 'PROD' && noise(i * 5 + j * 17) < 0.35;
      const outMin = 17 * 60 + Math.floor(noise(i * 7 + j * 3) * 25) + (ot ? 120 : 0);
      await call('POST', `/api/hr/employees/${id}/check-in`, { date: day, time: hm(inMin), note: late ? 'รถติดบนถนนเทพารักษ์' : undefined });
      await call('POST', `/api/hr/employees/${id}/check-out`, { date: day, time: hm(outMin), note: ot ? 'OT เร่งงานออเดอร์คูลแอร์' : undefined });
    }
    if (!isWorkday(today) || onLeave.has(`${e.code}|${today}`) || e.code === 'EMP-015') return; // EMP-015 has not shown up yet
    const late = e.code === 'EMP-013' || e.code === 'EMP-020' || noise(i * 41) < 0.08;
    const inMin = late ? 8 * 60 + 9 + Math.floor(noise(i) * 25) : 7 * 60 + 30 + Math.floor(noise(i * 9) * 28);
    if (inMin > nowMin - 1) return; // not in yet at this hour
    await call('POST', `/api/hr/employees/${id}/check-in`, { date: today, time: hm(inMin), note: late ? 'ฝนตก รถติด' : undefined });
  }));
}

/* ------------------------------------------------------------------ approvals ------------------------------------------------------------------ */

async function seedApprovals(x: Ctx) {
  const { call, users: u, as, dept } = x;
  const type = async (code: string, name: string, description: string, amountNote: string, chain: User[]) =>
    (await call('POST', '/api/approvals/types', { code, name, description, amountNote, approvers: chain.map(ref) })).id;
  const [PR, TRAVEL, BUDGET, MEMO] = await Promise.all([
    type('PR', 'ขอซื้อ/ขอจ้าง', 'ขออนุมัติซื้อสินค้า วัสดุ อุปกรณ์ หรือจ้างผู้รับเหมา นอกเหนือจากวัตถุดิบตามแผนผลิต', 'ระบุราคารวม VAT แนบใบเสนอราคา', [u.buyer, u.admin]),
    type('TRAVEL', 'ขอเดินทาง/พบลูกค้า', 'ขออนุมัติเดินทางไปต่างจังหวัด ออกบูธ หรือพบลูกค้า', 'ประมาณการค่าใช้จ่ายทั้งหมด', [u.admin]),
    type('BUDGET', 'ขอใช้งบประมาณ', 'ขอใช้งบนอกแผน เช่น OT พิเศษ สอบเทียบ อบรม', 'ระบุงบที่ขอ', [u.acc, u.admin]),
    type('MEMO', 'บันทึกข้อความภายใน', 'บันทึกข้อความเสนอผู้จัดการโรงงาน', '', [u.admin]),
  ]);
  type Step = ['approve' | 'reject' | 'return', string, string?];
  const req = async (who: string, typeId: string, title: string, detail: string, amount: number | null, neededBy: number | null, steps: Step[], opts: { draft?: boolean; cancel?: string } = {}) => {
    const r = await as[who]('POST', '/api/approvals/requests', {
      typeId, title, detail, amount, neededBy: neededBy === null ? null : wd(neededBy), requesterName: u[who].name, department: dept[who], submit: !opts.draft,
    });
    for (const [action, by, note] of steps) await as[by]('POST', `/api/approvals/requests/${r.id}/${action}`, note ? { note } : {});
    if (opts.cancel) await as[who]('POST', `/api/approvals/requests/${r.id}/cancel`, { note: opts.cancel });
  };
  await req('tech', PR, 'ซื้อปั๊มไฮดรอลิกสำรองสำหรับ PRESS-02', 'ปั๊มเดิมรั่วซ้ำ 3 ครั้งในไตรมาสนี้ ขอซื้อสำรองไว้ 1 ชุดเพื่อลด downtime', 48500, -20,
    [['approve', 'buyer', 'เทียบราคา 3 เจ้าแล้ว ร้านช่างไทยอะไหล่ถูกสุด'], ['approve', 'admin']]);
  await req('sales', TRAVEL, 'เยี่ยมลูกค้า อีสเทิร์น อิเล็คทริค ปลวกแดง ระยอง', 'คุยแผนออเดอร์ CASE-01 ไตรมาส 4 และรับฟังปัญหาบานพับ', 3200, -16, [['approve', 'admin', 'ไปได้ ใช้รถกระบะบริษัท']]);
  await req('qc', BUDGET, 'ค่าสอบเทียบเครื่องมือวัดประจำปี (Calibration)', 'ไมโครมิเตอร์ 6 ตัว เวอร์เนียร์ 8 ตัว เครื่องวัดความหนาสี 1 เครื่อง — ข้อกำหนด ISO 9001 ข้อ 7.1.5', 28000, -12,
    [['approve', 'acc', 'อยู่ในงบ QC ปีนี้'], ['approve', 'admin']]);
  await req('it', PR, 'จัดซื้อ Notebook ทดแทน 3 เครื่อง', 'เครื่องฝ่ายบัญชี/จัดซื้ออายุเกิน 5 ปี เปิดโปรแกรมช้า', 87000, -10,
    [['approve', 'buyer'], ['reject', 'admin', 'ให้ใช้เครื่องเดิมไปก่อน เพิ่ม RAM/SSD แทน แล้วเสนอใหม่ไตรมาสหน้า']]);
  await req('hr', MEMO, 'ขออนุมัติจัดกิจกรรม Big Cleaning Day 5ส', 'วันเสาร์สิ้นเดือน พนักงานทุกแผนก มีอาหารกลางวันและรางวัลพื้นที่ดีเด่น', 15000, -8, [['approve', 'admin', 'อนุมัติ ขอรูปก่อน-หลังด้วย']]);
  await req('store', PR, 'ซื้อรถยกลากพาเลท (Hand pallet) 2 คัน', 'คันเดิมล้อแตก ใช้งานไม่ได้ 1 คัน', 19800, -6,
    [['approve', 'buyer'], ['return', 'admin', 'ขอใบเสนอราคาเปรียบเทียบ 3 เจ้า และรุ่นที่รับน้ำหนัก 3 ตัน']]);
  await req('store', TRAVEL, 'ไปรับวัตถุดิบด่วนที่บางปู', 'สแตนเลสขาด รอส่งไม่ทัน', 800, -5, [], { cancel: 'ผู้ขายจัดส่งให้เองแล้ว' });
  await req('plan', BUDGET, 'ค่าล่วงเวลา (OT) เร่งออเดอร์คูลแอร์ เดือนนี้', 'ออเดอร์ BRK-100 เพิ่ม 1,100 ชิ้น ต้องเปิด OT ไลน์ปั๊ม 2 กะ 10 วัน', 64000, 2, [['approve', 'acc', 'งบ OT เดือนนี้ยังเหลือ 72,000']]);
  await req('tech', PR, 'จ้างผู้รับเหมาซ่อมหลังคารั่ว อาคารผลิต 2', 'ฝนตกน้ำหยดใส่ตู้คอนโทรล PRESS-03 ต้องซ่อมก่อนหน้าฝนหนัก', 36000, 4, [['approve', 'buyer', 'ได้ราคาจาก 2 เจ้า เลือกเจ้าที่รับประกัน 2 ปี']]);
  await req('sales', TRAVEL, 'ออกบูธงาน Manufacturing Expo 2026 ไบเทค บางนา', 'ค่าบูธ 9 ตร.ม. ค่าตกแต่ง ป้าย และเบี้ยเลี้ยงทีมขาย 3 คน 4 วัน', 45000, 8, []);
  await req('hr', MEMO, 'ขออนุมัติจัดอบรมความปลอดภัยในการทำงาน (จป.) ให้หัวหน้างาน', 'ตามกฎหมายความปลอดภัยฯ หัวหน้างานใหม่ 4 คน ต้องอบรมภายใน 120 วัน', 12500, 12, []);
  await req('qc', PR, 'ซื้อไมโครมิเตอร์ดิจิตอล 2 ตัว', 'สำหรับจุดตรวจรับวัตถุดิบ และไลน์ปั๊ม', 12400, 6, []);
  await req('it', MEMO, 'ขอติดตั้งกล้องวงจรปิดเพิ่มที่คลังสินค้า', 'มุมอับหลังชั้นวางวัตถุดิบ 2 จุด', 9800, null, [], { draft: true });

  // the MD travels next week: his approvals go to the chief accountant (Mon–Fri), so nothing waits for him
  const nextMonday = addDays(bkkDate(), 7 - ((weekday(bkkDate()) + 6) % 7));
  await call('POST', '/api/approvals/delegations', {
    toUserId: u.acc.id, toUserName: u.acc.name, startsOn: nextMonday, endsOn: addDays(nextMonday, 4),
    note: 'เดินทางไปดูงานเครื่องปั๊มที่ญี่ปุ่น — ระหว่างนี้คุณสุดารัตน์อนุมัติแทนทุกเรื่อง',
  });
}

/* ------------------------------------------------------------------ expense ------------------------------------------------------------------ */

async function seedExpense(x: Ctx) {
  const { call, users: u, as, dept } = x;
  const cat: Record<string, string> = {};
  await Promise.all(([
    ['FUEL', 'ค่าน้ำมันรถ', 3000, true, 'แนบใบกำกับภาษีจากปั๊ม ระบุทะเบียนรถ'], ['TOLL', 'ค่าทางด่วน/ที่จอดรถ', 1000, false, ''],
    ['TRAVEL', 'ค่าเดินทาง (แท็กซี่/รถสาธารณะ)', 1500, false, ''], ['PERDIEM', 'เบี้ยเลี้ยงเดินทาง', 2000, false, 'วันละ 240 บาท'],
    ['HOTEL', 'ค่าที่พัก', 2500, true, 'ไม่เกินคืนละ 1,200 บาท'], ['ENTERTAIN', 'ค่ารับรองลูกค้า', 5000, true, 'ต้องได้รับอนุมัติจากผู้จัดการก่อน'],
    ['PARTS', 'อะไหล่/วัสดุซ่อมด่วน', null, true, 'ซื้อหน้าร้านกรณีเร่งด่วนเท่านั้น'], ['OFFICE', 'วัสดุสำนักงาน', 2000, true, ''],
    ['PARCEL', 'ค่าไปรษณีย์/ขนส่งเอกสาร', null, false, ''], ['OTMEAL', 'ค่าอาหารทำงานล่วงเวลา', 3000, false, 'คนละ 60 บาทต่อมื้อ'],
  ] as const).map(async ([code, name, monthlyLimit, requiresReceipt, note]) => {
    cat[code] = (await call('POST', '/api/expense/categories', { code, name, monthlyLimit, requiresReceipt, note: note || undefined })).id;
  }));
  /** C3: the seller of a line with VAT — a full tax invoice with the seller's tax ID lets the VAT be claimed (else it is part of the expense) */
  type Seller = { name: string; taxId?: string; branch?: string; type?: 'full_tax_invoice' | 'abbreviated' | 'none' };
  type L = [number, string, string, number, number?, string?, Seller?];
  const claim = async (who: string, purpose: string, daysAgo: number, lines: L[], end: 'draft' | 'submitted' | 'approved' | 'paid' | 'rejected' | 'returned', note?: string, paidDaysAgo = Math.max(daysAgo - 5, 0)) => {
    const c = await as[who]('POST', '/api/expense/claims', {
      purpose, claimantName: u[who].name, department: dept[who], claimDate: dayBack(daysAgo), submit: end !== 'draft',
      lines: lines.map(([back, code, description, amount, vat, receiptNo, seller]) => ({
        expenseDate: dayBack(back), categoryId: cat[code], description, amount, vat: vat ?? 0, receiptNo,
        ...(seller ? { vendorName: seller.name, vendorTaxId: seller.taxId, vendorBranch: seller.branch, receiptType: seller.type ?? 'full_tax_invoice' } : {}),
      })),
    });
    if (end === 'approved' || end === 'paid') await call('POST', `/api/expense/claims/${c.id}/approve`, {});
    // segregation of duties (wave 8): the MD approves, accounting records the payment
    if (end === 'paid') await as.acc('POST', `/api/expense/claims/${c.id}/pay`, { method: 'transfer', paidDate: dayBack(paidDaysAgo), reference: `KBANK-${String(c.no).slice(-4)}` });
    if (end === 'rejected' || end === 'returned') await call('POST', `/api/expense/claims/${c.id}/${end === 'rejected' ? 'reject' : 'return'}`, { note });
    return c;
  };
  await claim('sales', 'เยี่ยมลูกค้า คูลแอร์ แมนูแฟคเจอริ่ง อมตะนคร', 52, [[53, 'FUEL', 'เติมน้ำมันรถกระบะ 3ฒก 8173', 1200, 0, 'PTT-558812'], [53, 'TOLL', 'ทางด่วนบูรพาวิถี ไป-กลับ', 180]], 'paid');
  await claim('tech', 'ซื้ออะไหล่ด่วน ซ่อม PRESS-02 (ซื้อหน้าร้าน)', 46, [[47, 'PARTS', 'โอริง + ข้อต่อไฮดรอลิก 3/8"', 2450, 171.5, 'INV-6602', { name: 'หจก. ช่างไทยอะไหล่', taxId: '0103556012340', branch: '00000' }]], 'paid');
  await claim('buyer', 'ตรวจโรงงานผู้ขายรายใหม่ นิคมบางปู', 39, [[40, 'FUEL', 'น้ำมันรถส่วนตัว 62 กม.', 650, 0, 'BCP-10288'], [40, 'PERDIEM', 'เบี้ยเลี้ยง 1 วัน', 240]], 'paid');
  await claim('qc', 'ส่งชิ้นงานตัวอย่างทดสอบ Salt spray ที่แล็บภายนอก', 31, [[32, 'PARCEL', 'Kerry ส่งชิ้นงาน 5 ชิ้น', 350], [32, 'TRAVEL', 'แท็กซี่ไปรับผลทดสอบ', 420]], 'paid', undefined, 0);
  await claim('sales', 'รับรองลูกค้า อีสเทิร์น อิเล็คทริค (ฝ่ายจัดซื้อ 4 ท่าน)', 21, [[22, 'ENTERTAIN', 'อาหารกลางวัน ร้านครัวบ้านสวน', 4800, 336, 'RC-22871', { name: 'ร้านครัวบ้านสวน', taxId: '0205560004543', branch: '00000' }]], 'approved');
  await claim('it', 'ซื้อสาย LAN และหัว RJ45 ด่วน (ห้องประชุมใหญ่)', 16, [[16, 'OFFICE', 'สาย CAT6 1 กล่อง + หัว RJ45', 890, 62.3, 'IT-CITY-4410', { name: 'บริษัท ไอที ซิตี้ จำกัด (มหาชน)', taxId: '0107537000165', branch: '00021' }]], 'approved');
  await claim('tech', 'ค่าแท็กซี่ไปซื้ออะไหล่ วงศ์สว่าง', 13, [[13, 'TRAVEL', 'แท็กซี่ไป-กลับ', 380]], 'rejected', 'ใช้รถกระบะบริษัทได้ ไม่ต้องนั่งแท็กซี่ครับ');
  await claim('store', 'ค่าน้ำมันและทางด่วน ไปรับวัตถุดิบ บางนา', 10, [[10, 'FUEL', 'น้ำมันรถกระบะ', 900, 0, 'SHELL-77120'], [10, 'TOLL', 'ทางด่วนบางนา-ชลบุรี', 120]], 'submitted');
  await claim('qc', 'ค่าน้ำมันไปตรวจรับวัตถุดิบที่ผู้ขาย', 8, [[9, 'FUEL', 'ไป สยามเหล็กกล้า บางปู', 700, 0, 'PTT-60331']], 'returned', 'ระบุเลขไมล์ไป-กลับในรายละเอียดด้วย');
  const expo = await claim('sales', 'ค่าใช้จ่ายออกบูธงาน Manufacturing Expo (ช่วงเตรียมงาน)', 6, [
    [7, 'HOTEL', 'โรงแรมใกล้ไบเทค 2 คืน', 2800, 0, 'HT-11902'], [7, 'PERDIEM', 'เบี้ยเลี้ยง 2 วัน', 480], [7, 'FUEL', 'ขนของไปบูธ', 1500, 0, 'PTT-61107'],
  ], 'approved');
  await claim('plan', 'ค่าอาหาร OT ทีมผลิตเร่งงานคูลแอร์', 4, [[5, 'OTMEAL', 'ข้าวกล่อง 15 คน x 1 มื้อ', 900], [4, 'OTMEAL', 'ข้าวกล่อง 15 คน (ต่อ)', 450]], 'submitted');
  await claim('sales', 'รับรองลูกค้า คูลแอร์ หลังประชุมสรุปราคาสัญญาปี 2570', 3, [[3, 'ENTERTAIN', 'อาหารเย็น ทีมจัดซื้อและวิศวกรรม 6 ท่าน', 5200, 364, 'RC-23015', { name: 'ภัตตาคารริมน้ำ ชลบุรี', taxId: '0205561008879', branch: '00000' }]], 'submitted');
  await claim('acc', 'ค่าไปรษณีย์ส่งเอกสารภาษีและใบวางบิล', 2, [[2, 'PARCEL', 'EMS 6 ฉบับ', 210]], 'draft');
  await claim('it', 'ค่าวัสดุสำนักงาน หมึกพิมพ์สำรอง', 1, [[1, 'OFFICE', 'หมึก Brother TN-2460 x 2', 1780, 124.6, 'OFM-9921', { name: 'บริษัท ออฟฟิศเมท (ไทย) จำกัด', type: 'abbreviated' }]], 'submitted');

  // cash advances: the expo advance is paid and cleared against the expo claim; a new one waits for approval
  const adv = await as.sales('POST', '/api/expense/advances', { purpose: 'เงินทดรองออกบูธงาน Manufacturing Expo 2026', amount: 6000, neededBy: dayBack(8), requesterName: u.sales.name, department: dept.sales });
  await call('POST', `/api/expense/advances/${adv.id}/approve`, {});
  await as.acc('POST', `/api/expense/advances/${adv.id}/pay`, { method: 'cash', paidDate: dayBack(8) });
  await as.acc('POST', `/api/expense/advances/${adv.id}/clear`, { claimId: expo.id });
  // the advance (6,000) was more than the claim: the salesman paid the difference back in cash, which settles the claim
  await as.acc('POST', `/api/expense/claims/${expo.id}/pay`, { method: 'cash', paidDate: dayBack(5), reference: 'รับคืนเงินทดรองส่วนเกินเป็นเงินสด' });
  await as.tech('POST', '/api/expense/advances', { purpose: 'เงินทดรองซื้ออะไหล่ซ่อมเครื่องปั๊ม PRESS-02', amount: 5000, neededBy: wd(1), requesterName: u.tech.name, department: dept.tech });
}

/* ------------------------------------------------------------------ booking ------------------------------------------------------------------ */

async function seedBooking(x: Ctx) {
  const { call, users: u, as, dept } = x;
  const res: Record<string, string> = {};
  await Promise.all(([
    { code: 'MR-1', name: 'ห้องประชุมใหญ่', kind: 'room', capacity: 20, location: 'อาคารสำนักงาน ชั้น 2', color: '#2563eb', note: 'จอทีวี 75 นิ้ว ระบบประชุมออนไลน์' },
    { code: 'MR-2', name: 'ห้องประชุมเล็ก', kind: 'room', capacity: 8, location: 'อาคารสำนักงาน ชั้น 2', color: '#0891b2' },
    { code: 'MR-3', name: 'ห้องรับรองลูกค้า', kind: 'room', capacity: 6, location: 'อาคารสำนักงาน ชั้น 1', color: '#7c3aed', note: 'ใช้ต้อนรับลูกค้า/ผู้ตรวจประเมิน' },
    { code: 'VAN-01', name: 'รถตู้ Toyota Commuter', kind: 'vehicle', capacity: 12, plateNo: 'นข 4521 สมุทรปราการ', location: 'ลานจอดรถหน้าโรงงาน', requiresApproval: true, color: '#ea580c' },
    { code: 'PICKUP-01', name: 'รถกระบะ Isuzu D-Max', kind: 'vehicle', capacity: 2, plateNo: '3ฒก 8173 กรุงเทพมหานคร', location: 'ลานจอดรถหน้าโรงงาน', requiresApproval: true, color: '#16a34a' },
    { code: 'PJ-01', name: 'โปรเจคเตอร์ Epson EB-X51', kind: 'equipment', location: 'ตู้ฝ่ายไอที', color: '#64748b' },
  ] as const).map(async (r) => { res[r.code] = (await call('POST', '/api/booking/resources', r)).id; }));

  const book = async (who: string, code: string, purpose: string, date: string, startTime: string, endTime: string, extra: Record<string, unknown> = {}) =>
    as[who]('POST', '/api/booking/bookings', {
      resourceId: res[code], purpose, date, startTime, endTime, requesterName: u[who].name, requesterDepartment: dept[who], ...extra,
    });
  // completed vehicle trips (odometer continues trip after trip)
  let van = 84210;
  let pickup = 152880;
  const trips: [string, number, string, string, number, number, number][] = [
    ['VAN-01', -14, 'ส่งตัวอย่างขายึดให้ คูลแอร์ อมตะนคร', 'อมตะนคร ชลบุรี', 0, 118, 1450],
    ['PICKUP-01', -12, 'รับสแตนเลสด่วน ไทยสแตนเลส ซัพพลาย', 'บางนา กรุงเทพฯ', 1, 46, 620],
    ['PICKUP-01', -9, 'เยี่ยมลูกค้า อีสเทิร์น อิเล็คทริค', 'ปลวกแดง ระยอง', 2, 236, 1980],
    ['VAN-01', -7, 'พาทีม QC ไปตรวจโรงงานผู้ขาย', 'นิคมบางปู สมุทรปราการ', 3, 38, 0],
    ['PICKUP-01', -1, 'ส่งชั้นวาง RACK-08 ให้โฮมสโตร์ เรนเจอร์', 'ลาดกระบัง กรุงเทพฯ', 4, 64, 850],
    ['VAN-01', -2, 'รับ-ส่งผู้ตรวจประเมิน ISO จากสนามบิน', 'สุวรรณภูมิ', 5, 72, 900],
  ];
  trips.sort((a, b) => a[1] - b[1]);
  const drivers = ['sales', 'store', 'sales', 'qc', 'store', 'hr'];
  for (const [code, off, purpose, destination, n, km, fuel] of trips) {
    const who = drivers[n];
    const b = await book(who, code, purpose, wd(off), '08:30', '15:30', { destination, attendees: code === 'VAN-01' ? 5 : 2 });
    await call('POST', `/api/booking/bookings/${b.id}/approve`, { note: 'ใช้รถได้ ตรวจลมยางก่อนออก' });
    const start = code === 'VAN-01' ? van : pickup;
    await as[who]('POST', `/api/booking/bookings/${b.id}/complete`, { mileageStart: start, mileageEnd: start + km, fuelCost: fuel || undefined, note: fuel ? 'เติมน้ำมันเต็มถัง' : undefined });
    if (code === 'VAN-01') van = start + km; else pickup = start + km;
  }
  const mr = await book('admin', 'MR-1', 'ประชุมทบทวนฝ่ายบริหาร (Management Review)', wd(-3), '13:30', '16:00', { attendees: 12 });
  await call('POST', `/api/booking/bookings/${mr.id}/complete`, { note: 'สรุปรายงานการประชุมส่ง QMR แล้ว' });

  // today and this week
  const today = wd(0);
  await book('plan', 'MR-1', 'ประชุมวางแผนการผลิตประจำสัปดาห์', today, '09:00', '10:30', { attendees: 10 });
  await book('sales', 'MR-3', 'ต้อนรับลูกค้า โฮมสโตร์ เรนเจอร์ เยี่ยมชมโรงงาน', today, '10:00', '11:30', { attendees: 5 });
  await book('sales', 'PJ-01', 'นำเสนอ Company profile ให้ลูกค้า', today, '10:00', '11:30');
  await book('hr', 'MR-2', 'สัมภาษณ์งานพนักงานฝ่ายผลิต 3 ตำแหน่ง', today, '13:30', '15:00', { attendees: 3 });
  const bill = await book('acc', 'VAN-01', 'วางบิลและรับเช็คลูกค้า ชลบุรี-ระยอง', today, '13:00', '17:00', { destination: 'อมตะนคร / ปลวกแดง', attendees: 2 });
  await call('POST', `/api/booking/bookings/${bill.id}/approve`, {});
  await book('qc', 'MR-1', 'อบรม ISO 9001:2015 สำหรับหัวหน้างาน', wd(1), '08:30', '16:30', { attendees: 18 });
  await book('qc', 'PJ-01', 'อบรม ISO 9001:2015 (ใช้ในห้องประชุมใหญ่)', wd(1), '08:30', '16:30');
  await book('store', 'PICKUP-01', 'ไปรับวัตถุดิบด่วนที่ ไทยสแตนเลส ซัพพลาย', wd(1), '09:00', '12:00', { destination: 'บางนา กรุงเทพฯ', attendees: 2 }); // waits for approval
  await book('qc', 'MR-2', 'ประชุม QC ประจำเดือน ทบทวน NCR', wd(2), '10:00', '11:00', { attendees: 6 });
  const party = await book('tech', 'VAN-01', 'ไปงานแต่งเพื่อนร่วมงาน ต่างจังหวัด', wd(2), '06:00', '20:00', { destination: 'นครราชสีมา', attendees: 10 });
  await call('POST', `/api/booking/bookings/${party.id}/reject`, { note: 'รถตู้ใช้เฉพาะงานบริษัท — ขอให้ใช้รถส่วนตัว' });
  const checkup = await book('hr', 'VAN-01', 'รับ-ส่งพนักงานไปตรวจสุขภาพประจำปี', wd(3), '07:30', '12:00', { destination: 'โรงพยาบาลสมุทรปราการ', attendees: 12 });
  await call('POST', `/api/booking/bookings/${checkup.id}/approve`, {});
  const visit = await book('sales', 'MR-3', 'ลูกค้า อมตะ ออโต้พาร์ท เยี่ยมชมโรงงาน', wd(4), '14:00', '15:30', { attendees: 4 });
  await as.sales('POST', `/api/booking/bookings/${visit.id}/cancel`, { reason: 'ลูกค้าขอเลื่อนนัดเป็นสัปดาห์หน้า' });
  await book('plan', 'MR-2', 'ประชุมโครงการไลน์ปั๊มใหม่ PRESS-04', wd(4), '09:00', '10:00', { attendees: 6 });
}

/* ------------------------------------------------------------------ crm ------------------------------------------------------------------ */

async function seedCrm(x: Ctx) {
  const { users: u, as, items, partners } = x;
  const s = as.sales;
  const owner = { ownerId: u.sales.id, ownerName: u.sales.name };
  const at = (n: number, time = '10:00') => iso(n <= 0 ? wd(n) : wd(n), time);
  type LeadEnd = 'new' | 'contacted' | 'qualified' | 'lost' | 'converted';
  const leads: Record<string, any> = {};
  const L: [string, string, string, string, string, string, LeadEnd, string?][] = [
    ['L1', 'บริษัท ไทยโฮม แอพพลายแอนซ์ จำกัด', 'คุณวรวุฒิ (จัดซื้อ)', '02-118-4400', 'website', 'ขายึดคอมเพรสเซอร์แอร์ 5,000 ชิ้น/เดือน', 'converted'],
    ['L2', 'บริษัท สยามโซลาร์ เมาท์ติ้ง จำกัด', 'คุณศศิธร', '081-662-0910', 'expo', 'ขายึดแผงโซลาร์เซลล์ สแตนเลส', 'converted'],
    ['L3', 'หจก. รุ่งเรืองตู้ไฟฟ้า', 'คุณบุญชัย', '089-441-2287', 'line', 'กล่องตู้ควบคุมพ่นสี 200 ตู้/ไตรมาส', 'qualified'],
    ['L4', 'บริษัท อมตะ ออโต้พาร์ท จำกัด', 'คุณเกียรติศักดิ์ (Sourcing)', '038-457-120', 'referral', 'งานปั๊มชิ้นส่วนยานยนต์ OEM', 'converted'],
    ['L5', 'บริษัท บางนา สโตร์ฟิกซ์เจอร์ จำกัด', 'คุณนันทนา', '02-399-7713', 'phone', 'ชั้นวางสินค้าเหล็ก 150 ชุด', 'contacted'],
    ['L6', 'บริษัท อีสเทิร์นซีบอร์ด คอนโทรล จำกัด', 'คุณภาณุ', '038-110-552', 'website', 'ตู้ควบคุมสแตนเลสกันน้ำ IP65', 'converted'],
    ['L7', 'บริษัท เอเชีย เฟอร์นิเจอร์ เมทัล จำกัด', 'คุณมาลี', '02-701-3349', 'expo', 'ขาโต๊ะเหล็กพ่นสี 3,000 ชุด', 'lost', 'ราคาสูงกว่าผู้ผลิตรายเดิมของลูกค้าประมาณ 12%'],
    ['L8', 'ร้าน ช.ช่างเหล็ก', 'คุณชาญ', '086-220-1185', 'line', 'ตัดเลเซอร์แผ่นเหล็ก งานจร', 'lost', 'งานจำนวนน้อย ไม่คุ้มตั้งเครื่อง'],
    ['L9', 'บริษัท กรีนเทค อินดัสทรี จำกัด', 'คุณปรีชา', '02-055-8840', 'website', 'ฝาครอบเครื่องจักร (Machine guard)', 'new'],
    ['L10', 'บริษัท ชลบุรี คูลลิ่ง ซิสเต็ม จำกัด', 'คุณอัญชลี', '038-284-660', 'referral', 'ขายึดคอยล์ร้อนแอร์', 'new'],
    ['L11', 'บริษัท พีเค อิเล็คทริคัล เอ็นจิเนียริ่ง จำกัด', 'คุณพงศกร', '081-338-4521', 'phone', 'กล่องไฟ Pull box ชุบซิงค์', 'contacted'],
    ['L12', 'บริษัท ไทยแลนด์ แร็คกิ้ง โซลูชั่น จำกัด', 'คุณธีรวัฒน์', '02-462-1190', 'expo', 'ชิ้นส่วนชั้นวางพาเลท (Selective rack)', 'qualified'],
    ['L13', 'บริษัท มิตรภาพ แอร์ พาร์ท จำกัด', 'คุณสุนทร', '044-213-554', 'website', 'ขายึดแอร์ OEM ติดแบรนด์ลูกค้า', 'new'],
    ['L14', 'บริษัท สมุทรปราการ ฮาร์ดแวร์ จำกัด', 'คุณวัชระ', '02-387-6610', 'other', 'ฉากเหล็กชุบซิงค์ ขายหน้าร้าน', 'contacted'],
    ['L15', 'บริษัท โปรเฟค แมชชีนเนอรี่ จำกัด', 'คุณอภิชาติ', '089-990-1235', 'referral', 'งานพับและเชื่อมโครงเครื่องจักร', 'new'],
  ];
  for (const [key, company, contactName, phone, source, interest, end, reason] of L) {
    const l = await s('POST', '/api/crm/leads', { company, contactName, phone, source, interest, ...owner });
    leads[key] = l;
    if (end === 'contacted' || end === 'qualified') await s('POST', `/api/crm/leads/${l.id}/contact`);
    if (end === 'qualified') await s('POST', `/api/crm/leads/${l.id}/qualify`);
    if (end === 'lost') await s('POST', `/api/crm/leads/${l.id}/lose`, { reason });
  }
  const convert = (key: string, value: number, closeIn: number) =>
    s('POST', `/api/crm/leads/${leads[key].id}/convert`, { value, expectedClose: wd(closeIn) });
  const opp = (name: string, code: string, value: number, closeIn: number, note?: string) =>
    s('POST', '/api/crm/opportunities', { name, partnerId: partners[code].id, customerName: partners[code].name, value, expectedClose: wd(closeIn), note, ...owner });
  const oThaiHome = await convert('L1', 864000, 25);
  const oSolar = await convert('L2', 520000, 18);
  const oAmata = await convert('L4', 1250000, 45);
  const oEastSea = await convert('L6', 380000, 5);
  const oCoolAir = await opp('ขายึด BRK-100 สัญญาปี 2570', 'C-001', 2016000, 15, 'ลูกค้าต้องการล็อกราคา 12 เดือน ปริมาณ 3,500 ชิ้น/เดือน');
  const oEastern = await opp('กล่องตู้ควบคุม CASE-01 ล็อตไตรมาส 4', 'C-002', 310500, 3);
  const oHome = await opp('ชั้นวาง RACK-08 สาขาใหม่ 3 สาขา', 'C-003', 217500, 20);
  const oSteel = await opp('ขายึดสแตนเลส BRK-200 รุ่นส่งออก', 'C-001', 405000, 35);
  const oOnline = await opp('ชั้นวางเหล็กคลังสินค้าออนไลน์', 'C-003', 145000, -5);
  await s('POST', `/api/crm/opportunities/${oThaiHome.id}/advance`);
  await s('POST', `/api/crm/opportunities/${oThaiHome.id}/advance`);
  await s('POST', `/api/crm/opportunities/${oEastSea.id}/advance`);
  await s('POST', `/api/crm/opportunities/${oEastSea.id}/win`);

  const quote = (code: string, oppId: string | null, lines: [string, number, number, number?][], note?: string) => s('POST', '/api/crm/quotations', {
    partnerId: partners[code].id, customerName: partners[code].name, customerAddress: partners[code].address, opportunityId: oppId, note,
    lines: lines.map(([c, qty, unitPrice, discountPct]) => ({ ...items[c], qty, unitPrice, discountPct: discountPct ?? 0 })),
  });
  const q1 = await quote('C-002', oEastern.id, [['FG-CASE-01', 450, 690]], 'ส่งมอบ 3 งวด งวดละ 150 ตู้');
  await s('POST', `/api/crm/quotations/${q1.id}/send`);
  await s('POST', `/api/crm/quotations/${q1.id}/accept`);
  const q2 = await quote('C-001', oCoolAir.id, [['FG-BRK-100', 42000, 48, 2]], 'ราคายืนยัน 12 เดือน ปรับตามราคาเหล็กเกิน ±8%');
  await s('POST', `/api/crm/quotations/${q2.id}/send`);
  await s('POST', `/api/crm/opportunities/${oCoolAir.id}/advance`);
  const q3 = await quote('C-003', oHome.id, [['FG-RACK-08', 150, 1450, 3]]);
  await s('POST', `/api/crm/quotations/${q3.id}/send`);
  await quote('C-001', oSteel.id, [['FG-BRK-200', 3000, 135]], 'รอราคาสแตนเลสล่าสุดจากจัดซื้อ');
  await quote('C-002', null, [['FG-CASE-01', 60, 690], ['FG-BRK-200', 200, 135, 5]]);
  const q6 = await quote('C-003', oOnline.id, [['FG-RACK-08', 100, 1450]]);
  await s('POST', `/api/crm/quotations/${q6.id}/send`);
  await s('POST', `/api/crm/quotations/${q6.id}/reject`, { reason: 'ลูกค้าเลือกชั้นวางนำเข้าราคาถูกกว่า' });
  await s('POST', `/api/crm/opportunities/${oOnline.id}/lose`, { reason: 'ลูกค้าเลือกใช้ชั้นวางนำเข้าจากจีน' });

  // follow-ups: some done, some due soon, some overdue (shows in the red KPI)
  const act = (type: string, subject: string, dueAt: string, link: { leadId?: string; opportunityId?: string }, done = false, note?: string) =>
    s('POST', '/api/crm/activities', { type, subject, dueAt, done, note, ...link, ...owner });
  await Promise.all([
    act('call', 'โทรติดตามแบบตู้และสเปกสีฝุ่น', at(-2), { leadId: leads.L3.id }),
    act('email', 'ส่งแบบ 3D ชั้นวางให้ลูกค้าพิจารณา', at(-3, '15:00'), { opportunityId: oHome.id }),
    act('task', 'ทำตัวอย่างขายึดโซลาร์ 5 ชิ้นส่งทดสอบ', at(-1, '17:00'), { opportunityId: oSolar.id }),
    act('visit', 'แวะร้าน แนะนำฉากเหล็กชุบซิงค์ พร้อมตัวอย่าง', at(-4, '14:00'), { leadId: leads.L14.id }),
    act('visit', 'เยี่ยมโรงงานลูกค้า ดูไลน์ประกอบแอร์', at(-8), { opportunityId: oCoolAir.id }, true, 'ลูกค้าพอใจคุณภาพ อยากได้ราคาล็อกทั้งปี'),
    act('call', 'โทรสรุปปริมาณต่อเดือน', at(-6, '11:00'), { opportunityId: oThaiHome.id }, true, 'ยืนยัน 5,000 ชิ้น/เดือน เริ่มเดือนหน้า'),
    act('email', 'ส่งแคตตาล็อกสินค้าและ Company profile', at(-3), { leadId: leads.L9.id }, true),
    act('call', 'โทรนัดเข้าพบฝ่ายจัดซื้อ', iso(wd(0), '15:30'), { leadId: leads.L5.id }),
    act('meeting', 'ประชุมสรุปราคาสัญญาปี 2570 กับฝ่ายจัดซื้อคูลแอร์', at(1, '13:30'), { opportunityId: oCoolAir.id }),
    act('visit', 'สำรวจหน้างานคลังสินค้า วัดขนาดชั้นวาง', at(3, '09:30'), { leadId: leads.L12.id }),
    act('meeting', 'นำเสนอความสามารถโรงงานให้ทีม Sourcing อมตะ ออโต้พาร์ท', at(5, '14:00'), { opportunityId: oAmata.id }),
    act('task', 'ขอราคาสแตนเลส SUS304 ล่าสุดจากจัดซื้อ', at(2, '16:00'), { opportunityId: oSteel.id }),
  ]);
}

/* ------------------------------------------------------------------ helpdesk ------------------------------------------------------------------ */

async function seedHelpdesk(x: Ctx) {
  const { call, users: u, as, partners } = x;
  // SLA clock = business hours (Mon–Fri 08:00–17:00, Thai holidays off); urgent tickets run 24x7
  await Promise.all([
    call('PUT', '/api/helpdesk/settings/sla', { businessHours: true, workDays: [1, 2, 3, 4, 5], workStart: '08:00', workEnd: '17:00', urgent24x7: true, timezone: 'Asia/Bangkok' }),
    ...HOLIDAYS.map(([date, name]) => call('POST', '/api/helpdesk/holidays', { date, name })),
  ]);
  const cats: Record<string, any> = {};
  for (const [code, name, slaResponseHours, slaResolveHours, who] of [
    ['IT', 'IT', 2, 8, 'it'], ['FAC', 'อาคารสถานที่', 4, 48, 'tech'], ['AFTER', 'บริการหลังการขาย', 4, 72, 'qc'],
  ] as const) {
    const body = { code, name, slaResponseHours, slaResolveHours, defaultAssigneeId: u[who].id, defaultAssigneeName: u[who].name };
    cats[code] = { ...(await call('POST', '/api/helpdesk/categories', body)), body };
  }
  await Promise.all([
    ['รับเรื่องแล้ว', 'รับเรื่องแล้วครับ/ค่ะ กำลังตรวจสอบ จะแจ้งความคืบหน้าภายใน 2 ชั่วโมง', null],
    ['รออะไหล่', 'ต้องสั่งอะไหล่ คาดว่าจะได้ภายใน 3–5 วันทำการ ระหว่างนี้ขอใช้เครื่องสำรองไปก่อน', null],
    ['ขอข้อมูลเพิ่ม (IT)', 'รบกวนส่งภาพหน้าจอข้อความ error และชื่อเครื่อง (ดูที่สติกเกอร์หน้าเครื่อง) มาทางไลน์ IT ด้วยครับ', 'IT'],
    ['ขอบคุณลูกค้า', 'ขอบคุณที่แจ้งเรื่องเข้ามา ทางบริษัทได้ออก NCR และดำเนินการแก้ไขแล้ว จะเรียนแจ้งผลภายใน 3 วันทำการ', 'AFTER'],
  ].map(([title, body, cat]) => call('POST', '/api/helpdesk/canned-replies', { title, body, categoryId: cat ? cats[cat as string].id : null })));
  await Promise.all([
    ['วิธีเชื่อมต่อ Wi-Fi พนักงาน (SPM-Staff)', 'IT', '1. เลือกเครือข่าย SPM-Staff\n2. ใส่รหัสพนักงาน (EMP-xxx) และรหัสผ่าน ERP\n3. ยอมรับใบรับรอง\nหากเชื่อมต่อไม่ได้ แจ้งปัญหาหมวด IT', true],
    ['แก้ปัญหาเครื่องพิมพ์ไม่พิมพ์ / งานค้างในคิว', 'IT', '1. ตรวจว่ากระดาษไม่ติดและไฟเครื่องเป็นสีเขียว\n2. เปิด Devices and Printers > ดูงานที่ค้าง > Cancel all\n3. ปิด-เปิดเครื่องพิมพ์\n4. ยังไม่ได้ แจ้ง IT พร้อมชื่อเครื่องพิมพ์', true],
    ['ขั้นตอนขอสิทธิ์ใช้งานระบบ ERP', 'IT', 'หัวหน้าแผนกส่งคำขอผ่านระบบอนุมัติ (บันทึกข้อความภายใน) ระบุชื่อ ตำแหน่ง และเมนูที่ต้องใช้ IT ดำเนินการภายใน 1 วันทำการ', true],
    ['วิธีประกอบชั้นวาง RACK-08', 'AFTER', 'อุปกรณ์: ประแจเบอร์ 10 และค้อนยาง\n1. ประกอบเสา 4 ต้นเข้ากับคานล่าง\n2. วางแผ่นชั้นแล้วล็อกพุก\n3. รับน้ำหนักชั้นละไม่เกิน 150 กก.\nดูวิดีโอได้ที่ QR บนกล่อง', true],
    ['การแจ้งซ่อมอาคารและเวลาให้บริการ', 'FAC', 'แจ้งผ่านระบบหมวด "อาคารสถานที่" ทีมช่างให้บริการ จ.–ศ. 08:00–17:00 น. เรื่องเร่งด่วน (ไฟดับ น้ำรั่วใส่เครื่องจักร) โทร 1102', false],
  ].map(([title, cat, body, published]) => as.it('POST', '/api/helpdesk/articles', { title, body, categoryId: cats[cat as string].id, published })));

  /** `reportedAt`: the technician keys in a phone call from earlier (the SLA counts from then — this is how the demo has overdue tickets) */
  type Flow = { start?: boolean; wait?: string; comments?: [string, string, boolean?][]; resolve?: string; close?: [number, string?]; reportedAt?: string };
  type Extra = { description?: string; requesterName?: string; requesterContact?: string; customerId?: string; customerCode?: string; customerName?: string; assetRef?: string };
  const tech = (cat: string) => (cat === 'IT' ? 'it' : cat === 'FAC' ? 'tech' : 'qc');
  const ticket = async (who: string, cat: string, title: string, priority: string, channel: string, f: Flow, extra: Extra = {}) => {
    const body = { title, categoryId: cats[cat].id, priority, channel, ...extra };
    const t = f.reportedAt
      ? await as[tech(cat)]('POST', '/api/helpdesk/tickets', { ...body, requesterName: extra.requesterName ?? u[who].name, reportedAt: f.reportedAt })
      : await as[who]('POST', '/api/helpdesk/tickets', body);
    const w = as[tech(cat)];
    if (f.start) await w('POST', `/api/helpdesk/tickets/${t.id}/start`);
    for (const [by, body, internal] of f.comments ?? []) await as[by]('POST', `/api/helpdesk/tickets/${t.id}/comments`, { body, internal: !!internal });
    if (f.wait) await w('POST', `/api/helpdesk/tickets/${t.id}/wait`, { reason: f.wait });
    if (f.resolve) await w('POST', `/api/helpdesk/tickets/${t.id}/resolve`, { resolution: f.resolve });
    if (f.close) await as[who]('POST', `/api/helpdesk/tickets/${t.id}/close`, { satisfaction: f.close[0], feedback: f.close[1] });
  };
  // after-sales tickets are linked to the customer record (wave 4), so the customer's history is one search away
  const cust = (code: string, name: string, contact: string, description: string, assetRef?: string): Extra => ({
    requesterName: name, requesterContact: contact, description: description || undefined, assetRef,
    customerId: partners[code]?.id, customerCode: code, customerName: partners[code]?.name,
  });
  await ticket('acc', 'IT', 'เครื่องพิมพ์ฝ่ายบัญชีพิมพ์ไม่ออก', 'high', 'phone', { start: true, resolve: 'ล้างคิวงานพิมพ์และอัปเดตไดรเวอร์ Brother', close: [5, 'แก้ไวมากค่ะ ทันปิดงบ'] });
  await ticket('buyer', 'IT', 'ลืมรหัสผ่านอีเมลบริษัท', 'normal', 'walk_in', { start: true, resolve: 'รีเซ็ตรหัสผ่านและเปิด 2FA ให้แล้ว', close: [4] });
  await ticket('store', 'FAC', 'ก๊อกน้ำห้องน้ำชาย อาคารผลิต รั่ว', 'low', 'web', { start: true, resolve: 'เปลี่ยนวาล์วก๊อกน้ำใหม่ 2 จุด', close: [5, 'ขอบคุณครับ'] });
  await ticket('plan', 'IT', 'อีเมลขยะเข้าเยอะผิดปกติ', 'low', 'web', { start: true, resolve: 'เพิ่มกฎกรองสแปมที่ Firewall และ Mail gateway', close: [3, 'ยังมีหลุดมาบ้าง'] });
  await ticket('sales', 'AFTER', 'อีสเทิร์น อิเล็คทริค: ขอใบรับรองวัสดุ (Mill cert) ล็อตล่าสุด', 'normal', 'email', { start: true, resolve: 'ส่ง Mill certificate SPCC ล็อตเดือนนี้ทางอีเมลแล้ว', close: [5, 'ลูกค้าได้รับเอกสารครบ'] },
    cust('C-002', 'คุณภาณุมาศ (QA อีสเทิร์น อิเล็คทริค)', 'qa@eastern-electric.example.co.th', 'ลูกค้าขอเอกสารประกอบการตรวจรับ'));
  await ticket('sales', 'AFTER', 'คูลแอร์: ขอเลื่อนส่งของล็อตถัดไป 2 วัน', 'normal', 'line', { start: true, resolve: 'ประสานฝ่ายวางแผน ปรับแผนส่งเป็นวันศุกร์ ลูกค้ารับทราบ', close: [4] },
    cust('C-001', 'คุณจิราพร (จัดซื้อ คูลแอร์)', 'LINE: jiraporn.coolair', 'คลังลูกค้าเต็ม ขอเลื่อนรับของ'));
  await ticket('it', 'IT', 'ขอติดตั้งโปรแกรม AutoCAD LT ให้ฝ่ายผลิต', 'normal', 'web', { start: true, resolve: 'ติดตั้ง AutoCAD LT 2026 ที่เครื่องวางแผนการผลิตแล้ว' });
  await ticket('store', 'FAC', 'หลอดไฟลานจอดรถดับ 3 ดวง', 'normal', 'walk_in', { start: true, resolve: 'เปลี่ยนเป็นโคม LED 100W 3 ดวง' });
  await ticket('sales', 'AFTER', 'โฮมสโตร์: สอบถามวิธีประกอบชั้นวาง RACK-08', 'low', 'phone', { start: true, resolve: 'ส่งลิงก์บทความวิธีประกอบและวิดีโอให้ลูกค้าทางไลน์' },
    cust('C-003', 'คุณเอกพล (สาขาลาดกระบัง)', '02-326-1144', '', 'RACK-08'));
  await ticket('sales', 'IT', 'อินเทอร์เน็ตช้าที่สำนักงานชั้น 2', 'high', 'web', { start: true, comments: [['it', 'ตรวจพบ Access point ชั้น 2 โหลดเกิน กำลังย้ายช่องสัญญาณ', false], ['it', 'อาจต้องเพิ่ม AP อีก 1 ตัว — เสนอซื้อผ่านระบบอนุมัติ', true]] });
  await ticket('admin', 'FAC', 'แอร์ห้องประชุมใหญ่ไม่เย็น', 'high', 'phone', { start: true, comments: [['tech', 'น้ำยาแอร์รั่วที่ข้อต่อคอยล์ร้อน นัดช่าง Daikin เข้ามาพรุ่งนี้เช้า', false]] });
  await ticket('sales', 'AFTER', 'คูลแอร์: ขายึด BRK-100 รูเจาะไม่ตรง 50 ชิ้น', 'urgent', 'phone', {
    start: true, comments: [['qc', 'รับเรื่องแล้ว กักของล็อตเดียวกันในคลัง FG และเปิด NCR ตรวจสอบ', false], ['qc', 'สงสัยพันช์ชุดเจาะรู PRESS-02 สึก — รอผลวัดจาก QC', true]],
  }, cust('C-001', 'คุณสมพงษ์ (QC คูลแอร์)', '081-552-7781', 'ลูกค้าพบระยะรูยึดเกินสเปก ประกอบเข้าคอมเพรสเซอร์ไม่ได้', 'FG-BRK-100'));
  await ticket('sales', 'IT', 'Notebook ฝ่ายขายแบตเสื่อม ใช้นอกสถานที่ไม่ได้', 'normal', 'web', { start: true, wait: 'สั่งแบตเตอรี่ Lenovo แท้แล้ว รอของ 5 วัน' });
  await ticket('plan', 'FAC', 'พัดลมระบายอากาศไลน์พ่นสีมีเสียงดัง', 'normal', 'walk_in', { start: true, wait: 'รอผู้รับเหมาเข้ามาเปลี่ยนลูกปืนมอเตอร์ (นัดวันจันทร์)' });
  await ticket('sales', 'AFTER', 'โฮมสโตร์: ชั้นวาง RACK-08 สีถลอกระหว่างขนส่ง 2 ชุด', 'normal', 'line', { start: true, wait: 'รอลูกค้าส่งรูปถ่ายและเลขที่ใบส่งของ' },
    cust('C-003', 'คุณเอกพล (สาขาลาดกระบัง)', 'LINE: ekkapol.hs', 'พบรอยถลอกที่เสา 2 ต้น', 'RACK-08'));
  await ticket('plan', 'IT', 'ขอเพิ่มสิทธิ์เข้าโฟลเดอร์แชร์ฝ่ายผลิต', 'low', 'web', {});
  await ticket('sales', 'AFTER', 'อีสเทิร์น อิเล็คทริค: กล่อง CASE-01 บานพับหลวม', 'high', 'email', {},
    cust('C-002', 'คุณภาณุมาศ (QA อีสเทิร์น อิเล็คทริค)', 'qa@eastern-electric.example.co.th', 'พบ 6 ตู้จาก 150 ตู้ บานพับหลวม ต้องขันน็อตใหม่', 'FG-CASE-01'));
  await ticket('qc', 'FAC', 'ปลั๊กไฟจุดตรวจ QC ช็อต มีประกายไฟ', 'urgent', 'phone', { start: true });
  // past SLA: calls the technicians logged with the time the store really phoned (urgent = 24x7 clock, high = business hours)
  await ticket('store', 'IT', 'คอมพิวเตอร์จุดชั่งน้ำหนักคลังเปิดไม่ติด', 'urgent', 'phone', { reportedAt: iso(wd(-1), '15:40') },
    { description: 'กดปุ่ม power แล้วไฟไม่ขึ้น รับของเข้าคลังไม่ได้', assetRef: 'IT-PC-01' });
  await ticket('store', 'FAC', 'ประตูม้วนคลังสินค้าติดขัด เปิดได้ครึ่งเดียว', 'high', 'walk_in', { start: true, reportedAt: iso(wd(-7), '09:15') },
    { description: 'รถโฟล์คลิฟท์เข้าไม่ได้ ต้องยกของผ่านประตูเล็ก' });
}

/* ------------------------------------------------------------------ projects ------------------------------------------------------------------ */

async function seedProjects(x: Ctx) {
  const { call, users: u, as, partners } = x;
  const member = (k: string, role: string, hourlyRate: number) => ({ ...ref(u[k]), role, hourlyRate });
  const project = async (body: any, status: 'planning' | 'active' | 'on_hold' | 'done') => {
    const p = await call('POST', '/api/projects/projects', body);
    if (status !== 'planning') await call('POST', `/api/projects/projects/${p.id}/activate`);
    if (status === 'on_hold') await call('POST', `/api/projects/projects/${p.id}/hold`);
    return p;
  };
  const press = await project({
    name: 'ติดตั้งไลน์ปั๊มใหม่ PRESS-04 (250 ตัน)', ...{ managerId: u.admin.id, managerName: u.admin.name }, budget: 180000, startDate: dayBack(40), endDate: addDays(bkkDate(), 45),
    description: 'ขยายกำลังการผลิตขายึดแอร์รองรับสัญญาคูลแอร์ปี 2570: ฐานราก ระบบไฟ ลม ติดตั้งเครื่อง ทดลองเดินและ buy-off',
    members: [member('admin', 'ผู้จัดการโครงการ', 650), member('tech', 'หัวหน้าช่างติดตั้ง', 380), member('plan', 'วางแผนการผลิต', 320), member('qc', 'ตรวจรับเครื่อง/Buy-off', 300)],
  }, 'active');
  const erp = await project({
    name: 'นำระบบ ERP มาใช้ภายในโรงงาน (Factory OS)', managerId: u.it.id, managerName: u.it.name, budget: 120000, startDate: dayBack(60), endDate: addDays(bkkDate(), 30),
    description: 'ย้ายงานจาก Excel สู่ระบบ: คลัง จัดซื้อ ผลิต ขาย บุคคล และอนุมัติออนไลน์ อบรมผู้ใช้ทุกแผนก',
    members: [member('it', 'ผู้ดูแลระบบ', 350), member('acc', 'Key user บัญชี', 320), member('store', 'Key user คลัง', 260), member('plan', 'Key user ผลิต', 320), member('buyer', 'Key user จัดซื้อ', 300)],
  }, 'active');
  const oem = await project({
    name: 'พัฒนาแม่พิมพ์ขายึดรุ่นใหม่ BRK-300 ให้ คูลแอร์ (OEM)', customerId: partners['C-001'].id, customerName: partners['C-001'].name,
    managerId: u.plan.id, managerName: u.plan.name, budget: 38000, startDate: dayBack(25), endDate: addDays(bkkDate(), 20),
    description: 'ออกแบบแม่พิมพ์ 3 สเตชัน ทำตัวอย่าง 50 ชิ้นให้ลูกค้าอนุมัติ (PPAP) ก่อนผลิตจริง',
    members: [member('plan', 'ผู้จัดการโครงการ', 320), member('tech', 'ช่างแม่พิมพ์', 380), member('qc', 'วัดตัวอย่าง/PPAP', 300), member('sales', 'ประสานลูกค้า', 300)],
  }, 'active');
  const iso9001 = await project({
    name: 'ต่ออายุใบรับรอง ISO 9001:2015', managerId: u.qc.id, managerName: u.qc.name, budget: 60000, startDate: addDays(bkkDate(), 7), endDate: addDays(bkkDate(), 90),
    description: 'ตรวจติดตามภายใน ทบทวนฝ่ายบริหาร และรับการตรวจ Surveillance audit',
    members: [member('qc', 'QMR', 300), member('hr', 'เอกสารฝึกอบรม', 280), member('admin', 'ผู้บริหาร', 650)],
  }, 'planning');

  const ms = async (p: any, list: [string, number, boolean?][]) => {
    const out: string[] = [];
    for (const [name, due, done] of list) {
      const r = await call('POST', `/api/projects/projects/${p.id}/milestones`, { name, dueDate: addDays(bkkDate(), due) });
      const m = r.milestones?.find((x: any) => x.name === name) ?? r;
      if (done && m.id) await call('POST', `/api/projects/milestones/${m.id}/done`);
      out.push(m.id);
    }
    return out;
  };
  const [mP1, mP2, mP3] = await ms(press, [['ฐานรากและระบบไฟพร้อม', -10, true], ['ติดตั้งเครื่องและระบบลม', 7], ['ทดลองเดินเครื่อง / Buy-off', 30]]);
  const [mE1, mE2, mE3] = await ms(erp, [['ตั้งค่าข้อมูลหลักครบ', -20, true], ['เปิดใช้คลัง-จัดซื้อ-ขาย', -3], ['เปิดใช้บุคคล-อนุมัติ-เบิกจ่าย', 21]]);
  const [mO1, mO2] = await ms(oem, [['ออกแบบแม่พิมพ์เสร็จ', -5, true], ['ส่งตัวอย่าง 50 ชิ้นให้ลูกค้า', 10]]);
  const [mI1] = await ms(iso9001, [['ตรวจติดตามภายใน (Internal audit)', 30], ['ทบทวนฝ่ายบริหาร', 45]]);

  type T = [any, string, string, string, number, number, 'todo' | 'doing' | 'review' | 'done', string?, string?];
  const tasks: T[] = [
    [press, 'เทฐานรากเครื่อง PRESS-04', 'tech', 'high', -15, 24, 'done', mP1],
    [press, 'เดินสายไฟ 3 เฟส 100A และตู้ MDB ย่อย', 'tech', 'high', -8, 16, 'done', mP1],
    [press, 'ประสานผู้ขายส่งเครื่องและเครน', 'admin', 'normal', -4, 6, 'done', mP2],
    [press, 'ติดตั้งระบบลมและท่อน้ำมัน', 'tech', 'high', 3, 20, 'doing', mP2],
    [press, 'ยกเครื่องลงฐานและปรับระดับ', 'tech', 'urgent', 6, 12, 'todo', mP2],
    [press, 'จัดทำ Layout ไลน์และจุดวางพาเลท', 'plan', 'normal', -2, 8, 'review', mP2],
    [press, 'เขียนแผนการผลิตช่วงทดลองเดิน', 'plan', 'normal', 20, 6, 'todo', mP3],
    [press, 'จัดทำ Checklist Buy-off และเกณฑ์ยอมรับ', 'qc', 'normal', 15, 6, 'todo', mP3],
    [erp, 'นำเข้าข้อมูลสินค้าและคู่ค้า', 'it', 'high', -25, 12, 'done', mE1],
    [erp, 'ตั้งค่าสิทธิ์ผู้ใช้ทุกแผนก', 'it', 'normal', -18, 6, 'done', mE1],
    [erp, 'ตรวจนับสต็อกยกยอดเข้าระบบ', 'store', 'high', -6, 16, 'done', mE2],
    [erp, 'อบรมการรับ-จ่ายสต็อกผ่านมือถือ', 'store', 'normal', -2, 6, 'doing', mE2],
    [erp, 'ทดสอบออกใบกำกับภาษีและ QR พร้อมเพย์', 'acc', 'high', -4, 8, 'review', mE2],
    [erp, 'ทดสอบใบสั่งซื้อและการอนุมัติ PO', 'buyer', 'normal', -1, 6, 'doing', mE2],
    [erp, 'ตั้งค่า BOM และสูตรผลิตทุกรุ่น', 'plan', 'high', -3, 10, 'doing', mE2],
    [erp, 'ตั้งค่าวันหยุดและประเภทการลา', 'it', 'normal', 10, 3, 'todo', mE3],
    [erp, 'ย้ายแบบฟอร์มเบิกค่าใช้จ่ายเข้าระบบ', 'acc', 'normal', 14, 6, 'todo', mE3],
    [erp, 'อบรมหัวหน้างานใช้งานอนุมัติบนมือถือ', 'it', 'low', 18, 4, 'todo', mE3],
    [oem, 'รับแบบชิ้นงานและสเปกจากลูกค้า', 'sales', 'normal', -20, 3, 'done', mO1],
    [oem, 'ออกแบบแม่พิมพ์ 3 สเตชัน (CAD)', 'plan', 'high', -8, 24, 'done', mO1],
    [oem, 'กลึง/เจียรชิ้นส่วนแม่พิมพ์', 'tech', 'high', -1, 30, 'doing', mO2],
    [oem, 'ประกอบและทดลองปั๊มแม่พิมพ์', 'tech', 'urgent', 5, 12, 'todo', mO2],
    [oem, 'วัดตัวอย่าง 50 ชิ้น ทำรายงาน PPAP', 'qc', 'high', 9, 10, 'todo', mO2],
    [oem, 'นัดลูกค้าตรวจตัวอย่างที่โรงงาน', 'sales', 'normal', 11, 2, 'todo', mO2],
    [oem, 'ประเมินต้นทุนต่อชิ้นรุ่น BRK-300', 'plan', 'normal', -3, 4, 'review'],
    [iso9001, 'ทบทวนเอกสารขั้นตอนการทำงาน (WI) ทุกแผนก', 'qc', 'normal', 20, 16, 'todo', mI1],
    [iso9001, 'จัดตารางผู้ตรวจติดตามภายใน', 'qc', 'normal', 12, 3, 'todo', mI1],
    [iso9001, 'รวบรวมบันทึกการฝึกอบรมพนักงาน', 'hr', 'normal', 25, 8, 'todo', mI1],
    [iso9001, 'ปิด NCR ค้างก่อนการตรวจ', 'qc', 'high', 28, 6, 'todo'],
    [press, 'ขอใบอนุญาตติดตั้งเครื่องจักรกับ กรอ.', 'admin', 'high', -1, 4, 'todo'],
  ];
  const created: Record<string, { id: string; project: any }[]> = {};
  for (const [p, title, who, priority, due, estimateHours, status, milestoneId] of tasks) {
    const t = await call('POST', '/api/projects/tasks', {
      projectId: p.id, title, assigneeId: u[who].id, assigneeName: u[who].name, priority, dueDate: addDays(bkkDate(), due), estimateHours, milestoneId: milestoneId ?? null,
    });
    if (status === 'doing' || status === 'review') await call('POST', `/api/projects/tasks/${t.id}/start`);
    if (status === 'review') await call('POST', `/api/projects/tasks/${t.id}/review`);
    if (status === 'done') await call('POST', `/api/projects/tasks/${t.id}/done`);
    (created[who] ??= []).push({ id: t.id, project: p });
  }

  // timesheets: last week (+ this week so far) for the people on the active projects
  const thisMonday = (() => { const d = bkkDate(); return addDays(d, -((weekday(d) + 6) % 7)); })();
  const lastMonday = addDays(thisMonday, -7);
  const days = [...[0, 1, 2, 3, 4].map((i) => addDays(lastMonday, i)), ...[0, 1, 2, 3, 4].map((i) => addDays(thisMonday, i)).filter((d) => d <= bkkDate())]
    .filter(isWorkday);
  // the project team logs hours: role templates give projects.timesheet.log to technician, pm and it (others' tasks stay unlogged)
  const people = ['tech', 'plan', 'it'];
  await Promise.all(people.map(async (who, pi) => {
    const mine = created[who]?.filter((t) => t.project.id !== iso9001.id) ?? [];
    if (!mine.length) return;
    for (const [di, day] of days.entries()) {
      const n = 1 + Math.floor(noise(pi * 17 + di) * 2);
      for (let k = 0; k < n; k++) {
        const t = mine[(di + k + pi) % mine.length];
        const hours = [1.5, 2, 2.5, 3, 4][Math.floor(noise(pi * 7 + di * 3 + k) * 5)];
        await as[who]('POST', '/api/projects/timesheets', { workDate: day, projectId: t.project.id, taskId: t.id, hours, note: k ? 'ประชุมติดตามงาน' : undefined });
      }
    }
  }));
  // the OEM die design started earlier: approved weeks before the last one (pushes that small project towards its budget)
  const oemDone = (who: string) => created[who].find((t) => t.project.id === oem.id)!.id;
  for (const [who, monday, hours, note] of [['plan', addDays(lastMonday, -14), 4, 'ออกแบบแม่พิมพ์ (CAD)'], ['tech', addDays(lastMonday, -7), 3, 'เตรียมเหล็กแม่พิมพ์ SKD11']] as const) {
    for (const d of [0, 1, 2, 3].map((i) => addDays(monday, i)).filter(isWorkday)) {
      await as[who]('POST', '/api/projects/timesheets', { workDate: d, projectId: oem.id, taskId: oemDone(who), hours, note });
    }
    await as[who]('POST', '/api/projects/timesheets/week/submit', { start: monday });
  }
  for (const w of await call<any[]>('GET', '/api/projects/timesheet-weeks?status=submitted')) await call('POST', `/api/projects/timesheet-weeks/${w.id}/approve`);
  for (const who of ['tech', 'plan', 'it']) await as[who]('POST', '/api/projects/timesheets/week/submit', { start: lastMonday });
  const weeks = await call<any[]>('GET', `/api/projects/timesheet-weeks?status=submitted&userId=${u.tech.id}`);
  for (const w of weeks) await call('POST', `/api/projects/timesheet-weeks/${w.id}/approve`);
}

/* ------------------------------------------------------------------ receivables (sales) ------------------------------------------------------------------ */

/**
 * Accounting (acc@) collects: customers pay most invoices — คูลแอร์ withholds 3% (รับจ้างทำของ) and once short-pays a disputed freight
 * charge, อีสเทิร์น pays by cheque and is behind on one invoice — so AR aging has current, 1–30, 31–60 and 90+ buckets.
 * The sales order CRM drafted from the accepted quotation gets confirmed and a 30% deposit.
 */
async function seedReceivables(x: Ctx) {
  const { as, partners, has } = x;
  const acc = as.acc;
  const today = bkkDate();
  const cents = (n: number) => Math.round(n * 100) / 100;
  const invoices = await acc<any[]>('GET', '/api/sales/invoices?kind=sale&limit=500'); // tax invoices of this system, not ลูกหนี้ยกมา
  const of = (code: string) => invoices.filter((i) => i.customer_id === partners[code]?.id).sort((a, b) => a.issue_date.localeCompare(b.issue_date));
  const on = (inv: any, days: number) => { const d = addDays(inv.due_date, days); return d > today ? today : d; };
  type Pay = [string, string, string, { inv: any; amount?: number }[], number, string?];
  const plan: Pay[] = [];
  const coolAir = of('C-001'); // credit 30 days, oldest first
  if (coolAir[0]) plan.push([on(coolAir[0], 3), 'transfer', 'KBANK 0021-55871', [{ inv: coolAir[0], amount: cents(coolAir[0].gross - 1500) }], 3,
    'ลูกค้าหักค่าขนส่ง 1,500 บาท อ้างว่าส่งของล่าช้า — ฝ่ายขายกำลังเจรจา']);
  if (coolAir[1]) plan.push([on(coolAir[1], 0), 'transfer', 'KBANK 0021-61290', [{ inv: coolAir[1] }], 3, 'หัก ณ ที่จ่าย 3% แนบหนังสือรับรอง 50 ทวิ']);
  if (coolAir[2]) plan.push([on(coolAir[2], -2), 'transfer', 'KBANK 0021-66014', [{ inv: coolAir[2] }], 3, 'หัก ณ ที่จ่าย 3% แนบหนังสือรับรอง 50 ทวิ']);
  const eastern = of('C-002'); // credit 60 days, pays by cheque
  if (eastern[0]) plan.push([on(eastern[0], -1), 'cheque', 'เช็ค BBL 4471025', [{ inv: eastern[0] }], 0]);
  if (eastern[1]) plan.push([on(eastern[1], 2), 'cheque', 'เช็ค BBL 4471188', [{ inv: eastern[1], amount: cents(eastern[1].gross / 2) }], 0, 'ชำระครึ่งหนึ่งก่อน ส่วนที่เหลือนัดชำระสิ้นเดือน']);
  if (eastern[2]) plan.push([on(eastern[2], 9), 'transfer', 'BBL 7720-31845', [{ inv: eastern[2] }], 0, 'ชำระล่าช้า 9 วัน — ลูกค้าแจ้งรอบจ่ายเช็คเปลี่ยน']);
  plan.sort((a, b) => a[0].localeCompare(b[0])); // RC numbers follow the calendar
  for (const [receiptDate, method, reference, lines, whtPct, note] of plan) {
    await acc('POST', '/api/sales/receipts', {
      receiptDate, method, reference, whtPct, note, lines: lines.map(({ inv, amount }) => ({ invoiceId: inv.id, amount: amount ?? inv.outstanding })),
    });
  }

  // the order Sales drafted from the accepted CRM quotation (event, arrives asynchronously): confirm it and take a 30% deposit
  if (!has('crm')) return;
  let so: any;
  for (let i = 0; i < 40 && !so; i++) {
    so = (await acc<any[]>('GET', '/api/sales/orders?q=QT-')).find((o) => o.ref?.startsWith('QT-') && o.status === 'draft');
    if (!so) await new Promise((r) => setTimeout(r, 400));
  }
  if (!so) throw new Error('no sales order was drafted from the accepted quotation');
  await as.sales('POST', `/api/sales/orders/${so.id}/confirm`);
  await acc('POST', '/api/sales/receipts', {
    depositAmount: cents(so.gross * 0.3), orderId: so.id, method: 'transfer', reference: 'SCB 4410-77812', receiptDate: today,
    note: `มัดจำ 30% ตามใบเสนอราคา ${so.ref} — ส่งมอบ 3 งวด หักมัดจำตามสัดส่วนทุกงวด`,
  });
}

/* ------------------------------------------------------------------ assets ------------------------------------------------------------------ */

async function seedAssets(x: Ctx) {
  const { call, users: u } = x;
  const cat: Record<string, string> = {};
  await Promise.all(([
    ['MACH', 'เครื่องจักร', 10, 5], ['COMP', 'คอมพิวเตอร์และอุปกรณ์ไอที', 3, 0], ['VEH', 'ยานพาหนะ', 5, 10], ['FURN', 'เฟอร์นิเจอร์และเครื่องใช้สำนักงาน', 5, 0],
  ] as const).map(async ([code, name, usefulLifeYears, salvagePct]) => { cat[code] = (await call('POST', '/api/assets/categories', { code, name, usefulLifeYears, salvagePct })).id; }));
  const OFFICE = 'สำนักงาน ชั้น 2';
  type A = [string, string, string, string, string, number, string, string | null, string, string?, string?];
  const list: A[] = [
    ['MC-PRESS-01', 'เครื่องปั๊ม 80 ตัน', 'MACH', 'AIDA', '2021-03-15', 1850000, 'ไลน์ปั๊มขึ้นรูป', 'tech', 'บริษัท ไทยแมชชีนเนอรี่ จำกัด'],
    ['MC-PRESS-02', 'เครื่องปั๊ม 110 ตัน', 'MACH', 'AIDA', '2022-06-20', 2450000, 'ไลน์ปั๊มขึ้นรูป', 'tech', 'บริษัท ไทยแมชชีนเนอรี่ จำกัด'],
    ['MC-PRESS-03', 'เครื่องปั๊ม 200 ตัน', 'MACH', 'Komatsu', '2023-09-05', 4200000, 'ไลน์ปั๊มขึ้นรูป', 'tech', 'บริษัท โคมัตสุ อินดัสทรีส์ (ประเทศไทย) จำกัด', '2026-09-05'],
    ['MC-BEND-01', 'เครื่องพับ CNC', 'MACH', 'Amada', '2022-01-10', 3100000, 'ไลน์ปั๊มขึ้นรูป', 'tech', 'บริษัท อมาดา (ประเทศไทย) จำกัด'],
    ['MC-LASER-01', 'เครื่องตัดเลเซอร์ไฟเบอร์ 3kW', 'MACH', 'Bodor', '2024-02-28', 3850000, 'ไลน์ตัด', 'tech', 'บริษัท เลเซอร์เทค เอเชีย จำกัด', addDays(bkkDate(), 20)],
    ['MC-SHEAR-01', 'เครื่องตัดเฉือนไฮดรอลิก', 'MACH', 'Durma', '2021-08-01', 680000, 'ไลน์ตัด', 'tech', 'หจก. ช่างไทยอะไหล่'],
    ['MC-WELD-01', 'หุ่นยนต์เชื่อม', 'MACH', 'Panasonic', '2023-04-18', 1450000, 'ไลน์เชื่อมและพ่นสี', 'tech', 'บริษัท พานาโซนิค โซลูชั่นส์ (ประเทศไทย) จำกัด'],
    ['MC-PAINT-01', 'ตู้พ่นสีฝุ่น', 'MACH', 'Gema', '2022-10-03', 520000, 'ไลน์เชื่อมและพ่นสี', 'tech', 'บริษัท โคทติ้ง ซัพพลาย จำกัด'],
    ['MC-OVEN-01', 'เตาอบสี', 'MACH', 'Thai Oven', '2022-10-03', 760000, 'ไลน์เชื่อมและพ่นสี', 'tech', 'บริษัท โคทติ้ง ซัพพลาย จำกัด'],
    ['MC-COMP-01', 'ปั๊มลม (Air compressor) 15 แรงม้า', 'MACH', 'Hitachi', '2021-11-22', 185000, 'ห้องปั๊มลม', 'tech', 'หจก. ช่างไทยอะไหล่'],
    ['VH-VAN-01', 'รถตู้ Toyota Commuter (นข 4521 สมุทรปราการ)', 'VEH', 'Toyota', '2022-05-12', 1289000, 'ลานจอดรถ', 'store', 'โตโยต้า สมุทรปราการ'],
    ['VH-PICK-01', 'รถกระบะ Isuzu D-Max (3ฒก 8173 กรุงเทพมหานคร)', 'VEH', 'Isuzu', '2023-07-07', 789000, 'ลานจอดรถ', 'sales', 'อีซูซุ บางนา'],
    ['VH-FORK-01', 'รถโฟล์คลิฟท์ 2.5 ตัน', 'VEH', 'Toyota', '2021-09-14', 650000, 'คลังสินค้า', 'store', 'บริษัท ไทยฟอร์คลิฟท์ จำกัด'],
    ['IT-SRV-01', 'Server Dell PowerEdge T350', 'COMP', 'Dell', '2024-01-15', 98000, 'ห้องเซิร์ฟเวอร์', 'it', 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)', addDays(bkkDate(), 25)],
    ['IT-FW-01', 'Firewall Fortigate 60F', 'COMP', 'Fortinet', '2024-08-01', 42000, 'ห้องเซิร์ฟเวอร์', 'it', 'บริษัท โกอะลอง จำกัด'],
    ['IT-NB-01', 'Notebook Lenovo ThinkPad E14', 'COMP', 'Lenovo', '2024-05-01', 32900, OFFICE, 'sales', 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)'],
    ['IT-NB-02', 'Notebook Asus Vivobook 15', 'COMP', 'Asus', '2023-03-01', 28500, OFFICE, 'acc', 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)'],
    ['IT-NB-03', 'Notebook Lenovo ThinkPad T14', 'COMP', 'Lenovo', '2025-01-20', 35900, OFFICE, 'plan', 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)'],
    ['IT-PC-01', 'PC จุดชั่งน้ำหนักคลังสินค้า', 'COMP', 'HP', '2022-02-10', 18900, 'คลังสินค้า', 'store', 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)'],
    ['IT-PRN-01', 'เครื่องพิมพ์เลเซอร์ Brother HL-L2375DW', 'COMP', 'Brother', '2023-06-12', 15900, OFFICE, null, 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)'],
    ['IT-CCTV-01', 'ชุดกล้องวงจรปิด 16 ตัว พร้อม NVR', 'COMP', 'Hikvision', '2023-11-20', 86000, 'ทั่วโรงงาน', 'it', 'บริษัท โกอะลอง จำกัด'],
    ['IT-NB-OLD', 'Notebook Acer Aspire 5 (เครื่องเก่า)', 'COMP', 'Acer', '2021-02-01', 21500, OFFICE, 'buyer', 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)'],
    ['FN-MEET-01', 'ชุดโต๊ะประชุม 20 ที่นั่ง', 'FURN', 'Modernform', '2022-03-01', 68000, 'ห้องประชุมใหญ่', null, 'โมเดอร์นฟอร์ม'],
    ['FN-OFF-01', 'โต๊ะทำงานและเก้าอี้สำนักงาน 12 ชุด', 'FURN', 'Index', '2021-01-15', 96000, OFFICE, null, 'อินเด็กซ์ ลีฟวิ่งมอลล์'],
    ['FN-AIR-01', 'เครื่องปรับอากาศ 36,000 BTU ห้องประชุมใหญ่', 'FURN', 'Daikin', '2023-04-05', 54000, 'ห้องประชุมใหญ่', null, 'บริษัท แอร์เซอร์วิส จำกัด'],
    ['FN-PJ-01', 'โปรเจคเตอร์ Epson EB-X51', 'FURN', 'Epson', '2024-09-10', 16900, OFFICE, 'it', 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)'],
  ];
  const ids: Record<string, string> = {};
  await Promise.all(list.map(async ([code, name, c, brand, purchaseDate, cost, location, who, supplierName, warrantyUntil]) => {
    const yr = Number(purchaseDate.slice(0, 4));
    const a = await call('POST', '/api/assets/assets', {
      code, name, categoryId: cat[c], brand, location, purchaseDate, cost, supplierName,
      serialNo: `${brand.slice(0, 3).toUpperCase()}${yr}${String(Math.floor(noise(cost) * 900000) + 100000)}`,
      warrantyUntil: warrantyUntil ?? addDays(purchaseDate, c === 'COMP' ? 3 * 365 : 365),
      custodianId: who ? u[who].id : null, custodianName: who ? u[who].name : null,
    });
    ids[code] = a.id;
  }));
  // transfers, repairs, a disposal and this year's count of the office
  await call('POST', `/api/assets/assets/${ids['IT-NB-02']}/assign`, { custodianId: u.acc.id, custodianName: u.acc.name, location: OFFICE, assignedOn: dayBack(120), note: 'โอนจากฝ่ายจัดซื้อ' });
  await call('POST', `/api/assets/assets/${ids['FN-PJ-01']}/assign`, { custodianId: null, location: 'ตู้ฝ่ายไอที', assignedOn: dayBack(30), note: 'เก็บเข้าตู้ ใช้ผ่านระบบจองอุปกรณ์' });
  await call('POST', `/api/assets/assets/${ids['IT-PRN-01']}/repairs`, { repairDate: dayBack(40), description: 'เปลี่ยนชุดดรัมและลูกยางดึงกระดาษ', vendor: 'บริษัท ไอทีซิตี้ จำกัด (มหาชน)', cost: 1850, completed: true });
  await call('POST', `/api/assets/assets/${ids['MC-PRESS-02']}/repairs`, { repairDate: dayBack(55), description: 'เปลี่ยนซีลกระบอกไฮดรอลิก', vendor: 'หจก. ช่างไทยอะไหล่', cost: 6800, completed: true });
  await call('POST', `/api/assets/assets/${ids['MC-COMP-01']}/repairs`, { repairDate: dayBack(2), description: 'ปั๊มลมไม่ตัดที่ 8 บาร์ วาล์วนิรภัยระบายตลอด ส่งซ่อมสวิตช์แรงดัน', vendor: 'บริษัท แอร์คอมเพรสเซอร์ เซอร์วิส จำกัด', cost: 4500 });
  await call('POST', `/api/assets/assets/${ids['IT-NB-OLD']}/dispose`, { disposedOn: dayBack(20), method: 'sold', price: 2500, note: 'ขายซากให้ร้านรับซื้อคอมพิวเตอร์ หลังสำรองข้อมูลและล้างดิสก์' });
  const audit = await call('POST', '/api/assets/audits', { location: OFFICE, note: 'ตรวจนับทรัพย์สินประจำปี — ฝ่ายบัญชี' });
  for (const code of ['IT-NB-01', 'IT-NB-02', 'FN-OFF-01']) await call('POST', `/api/assets/audits/${audit.id}/scan`, { code });
}

/* ------------------------------------------------------------------ quality ------------------------------------------------------------------ */

/** NCR (return to supplier) for the rejected steel, then the buyer's RT document out of QC-HOLD once Inventory has quarantined it. */
async function returnRejectedSteel(x: Ctx, r: any, insp: any, qty: number) {
  const { as, has } = x;
  const ncr = await as.qc('POST', `/api/quality/inspections/${r.id}/ncr`, { severity: 'major', disposition: 'return_to_supplier', qtyAffected: qty });
  await as.qc('POST', `/api/quality/ncrs/${ncr.id}/investigate`, {
    whyAnalysis: '1) ความหนา 1.10 มม. ต่ำกว่าสเปก 1.14 → 2) ม้วนท้ายของคอยล์รีดบาง → 3) ผู้ขายไม่ได้ตัดหัว-ท้ายคอยล์ก่อนส่ง',
    rootCause: 'ผู้ขายส่งเหล็กท้ายม้วนที่ความหนาไม่สม่ำเสมอ โดยไม่ได้ตัดทิ้งตามข้อตกลงคุณภาพ',
  });
  if (!has('purchasing') || !insp.source_id) return;
  const wh = has('inventory') ? 'QC-HOLD' : (insp.warehouse_code ?? 'MAIN');
  if (has('inventory')) {
    // wait until Inventory moved the rejected qty into QC-HOLD, so the return never takes the hold below zero
    for (let i = 0; i < 30; i++) {
      const holds = await as.admin('GET', '/api/inventory/holds?status=rejected');
      if (holds.some((h: any) => h.inspection_no === insp.no)) break;
      await new Promise((res) => setTimeout(res, 300));
    }
  }
  await as.buyer('POST', `/api/purchasing/purchase-orders/${insp.source_id}/returns`, {
    warehouseCode: wh, refNo: ncr.no, note: `ส่งคืนตาม ${ncr.no} ขอใบลดหนี้ · ผู้ขายรับของคืนที่โรงงาน`,
    lines: [{ itemId: insp.item_id, qty, reason: 'ความหนา 1.10 มม. ต่ำกว่าสเปก 1.14–1.26 มม.' }],
  });
}

/** Complete the inspections the core seed's receipts and production raised: most pass, one lot fails and gets an NCR + CA. */
async function seedQualityWork(x: Ctx) {
  const { users: u, as } = x;
  const q = as.qc;
  // events from purchasing / production are delivered asynchronously; wait until the queue stops growing
  let rows: any[] = [];
  for (let i = 0, last = -1; i < 20; i++) {
    rows = await q('GET', '/api/quality/inspections?status=pending,in_progress&limit=200');
    if (rows.length && rows.length === last) break;
    last = rows.length;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!rows.length) return; // purchasing / production not installed
  const order = (r: any) => `${r.source_ref ?? ''}|${r.no}`;
  rows.sort((a, b) => order(a).localeCompare(order(b)));
  const incoming = rows.filter((r) => r.stage === 'incoming');
  const final = rows.filter((r) => r.stage === 'final');
  const keepPending = new Set([...incoming.slice(-2), ...final.slice(-1)].map((r) => r.id));
  const failId = final.find((r) => r.item_code === 'FG-BRK-100' && !keepPending.has(r.id))?.id;
  const condId = incoming.find((r) => r.item_code === 'RM-SUS304' && !keepPending.has(r.id))?.id;
  // the latest steel lot is too thin: 300 kg rejected -> QC-HOLD -> NCR "return to supplier" -> RT document from QC-HOLD
  const rejectLot = incoming.filter((r) => r.item_code === 'RM-SPCC-12' && !keepPending.has(r.id)).at(-1);
  const rejectQty = rejectLot ? Math.min(300, Number(rejectLot.qty)) : 0;
  const inspectors = [u.qc, { id: undefined, name: 'ปวีณา แสงจันทร์' }];

  let n = 0;
  for (const r of rows) {
    if (keepPending.has(r.id)) continue;
    const insp = await q('GET', `/api/quality/inspections/${r.id}`);
    const who = inspectors[n++ % 2];
    await q('POST', `/api/quality/inspections/${r.id}/start`, { inspectorId: who.id, inspectorName: who.name });
    const results = insp.results.map((c: any, k: number) => {
      const lo = Number(c.min_value ?? c.target ?? 0);
      const hi = Number(c.max_value ?? c.target ?? lo);
      if (r.id === failId && c.name === 'ระยะห่างรูยึด') return { resultId: c.id, value: 80.6, note: 'รูเยื้อง 3 จาก 5 ชิ้นตัวอย่าง' };
      if (r.id === condId && c.type === 'visual') return { resultId: c.id, passed: false, note: 'ฟิล์มฉีก มีรอยขีดข่วนตื้น 4 แผ่น' };
      if (r.id === rejectLot?.id && c.name === 'ความหนา') return { resultId: c.id, value: 1.1, note: 'ม้วนท้าย 300 กก. บางกว่าสเปกทุกจุดวัด' };
      if (c.type === 'measure') {
        const span = hi - lo;
        const v = lo + span * (0.35 + noise(n * 13 + k) * 0.3);
        return { resultId: c.id, value: Math.round(v * 1000) / 1000 };
      }
      return { resultId: c.id, passed: true };
    });
    await q('POST', `/api/quality/inspections/${r.id}/results`, { results });
    const done = await q('POST', `/api/quality/inspections/${r.id}/complete`,
      r.id === condId ? { note: 'รับได้ทั้งล็อต แจ้งผู้ขายเรื่องการแพ็ก' }
        : r.id === rejectLot?.id ? { acceptedQty: Number(r.qty) - rejectQty, rejectedQty: rejectQty, note: 'คัดแยกม้วนที่บางออก 300 กก. ส่วนที่เหลือวัดผ่าน' } : {});
    if (r.id === rejectLot?.id && done.result === 'fail') await returnRejectedSteel(x, r, done, rejectQty);
    if (r.id === failId && done.result === 'fail') {
      const ncr = await q('POST', `/api/quality/inspections/${r.id}/ncr`, { severity: 'major', disposition: 'rework' });
      await q('POST', `/api/quality/ncrs/${ncr.id}/investigate`, {
        whyAnalysis: '1) รูเยื้อง → 2) ตำแหน่งพันช์เคลื่อน → 3) พันช์สึกและตัวล็อกหลวม → 4) ไม่มีรอบเปลี่ยนพันช์ตามจำนวนตี → 5) แผน PM แม่พิมพ์ไม่ครอบคลุมพันช์เจาะรู',
        rootCause: 'พันช์เจาะรูแม่พิมพ์ BRK-100 สึกเกินอายุใช้งาน ไม่มีการนับจำนวนครั้งตีเพื่อเปลี่ยนตามรอบ',
      });
      const withCa = await q('POST', `/api/quality/ncrs/${ncr.id}/actions`, { action: 'คัดแยก 100% และเจาะรูใหม่ (Rework) ชิ้นงานที่กักไว้', ownerId: u.qc.id, ownerName: u.qc.name, dueOn: wd(-1) });
      await q('POST', `/api/quality/ncrs/${ncr.id}/actions`, { action: 'เปลี่ยนพันช์ชุดใหม่ และเพิ่มรอบเปลี่ยนพันช์ทุก 50,000 ครั้งในแผน PM แม่พิมพ์', ownerId: u.tech.id, ownerName: u.tech.name, dueOn: wd(5) });
      const first = withCa.actions?.[0]?.id;
      if (first) {
        await q('POST', `/api/quality/corrective-actions/${first}/done`, {});
        await q('POST', `/api/quality/corrective-actions/${first}/verify`, {});
      }
    }
  }
}
