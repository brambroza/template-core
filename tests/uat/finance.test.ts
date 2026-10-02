/**
 * UAT for finance & the wave-5 modules (UAT-48 onward in docs/uat/cases.json): company profile + role templates, payroll (3 pay
 * profiles, SSO cap, payslips only for oneself, 50 ทวิ printable), tax invoice with letterhead, receipts with WHT, the month's
 * automatic postings → trial balance, VAT / WHT reports, period close, receivables aging, MA contracts (PM visits → helpdesk,
 * installments → draft sales orders), LINE linking + personal notifications, claim attachments, the audit trail, approval
 * delegation, QC fail → QC-HOLD → purchase return. Driven in Chromium against a real installation, each step as the role that
 * does it in real life. Screenshots go to docs/uat/screens and are merged into docs/uat/shots.json (read-merge-write, like the
 * other UAT files).
 */
import type { ChildProcess } from 'node:child_process';
import { createHmac } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import { definition as purchasing } from '@erp/svc-purchasing';
import { definition as sales } from '@erp/svc-sales';
import { definition as automation } from '@erp/svc-automation';
import { definition as quality } from '@erp/svc-quality';
import { definition as approvals } from '@erp/svc-approvals';
import { definition as expense } from '@erp/svc-expense';
import { definition as hr } from '@erp/svc-hr';
import { definition as helpdesk } from '@erp/svc-helpdesk';
import { definition as accounting } from '@erp/svc-accounting';
import { definition as payroll } from '@erp/svc-payroll';
import { definition as contracts } from '@erp/svc-contracts';
import { install, type Installation } from '../e2e/helpers.ts';
import { CHROMIUM, login, logout, pick, startWeb, stopWeb } from '../ui-e2e/browser.ts';

const SCREENS = fileURLToPath(new URL('../../docs/uat/screens', import.meta.url));
const SHOTS_INDEX = fileURLToPath(new URL('../../docs/uat/shots.json', import.meta.url));
const shots: Record<string, { file: string; device: 'desktop' | 'phone' }[]> = {};

async function shot(page: Page, caseId: string, device: 'desktop' | 'phone' = 'desktop') {
  mkdirSync(SCREENS, { recursive: true });
  const list = (shots[caseId] ??= []);
  // let finite entrance animations (report rows fade in) finish, so the picture is not half-drawn
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))),
    new Promise((r) => setTimeout(r, 2000)),
  ]));
  const file = `${caseId}${list.length ? `-${list.length + 1}` : ''}.jpg`;
  await page.screenshot({ path: `${SCREENS}/${file}`, type: 'jpeg', quality: 72, fullPage: true });
  list.push({ file, device });
}

/** Read-merge-write: the factory and office runs write the same index; each run replaces only its own cases. */
function saveShots() {
  const old = existsSync(SHOTS_INDEX) ? JSON.parse(readFileSync(SHOTS_INDEX, 'utf8')) : {};
  const all = { ...old, ...shots };
  const sorted = Object.fromEntries(Object.keys(all).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))).map((k) => [k, all[k]]));
  writeFileSync(SHOTS_INDEX, JSON.stringify(sorted, null, 2) + '\n');
}

const TENANT = 'uat-finance';
const PASSWORD = 'uat-pass-1';
const PORT = 3934;
const base = `http://127.0.0.1:${PORT}`;
/** Thai business date (Asia/Bangkok). */
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
const year = Number(today.slice(0, 4));
const monthNo = Number(today.slice(5, 7));
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** last day of the previous month and that month (the period the accountant closes) */
const prevMonthEnd = addDays(`${thisMonth}-01`, -1);
const prevMonth = prevMonthEnd.slice(0, 7);
const prevMonthMid = `${prevMonth}-15`;
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const text = async (page: Page, selector: string) => (await page.locator(selector).first().textContent()) ?? '';
const fact = (page: Page, label: string) => text(page, `.fact:has(dt:text-is("${label}"))`);

let browser: Browser;
let erp: Installation;
let web: ChildProcess;
let page: Page;
let phone: Page;
let admin: string;
const users: Record<string, { id: string; email: string; name: string; token: string }> = {};
const ids: Record<string, string> = {};
const docs: Record<string, any> = {};

/** a fake LINE Messaging API: records pushes / replies so the test can read what the person received */
const LINE_SECRET = 'uat-line-channel-secret';
const lineSent: { path: string; body: any }[] = [];
let lineApi: Server;

const signedIn = new Map<Page, string>();
async function as(p: Page, who: string) {
  if (signedIn.get(p) === who) return;
  await logout(p, base);
  if (who === 'admin') await login(p, base, TENANT);
  else await login(p, base, TENANT, users[who].email, PASSWORD);
  signedIn.set(p, who);
}
const api = async (who: string, method: string, path: string, body?: unknown) => erp.call(method, `/api/${path}`, body, who === 'admin' ? admin : users[who].token);
const ok = async (who: string, method: string, path: string, body?: unknown) => {
  const r = await api(who, method, path, body);
  if (r.status >= 400) throw new Error(`${who} ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
const open = async (p: Page, path: string) => { await p.goto(`${base}${path}`); await p.locator('.screen').first().waitFor(); };
const dialogAction = async (p: Page, label: string) => p.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
const INSTALLED = ['identity', 'master-data', 'inventory', 'purchasing', 'sales', 'automation', 'quality', 'approvals', 'expense', 'hr', 'helpdesk', 'accounting', 'payroll', 'contracts'];

/** people and the role template each one gets (identity's suggested Thai roles, limited to the installed modules) */
const PEOPLE: [key: string, email: string, name: string, templates: string[], extra?: string[]][] = [
  ['acc', 'acc@finance.co.th', 'สุดารัตน์ บัญชีดี', ['accounting']],
  ['owner', 'owner@finance.co.th', 'ประเสริฐ เจ้าของ', ['executive']],
  ['hr', 'hr@finance.co.th', 'นภาพร บุคคล', ['hr']],
  ['staff', 'staff@finance.co.th', 'สมชาย ใจดี', ['staff']],
  ['staff2', 'staff2@finance.co.th', 'มาลี ขยัน', ['staff']],
  ['sup', 'sup@finance.co.th', 'วิชัย หัวหน้า', ['supervisor']],
  ['sup2', 'sup2@finance.co.th', 'ปรีชา รองหัวหน้า', ['supervisor']],
  ['tech', 'tech@finance.co.th', 'ธนากร ช่างดี', ['it']],
  ['mgr', 'mgr@finance.co.th', 'กมล ผู้จัดการบริการ', ['sales']],
  ['qc', 'qc@finance.co.th', 'อรุณี ตรวจสอบ', ['qc']],
  ['buyer', 'buyer@finance.co.th', 'ชัยวัฒน์ จัดซื้อ', ['purchasing']],
];

/** Company setup an administrator does once (not under test here). */
async function seed() {
  const roleIds: Record<string, string> = {};
  for (const tpl of new Set(PEOPLE.flatMap((p) => p[3]))) {
    roleIds[tpl] = (await ok('admin', 'POST', 'identity/roles/from-template', { template: tpl, name: `UAT ${tpl}`, modules: INSTALLED })).id;
  }
  for (const [key, email, name, templates] of PEOPLE) {
    const u = await ok('admin', 'POST', 'identity/users', { email, name, password: PASSWORD, roleIds: templates.map((t) => roleIds[t]) });
    const tok = (await erp.call('POST', '/api/identity/auth/login', { tenant: TENANT, email, password: PASSWORD })).body.token;
    users[key] = { id: u.id, email, name, token: tok };
  }
  // master data
  docs.customer = await ok('admin', 'POST', 'master-data/partners', { code: 'C-001', name: 'บริษัท ลูกค้าชั้นดี จำกัด', kind: 'customer', taxId: '0105558123451', address: '1 ถ.สุขุมวิท บางนา กรุงเทพฯ 10260' });
  docs.hotel = await ok('admin', 'POST', 'master-data/partners', { code: 'C-002', name: 'โรงแรมริมน้ำ', kind: 'customer' });
  docs.supplier = await ok('admin', 'POST', 'master-data/partners', { code: 'S-001', name: 'บริษัท เหล็กสยาม จำกัด', kind: 'supplier' });
  docs.sheet = await ok('admin', 'POST', 'master-data/items', { code: 'RM-SHEET', name: 'เหล็กแผ่น 2 มม.', type: 'raw', uom: 'แผ่น' });
  await ok('admin', 'POST', 'quality/plans', {
    itemId: docs.sheet.id, itemCode: docs.sheet.code, itemName: docs.sheet.name, stage: 'incoming', name: 'ตรวจรับเหล็กแผ่น', samplingMode: 'fixed', samplingValue: 5,
    checkpoints: [{ name: 'ความหนา', type: 'measure', unit: 'มม.', min: 1.95, max: 2.05, critical: true }, { name: 'สนิม/รอยขีดข่วน', type: 'visual' }],
  });
  // expense categories, approval type
  docs.fuel = await ok('admin', 'POST', 'expense/categories', { code: 'FUEL', name: 'ค่าน้ำมัน' });
  ids.prType = (await ok('admin', 'POST', 'approvals/types', { code: 'PR', name: 'ขอซื้อ', approvers: [{ userId: users.sup.id, userName: users.sup.name }] })).id;
  // pay profiles (HR keys them in from the old payroll program; E-002 has year-to-date figures from before go-live)
  const before = monthNo - 1;
  docs.e1 = await ok('hr', 'POST', 'payroll/profiles', { employeeCode: 'E-001', employeeName: users.staff.name, userId: users.staff.id, userName: users.staff.name, baseSalary: 12000, startDate: '2024-01-15', bankName: 'กสิกรไทย', bankAccount: '123-4-56789-0' });
  docs.e2 = await ok('hr', 'POST', 'payroll/profiles', {
    employeeCode: 'E-002', employeeName: users.sup.name, userId: users.sup.id, userName: users.sup.name, baseSalary: 50000, startDate: '2020-06-01', taxSpouse: true,
    openingYear: year, openingIncome: 50000 * before, openingSso: 750 * before, openingTax: Math.round((14600 * before / 12) * 100) / 100,
  });
  docs.e3 = await ok('hr', 'POST', 'payroll/profiles', { employeeCode: 'E-003', employeeName: 'บุญมี รายวัน', payType: 'daily', dailyWage: 400, startDate: '2025-03-01', bankName: 'กรุงไทย', bankAccount: '222-0-11111-9' });
  // automation: personal alerts when a claim is paid (in the bell + the claimant's own LINE)
  await ok('admin', 'POST', 'automation/templates/expense-paid-to-claimant/apply', {});
}

beforeAll(async () => {
  lineApi = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      lineSent.push({ path: req.url ?? '', body: raw ? JSON.parse(raw) : null });
      res.setHeader('content-type', 'application/json');
      res.end(req.url?.startsWith('/v2/bot/profile/') ? JSON.stringify({ displayName: 'Somchai LINE' }) : '{}');
    });
  });
  await new Promise<void>((r) => lineApi.listen(0, '127.0.0.1', () => r()));
  const lineUrl = `http://127.0.0.1:${(lineApi.address() as AddressInfo).port}`;
  browser = await chromium.launch({ executablePath: CHROMIUM });
  erp = await install([identity, masterData, inventory, purchasing, sales, automation, quality, approvals, expense, hr, helpdesk, accounting, payroll, contracts],
    { LINE_CHANNEL_SECRET: LINE_SECRET, LINE_CHANNEL_ACCESS_TOKEN: 'uat-line-token', LINE_API_URL: lineUrl, LINE_OA_ID: '@goalong-uat' });
  ({ token: admin } = await erp.provision(TENANT));
  await seed();
  web = await startWeb(erp.url, PORT);
  // reduced motion: GSAP row reveals would otherwise be caught half-way in the screenshots
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
});

afterAll(async () => {
  if (Object.keys(shots).length) saveShots();
  await browser?.close();
  stopWeb(web);
  await erp?.close();
  lineApi?.close();
});

describe('UAT — finance, payroll, contracts (uat-finance)', () => {
  /* ---------------- company profile & roles ---------------- */

  it('UAT-48 ตั้งค่าข้อมูลบริษัทสำหรับหัวเอกสาร: เลขผู้เสียภาษีผิดบันทึกไม่ได้', async () => {
    await as(page, 'admin');
    await open(page, '/m/identity/companyEdit');
    await page.getByLabel('ชื่อนิติบุคคล (ภาษาไทย)').fill('บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด');
    await page.getByLabel('ชื่อภาษาอังกฤษ').fill('GO Along Manufacturing Co., Ltd.');
    await page.getByLabel('เลขประจำตัวผู้เสียภาษี').fill('0105560001234'); // wrong check digit
    await page.getByLabel('ที่อยู่').fill('99/9 หมู่ 5 ถ.เทพารักษ์ ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540');
    await page.getByLabel('โทรศัพท์').fill('02-123-4567');
    await page.getByRole('button', { name: 'บันทึกข้อมูลบริษัท' }).click();
    await page.locator('.field-error, .form-error').first().waitFor();
    expect((await page.locator('.field-error, .form-error').allInnerTexts()).join(' ')).toContain('เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง');
    await shot(page, 'UAT-48');
    await page.getByLabel('เลขประจำตัวผู้เสียภาษี').fill('0105560001235');
    await page.getByRole('button', { name: 'บันทึกข้อมูลบริษัท' }).click();
    await page.getByRole('heading', { name: 'บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด' }).waitFor();
    expect(await fact(page, 'สำนักงานใหญ่ / สาขา')).toContain('สำนักงานใหญ่');
    expect(await fact(page, 'ตั้งค่าแล้ว')).toContain('ใช่');
    await shot(page, 'UAT-48');
    expect((await api('staff', 'PUT', 'identity/company', { legalName: 'บริษัทปลอม', address: 'x' })).status).toBe(403);
  });

  it('UAT-49 สร้างบทบาทจากแม่แบบ "บัญชีและการเงิน" เฉพาะโมดูลที่ติดตั้ง', async () => {
    await open(page, '/m/identity/roles');
    await page.getByRole('button', { name: 'สร้างบทบาทจากแม่แบบ' }).click();
    const dlg = page.getByRole('dialog');
    await pick(page, dlg, 'แม่แบบ', 'บัญชีและการเงิน');
    await dlg.getByLabel('ชื่อบทบาท').fill('บัญชี (พนักงานใหม่)');
    await shot(page, 'UAT-49');
    await dialogAction(page, 'สร้างบทบาทจากแม่แบบ');
    await page.getByRole('row').filter({ hasText: 'บัญชี (พนักงานใหม่)' }).waitFor();
    const role = (await ok('admin', 'GET', 'identity/roles')).find((r: any) => r.name === 'บัญชี (พนักงานใหม่)');
    expect(role.permissions).toEqual(expect.arrayContaining(['accounting.period.close', 'accounting.report.read', 'contracts.billing.write', 'sales.order.write', 'payroll.run.pay']));
    expect(role.permissions.some((p: string) => p.startsWith('assets.') || p.startsWith('costing.'))).toBe(false); // not installed here
    await shot(page, 'UAT-49');
    // a new hire with that role sees the accounting menus, not the admin ones
    await ok('admin', 'POST', 'identity/users', { email: 'newacc@finance.co.th', name: 'น้องใหม่ บัญชี', password: PASSWORD, roleIds: [role.id] });
    await logout(page, base);
    signedIn.delete(page);
    await login(page, base, TENANT, 'newacc@finance.co.th', PASSWORD);
    signedIn.set(page, 'newacc');
    await open(page, '/m/accounting/jvList');
    const group = page.locator('#nav-accounting');
    await group.getByRole('link', { name: 'งบทดลอง' }).waitFor();
    expect(await group.getByRole('link', { name: 'ปิดงวดบัญชี' }).count()).toBe(1);
    const rail = page.getByLabel('โมดูล');
    expect(await rail.getByRole('link', { name: 'บัญชี', exact: true }).count()).toBe(1);
    expect(await rail.getByRole('link', { name: 'ผู้ใช้และสิทธิ์' }).count()).toBe(0);
    await shot(page, 'UAT-49');
  });

  /* ---------------- payroll ---------------- */

  it('UAT-50 ทำเงินเดือน 3 แบบ: เงินเดือนต่ำ, ชนเพดานประกันสังคม, รายวัน + OT', async () => {
    await as(page, 'hr');
    await open(page, '/m/payroll/runNew');
    await page.getByLabel('งวดเดือน').fill(thisMonth);
    await page.getByLabel('วันที่จ่าย').fill(today);
    await page.getByRole('button', { name: 'สร้างรอบเงินเดือน' }).click();
    await page.getByRole('heading', { name: new RegExp(`^PR-${year + 543}-${thisMonth.slice(5)}`) }).waitFor();
    ids.run = page.url().split('/').pop()!;
    const run0 = await ok('hr', 'GET', `payroll/runs/${ids.run}`);
    expect(run0.lines.map((l: any) => l.employee_code)).toEqual(['E-001', 'E-002', 'E-003']);
    // the daily worker's month: 26 days + 10 h OT at 1.5×
    await ok('hr', 'PUT', `payroll/payslips/${run0.lines.find((l: any) => l.employee_code === 'E-003').id}/inputs`, { workDays: 26, ot15Hours: 10 });
    await page.reload();
    await page.getByRole('button', { name: 'คำนวณเงินเดือน' }).click();
    await page.locator('.status', { hasText: 'คำนวณแล้ว' }).first().waitFor();
    expect(await page.getByRole('button', { name: 'อนุมัติจ่ายเงินเดือน' }).count()).toBe(0); // HR prepares, the owner approves
    await shot(page, 'UAT-50');
    const run = await ok('hr', 'GET', `payroll/runs/${ids.run}`);
    const line = (code: string) => run.lines.find((l: any) => l.employee_code === code);
    expect(line('E-001')).toMatchObject({ gross: 12000, sso_employee: 600, sso_employer: 600, wht: 0, net: 11400 });
    expect(line('E-002')).toMatchObject({ gross: 50000, sso_wage: 50000, sso_employee: 750, sso_employer: 750 }); // capped at 15,000 × 5%
    expect(line('E-002').wht).toBeGreaterThan(1216.6);
    expect(line('E-002').wht).toBeLessThan(1216.8);
    expect(line('E-003')).toMatchObject({ salary: 10400, overtime: 750, gross: 11150, sso_wage: 10400, sso_employee: 520 }); // OT is not SSO wage
    expect((await api('hr', 'POST', `payroll/runs/${ids.run}/approve`, {})).status).toBe(403);

    await as(phone, 'owner');
    await open(phone, `/m/payroll/runDetail/${ids.run}`);
    await phone.getByRole('button', { name: 'อนุมัติจ่ายเงินเดือน' }).click();
    await dialogAction(phone, 'อนุมัติจ่ายเงินเดือน');
    await phone.locator('.status', { hasText: 'อนุมัติแล้ว' }).first().waitFor();
    await shot(phone, 'UAT-50', 'phone');

    await as(page, 'acc');
    await open(page, `/m/payroll/runDetail/${ids.run}`);
    await page.getByRole('button', { name: 'บันทึกจ่ายเงินเดือนแล้ว' }).click();
    await page.getByRole('dialog').getByLabel('วันที่โอน (เว้นว่าง = วันนี้)').fill(today);
    await page.getByRole('dialog').getByLabel('อ้างอิงการโอน').fill('KBANK-PAYROLL-01');
    await dialogAction(page, 'บันทึกจ่ายเงินเดือนแล้ว');
    await page.locator('.status', { hasText: 'จ่ายแล้ว' }).first().waitFor();
    expect(await fact(page, 'จ่ายสุทธิ')).toContain(money(run.net));
    await shot(page, 'UAT-50');
    await erp.settle();
    const jv = (await ok('acc', 'GET', 'accounting/journals?source=payroll.run_paid'))[0];
    expect(jv).toMatchObject({ entry_date: today, status: 'posted' });
  });

  it('UAT-51 พนักงานเห็นสลิปของตัวเองเท่านั้น และพิมพ์ 50 ทวิ ของตัวเองได้', async () => {
    await as(phone, 'staff');
    await open(phone, '/m/payroll/myPayslips');
    const rows = phone.locator('.screen').getByText(/11,400\.00/);
    await rows.first().waitFor();
    const mine = await ok('staff', 'GET', 'payroll/my-payslips');
    expect(mine.map((s: any) => s.employee_code)).toEqual(['E-001']);
    await shot(phone, 'UAT-51', 'phone');
    await open(phone, `/m/payroll/myPayslip/${mine[0].id}`);
    expect(await fact(phone, 'เงินได้สุทธิ')).toContain('11,400.00');
    await shot(phone, 'UAT-51', 'phone');
    // someone else's payslip (the supervisor's) and the HR list are closed to him
    const supSlip = (await ok('sup', 'GET', 'payroll/my-payslips'))[0];
    expect((await api('staff', 'GET', `payroll/my-payslips/${supSlip.id}`)).status).toBe(404);
    expect((await api('staff', 'GET', 'payroll/payslips')).status).toBe(403);
    expect((await api('staff', 'GET', `payroll/certificates/${docs.e2.id}_${year}`)).status).toBe(404);

    await open(phone, '/m/payroll/myCertificates');
    await phone.locator('.screen').getByText(String(year + 543)).first().click();
    await phone.waitForURL(/\/m\/payroll\/myCertificate\//);
    await phone.getByText('ผู้ถูกหักภาษี ณ ที่จ่าย').first().waitFor();
    expect(await fact(phone, 'ผู้ถูกหักภาษี ณ ที่จ่าย')).toContain(users.staff.name);
    await phone.emulateMedia({ media: 'print' });
    const head = phone.locator('.print-letterhead');
    await head.waitFor();
    const printed = await head.innerText();
    expect(printed).toContain('บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด');
    expect(printed).toContain('0-1055-60001-23-5');
    expect(printed).toContain('หนังสือรับรองการหักภาษี ณ ที่จ่าย (50 ทวิ)');
    await shot(phone, 'UAT-51', 'phone');
    await phone.emulateMedia({ media: 'screen' });
  });

  /* ---------------- sales: tax invoice, receipts ---------------- */

  it('UAT-52 ใบกำกับภาษีพิมพ์พร้อมหัวกระดาษบริษัท และรับชำระหัก ณ ที่จ่าย 3%', async () => {
    // last month's sale (still unpaid at month end) and this month's installation job
    docs.prevInv = await invoiceFor('acc', docs.customer, 'งานซ่อมบำรุงตามใบสั่ง', 20000, prevMonthMid);
    docs.inv = await invoiceFor('acc', docs.customer, 'ค่าบริการติดตั้งเครื่องจักร', 100000, today);
    await as(page, 'acc');
    await open(page, `/m/sales/invoice/${docs.inv.id}`);
    expect(await fact(page, 'รวมทั้งสิ้น')).toContain('107,000.00');
    await page.emulateMedia({ media: 'print' });
    const head = await page.locator('.print-letterhead').innerText();
    expect(head).toContain('บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด');
    expect(head).toContain('99/9 หมู่ 5 ถ.เทพารักษ์');
    expect(head).toContain('เลขประจำตัวผู้เสียภาษี 0-1055-60001-23-5');
    expect(head).toContain('สำนักงานใหญ่');
    expect(head).toContain('ใบกำกับภาษี / ใบแจ้งหนี้');
    expect(head).toContain(docs.inv.no);
    const buyer = await page.locator('.print-buyer').innerText();
    expect(buyer).toContain('บริษัท ลูกค้าชั้นดี จำกัด');
    expect(buyer).toContain('0-1055-58123-45-1');
    await shot(page, 'UAT-52');
    await page.emulateMedia({ media: 'screen' });

    // receipt dated before the invoice → refused
    expect((await api('acc', 'POST', 'sales/receipts', { method: 'transfer', receiptDate: addDays(today, -40), lines: [{ invoiceId: docs.inv.id, amount: 100 }] })).status).toBe(400);
    await open(page, '/m/sales/receiptNew');
    await page.getByLabel('วันที่รับเงิน').fill(today);
    await page.getByLabel('ชำระโดย').selectOption('transfer');
    await page.getByLabel('เลขที่เช็ค / อ้างอิงการโอน').fill('SCB-778899');
    await page.getByLabel('หัก ณ ที่จ่าย').selectOption('3');
    const row = page.locator('.lines-editor tbody tr').first();
    await pick(page, row, 'ใบกำกับ', docs.inv.no);
    await expect.poll(() => row.getByLabel('รับชำระ (รวม VAT)').inputValue()).toBe('107000');
    await shot(page, 'UAT-52');
    await page.getByRole('button', { name: 'ออกใบเสร็จ' }).click();
    await page.getByRole('heading', { name: /^RC-/ }).waitFor();
    expect(await fact(page, 'หัก ณ ที่จ่าย')).toContain('3,000.00');
    expect(await fact(page, 'รับเงินสุทธิ')).toContain('104,000.00');
    docs.receipt = { id: page.url().split('/').pop()! };
    await shot(page, 'UAT-52');
  });

  /* ---------------- accounting: the month ---------------- */

  it('UAT-53 ปิดเดือน: ลงบัญชีอัตโนมัติจากขาย/ซื้อ/เบิก/เงินเดือน แล้วงบทดลองสมดุล', async () => {
    // purchases with VAT: 100 sheets × 200 (received this month)
    const po = await ok('buyer', 'POST', 'purchasing/purchase-orders', { supplierId: docs.supplier.id, supplierName: docs.supplier.name, lines: [{ itemId: docs.sheet.id, itemCode: docs.sheet.code, qty: 100, unitPrice: 200 }] });
    await ok('owner', 'POST', `purchasing/purchase-orders/${po.id}/approve`);
    await ok('buyer', 'POST', `purchasing/purchase-orders/${po.id}/receive`, {});
    docs.po = po;
    // an employee's fuel claim with VAT, approved by the head and paid by finance
    const claim = await ok('staff2', 'POST', 'expense/claims', { purpose: 'ส่งเอกสารให้ลูกค้า', submit: true, lines: [{ expenseDate: today, categoryId: docs.fuel.id, amount: 1000, vat: 70, receiptNo: 'PTT-123' }] });
    await ok('sup', 'POST', `expense/claims/${claim.id}/approve`, {});
    await ok('acc', 'POST', `expense/claims/${claim.id}/pay`, { method: 'transfer', paidDate: today, reference: 'KBANK-EXP-1' });
    await erp.settle();

    await as(page, 'acc');
    await open(page, '/m/accounting/jvList');
    for (const ref of [docs.prevInv.no, docs.inv.no, po.no, claim.no, `PR-${year + 543}-${thisMonth.slice(5)}`]) {
      await page.getByRole('row').filter({ hasText: ref }).first().waitFor();
    }
    await shot(page, 'UAT-53');
    const sources = (await ok('acc', 'GET', 'accounting/journals')).map((j: any) => j.source_type);
    expect(new Set(sources)).toEqual(new Set(['sales.invoiced', 'sales.payment_received', 'purchasing.goods_received', 'expense.claim_paid', 'payroll.run_paid']));
    const rcJv = (await ok('acc', 'GET', 'accounting/journals?source=sales.payment_received'))[0];
    expect(rcJv.entry_date).toBe(today); // posted on the receipt's date
    expect(await ok('acc', 'GET', 'accounting/posting-errors')).toEqual([]);

    await open(page, `/m/accounting/trialBalance?asOf=${today}`);
    await page.locator('.report-check').getByText('งบทดลองสมดุล — เดบิตเท่ากับเครดิต').waitFor();
    const tb = await ok('acc', 'GET', `accounting/reports/trial-balance?asOf=${today}`);
    expect(tb.totals.difference).toBe(0);
    const bal = (code: string) => tb.rows.find((r: any) => r.code === code);
    expect(bal('11300')).toMatchObject({ debit: 21400 }); // only last month's invoice is still owed
    expect(bal('11600')).toMatchObject({ debit: 3000 }); // WHT the customer withheld
    expect(bal('21200')).toMatchObject({ credit: 1400 + 7000 }); // output VAT
    expect(bal('11500')).toMatchObject({ debit: 1400 + 70 }); // input VAT: goods + fuel
    expect(bal('21100')).toMatchObject({ credit: 21400 }); // owed to the steel supplier
    await shot(page, 'UAT-53');
    await open(page, `/m/accounting/balanceSheet?asOf=${today}`);
    await page.locator('.report-check').getByText('สินทรัพย์ = หนี้สิน + ส่วนของผู้ถือหุ้น').waitFor();
    await shot(page, 'UAT-53');
  });

  it('UAT-54 รายงานภาษีซื้อ-ขาย (ภ.พ.30) และภาษีถูกหัก ณ ที่จ่าย', async () => {
    const vat = await ok('acc', 'GET', `accounting/reports/vat?year=${year}`);
    const m = vat.rows.find((r: any) => r.month === thisMonth);
    expect(m).toMatchObject({ output_vat: 7000, input_vat: 1470, net: 5530 });
    await open(page, `/m/accounting/vatReport?year=${year}`);
    await page.getByRole('row').filter({ hasText: '7,000.00' }).first().waitFor();
    await shot(page, 'UAT-54');
    const wht = await ok('acc', 'GET', `accounting/reports/wht-received?year=${year}`);
    expect(wht.months).toEqual([expect.objectContaining({ month: thisMonth, amount: 3000 })]);
    await open(page, `/m/accounting/whtReceived?year=${year}`);
    await page.getByRole('row').filter({ hasText: 'บริษัท ลูกค้าชั้นดี จำกัด' }).filter({ hasText: '3,000.00' }).first().waitFor();
    await shot(page, 'UAT-54');
  });

  it('UAT-55 ปิดงวดเดือนก่อน: บันทึกย้อนหลังไม่ได้ จนกว่าจะเปิดงวด', async () => {
    await open(page, `/m/accounting/periods?year=${prevMonth.slice(0, 4)}`);
    const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'ปิดงวด' }) }).nth(Number(prevMonth.slice(5)) - 1);
    await row.getByRole('button', { name: 'ปิดงวด' }).click();
    await dialogAction(page, 'ปิดงวด');
    await expect.poll(async () => (await ok('acc', 'GET', `accounting/periods?year=${prevMonth.slice(0, 4)}`)).find((p: any) => p.period === prevMonth)?.status).toBe('closed');
    await shot(page, 'UAT-55');
    // a JV dated in the closed month is refused
    const accId = async (code: string) => (await ok('acc', 'GET', `accounting/accounts?q=${code}`)).find((a: any) => a.code === code).id;
    const jv = await api('acc', 'POST', 'accounting/journals', { entryDate: prevMonthEnd, description: 'ค่าเช่าค้างจ่าย', post: true, lines: [{ accountId: await accId('52200'), debit: 5000 }, { accountId: await accId('21500'), credit: 5000 }] });
    expect(jv.status).toBe(409);
    expect(jv.body.error.message).toContain('ปิดแล้ว');
    // sales issues a late invoice dated last month: it lands in "posting errors", not silently in this month
    docs.lateInv = await invoiceFor('acc', docs.customer, 'ค่าขนส่ง (ออกย้อนหลัง)', 1000, prevMonthEnd);
    await erp.settle();
    await open(page, '/m/accounting/postingErrors');
    const err = page.getByRole('row').filter({ hasText: docs.lateInv.no });
    await err.waitFor();
    expect(await err.innerText()).toContain('ปิดแล้ว');
    await shot(page, 'UAT-55');
    // reopen, retry → posted on the invoice date
    await open(page, `/m/accounting/periods?year=${prevMonth.slice(0, 4)}`);
    await page.getByRole('button', { name: 'เปิดงวดอีกครั้ง' }).click();
    await dialogAction(page, 'เปิดงวดอีกครั้ง');
    await expect.poll(async () => (await ok('acc', 'GET', `accounting/periods?year=${prevMonth.slice(0, 4)}`)).find((p: any) => p.period === prevMonth)?.status).toBe('open');
    await open(page, '/m/accounting/postingErrors');
    await page.getByRole('row').filter({ hasText: docs.lateInv.no }).getByRole('button', { name: 'ลงบัญชีอีกครั้ง' }).click();
    await page.locator('.toast').filter({ hasText: 'ลงบัญชีแล้ว' }).first().waitFor();
    const late = (await ok('acc', 'GET', 'accounting/journals?source=sales.invoiced')).find((j: any) => j.ref === docs.lateInv.no);
    expect(late.entry_date).toBe(prevMonthEnd);
    await shot(page, 'UAT-55');
  });

  it('UAT-56 ลูกหนี้ตามอายุ ณ สิ้นเดือนก่อน เทียบกับวันนี้', async () => {
    await open(page, `/m/sales/aging?asOf=${prevMonthEnd}`);
    const row = page.getByRole('row').filter({ hasText: 'บริษัท ลูกค้าชั้นดี จำกัด' });
    await row.waitFor();
    const atMonthEnd = await ok('acc', 'GET', `sales/receivables/aging?asOf=${prevMonthEnd}`);
    // only last month's invoices existed then (this month's 107,000 job did not)
    expect(atMonthEnd.totals.total).toBe(21400 + 1070);
    await shot(page, 'UAT-56');
    await open(page, '/m/sales/aging');
    const now = await ok('acc', 'GET', 'sales/receivables/aging');
    expect(now.totals.total).toBe(21400 + 1070); // the 107,000 invoice was paid this month
    await page.getByRole('row').filter({ hasText: 'บริษัท ลูกค้าชั้นดี จำกัด' }).waitFor();
    await shot(page, 'UAT-56');
  });

  /* ---------------- MA contracts ---------------- */

  it('UAT-57 สัญญา MA: สร้างนัด PM ซ้ำไม่เกิดซ้ำ และกลายเป็นใบงาน PM ของช่าง', async () => {
    const start = `${thisMonth}-01`;
    const end = addDays(`${String(year + 1)}-${thisMonth.slice(5)}-01`, -1);
    const ct = await ok('mgr', 'POST', 'contracts/contracts', {
      customerId: docs.hotel.id, customerCode: 'C-002', customerName: docs.hotel.name, title: 'MA กล้องวงจรปิด 32 จุด', startDate: start, endDate: end,
      value: 120000, billingPlan: 'quarterly', pmEveryMonths: 3, checklist: ['ทำความสะอาดเลนส์', 'ตรวจ NVR และฮาร์ดดิสก์'],
      technicianId: users.tech.id, technicianName: users.tech.name, items: [{ asset: 'NVR 32ch', serialNo: 'NVR-55801', location: 'ห้อง Server' }],
    });
    ids.contract = ct.id;
    await as(page, 'mgr');
    await open(page, `/m/contracts/contract/${ct.id}`);
    await page.getByRole('button', { name: 'เปิดใช้สัญญา' }).click();
    await dialogAction(page, 'เปิดใช้สัญญา');
    await page.locator('.status', { hasText: 'มีผล' }).first().waitFor();
    const active = await ok('mgr', 'GET', `contracts/contracts/${ct.id}`);
    expect(active.installments.map((i: any) => i.amount)).toEqual([30000, 30000, 30000, 30000]);
    const until = addDays(today, 180);
    for (const n of [1, 2]) {
      await page.getByRole('button', { name: 'สร้างนัด PM' }).click();
      await page.getByRole('dialog').getByLabel('สร้างนัดถึงวันที่').fill(until);
      await dialogAction(page, 'สร้างนัด PM');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      if (n === 1) await shot(page, 'UAT-57');
    }
    const visits = await ok('mgr', 'GET', `contracts/visits?contractId=${ct.id}`);
    expect(visits.length).toBe(2); // start + 3 months within 180 days — the second click created nothing
    await erp.settle();
    await page.reload();
    await shot(page, 'UAT-57');

    await as(phone, 'tech');
    await open(phone, '/m/helpdesk/myTickets');
    await expect.poll(() => phone.getByText(`PM ${active.no} — ${docs.hotel.name}`).count()).toBe(2);
    const pm = (await ok('tech', 'GET', 'helpdesk/tickets/mine')).filter((t: any) => t.category_name === 'PM ตามสัญญา');
    expect(pm).toHaveLength(2);
    expect(pm.every((t: any) => t.assignee_name === users.tech.name)).toBe(true);
    await shot(phone, 'UAT-57', 'phone');
  });

  it('UAT-58 งวดสัญญาถึงกำหนด → ร่างใบสั่งขาย → บัญชียืนยัน ออกใบกำกับ แล้วบันทึกวางบิล', async () => {
    await as(page, 'acc');
    await open(page, '/m/contracts/billingDue');
    for (let n = 0; n < 2; n++) {
      await page.getByRole('button', { name: 'ส่งให้ฝ่ายขายร่างใบสั่งขาย' }).click();
      await dialogAction(page, 'ส่งให้ฝ่ายขายร่างใบสั่งขาย');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
    await erp.settle();
    const contract = await ok('acc', 'GET', `contracts/contracts/${ids.contract}`);
    const orders = await ok('acc', 'GET', `sales/orders?q=${contract.no}`);
    expect(orders).toHaveLength(1);
    expect(orders[0]).toMatchObject({ status: 'draft', net: 30000, vat: 2100, gross: 32100, ref: `${contract.no} งวด 1/4` });
    await shot(page, 'UAT-58');
    await open(page, `/m/sales/soDetail/${orders[0].id}`);
    await page.getByRole('button', { name: 'ยืนยันคำสั่งซื้อ' }).click();
    await expect.poll(async () => (await ok('acc', 'GET', `sales/orders/${orders[0].id}`)).status).toBe('confirmed');
    const inv = await ok('acc', 'POST', `sales/orders/${orders[0].id}/invoice`, {});
    await shot(page, 'UAT-58');
    await open(page, '/m/contracts/billingDue');
    const row = page.getByRole('row').filter({ hasText: contract.no }).first();
    await row.getByRole('button', { name: 'บันทึกวางบิลแล้ว' }).click();
    await page.getByRole('dialog').getByLabel('เลขที่ใบแจ้งหนี้/ใบกำกับ (ฝ่ายขาย)').fill(inv.no);
    await dialogAction(page, 'บันทึกวางบิลแล้ว');
    await expect.poll(async () => (await ok('acc', 'GET', `contracts/contracts/${ids.contract}`)).installments[0]).toMatchObject({ invoiced: true, invoice_no: inv.no });
    await open(page, `/m/contracts/contract/${ids.contract}`);
    await page.getByRole('cell', { name: inv.no }).waitFor();
    await shot(page, 'UAT-58');
  });

  /* ---------------- LINE, attachments, audit ---------------- */

  it('UAT-59 ผูก LINE ของฉัน แล้วรับแจ้งเตือนส่วนตัวทาง LINE', async () => {
    await as(phone, 'staff');
    await open(phone, '/m/automation/lineMe');
    await phone.getByRole('button', { name: 'ขอรหัสผูกบัญชี' }).click();
    await phone.locator('.toast').filter({ hasText: 'รหัสของคุณ' }).first().waitFor();
    const me = await ok('staff', 'GET', 'automation/line/me');
    expect(me.code).toMatch(/^\d{6}$/);
    await phone.getByText(`ผูกบัญชี ${me.code}`).first().waitFor();
    await shot(phone, 'UAT-59', 'phone');
    // the employee types the code to the company's LINE OA → LINE calls our webhook
    const key = (await ok('admin', 'GET', 'automation/line/settings')).webhook_url.split('/').pop();
    const thaiDigits = me.code.replace(/\d/g, (d: string) => '๐๑๒๓๔๕๖๗๘๙'[Number(d)]);
    const body = JSON.stringify({ events: [{ type: 'message', replyToken: 'r-1', source: { type: 'user', userId: 'U-somchai' }, message: { type: 'text', text: `ผูกบัญชี ${thaiDigits}` } }] });
    const res = await fetch(`${erp.url}/api/automation/line/webhook/${key}`, {
      method: 'POST', body, headers: { 'content-type': 'application/json', 'x-line-signature': createHmac('sha256', LINE_SECRET).update(body).digest('base64') },
    });
    expect(res.status).toBe(200);
    await phone.reload();
    await phone.getByRole('heading', { name: 'ผูก LINE แล้ว' }).waitFor();
    expect(await fact(phone, 'ชื่อใน LINE')).toContain('Somchai LINE');
    expect(await ok('staff', 'GET', 'automation/line/me')).toMatchObject({ linked: true });
    await shot(phone, 'UAT-59', 'phone');
    // finance pays one of his claims → a push to HIS LINE only, and a personal bell item only he sees
    const claim = await ok('staff', 'POST', 'expense/claims', { purpose: 'ค่าน้ำมันไปหาลูกค้า', submit: true, lines: [{ expenseDate: today, categoryId: docs.fuel.id, amount: 450 }] });
    await ok('sup', 'POST', `expense/claims/${claim.id}/approve`, {});
    await ok('acc', 'POST', `expense/claims/${claim.id}/pay`, { method: 'transfer' });
    await erp.settle();
    const push = lineSent.filter((m) => m.path === '/v2/bot/message/push' && JSON.stringify(m.body).includes(claim.no));
    expect(push).toHaveLength(1);
    expect(push[0].body.to).toBe('U-somchai');
    expect(push[0].body.messages[0].text).toContain('จ่ายเงินแล้ว');
    const bell = async (who: string) => (await ok(who, 'GET', 'automation/notifications')).items.some((n: any) => `${n.title} ${n.body}`.includes(claim.no));
    expect(await bell('staff')).toBe(true);
    expect(await bell('staff2')).toBe(false);
    expect(await bell('acc')).toBe(false);
  });

  it('UAT-60 แนบใบเสร็จกับใบเบิก: คนอื่นเปิดไม่ได้ และหลังจ่ายแล้วลบ/เปลี่ยนไม่ได้', async () => {
    const claim = await ok('staff', 'POST', 'expense/claims', { purpose: 'ค่าน้ำมันรถส่งของ', submit: true, lines: [{ expenseDate: today, categoryId: docs.fuel.id, amount: 800, vat: 56, receiptNo: 'BCP-55' }] });
    await as(page, 'staff');
    await open(page, `/m/expense/claimDetail/${claim.id}`);
    const panel = page.getByRole('region', { name: 'ใบเสร็จ / หลักฐาน' });
    await panel.locator('input[type=file]').setInputFiles({ name: 'ใบเสร็จน้ำมัน.png', mimeType: 'image/png', buffer: PNG });
    const item = panel.locator('.att-item', { hasText: 'ใบเสร็จน้ำมัน.png' });
    await item.waitFor();
    expect(await item.innerText()).toContain(users.staff.name);
    await shot(page, 'UAT-60');
    const [file] = await ok('staff', 'GET', `expense/_attachments?ref=claim:${claim.id}`);
    // another employee: neither the claim nor the file
    expect((await api('staff2', 'GET', `expense/claims/${claim.id}`)).status).toBe(404);
    expect((await api('staff2', 'GET', `expense/_attachments/${file.id}/content`)).status).toBe(404);
    expect((await api('staff2', 'GET', `expense/_attachments/${file.id}/link`)).status).toBe(404);
    // the approver and finance can open it
    const res = await fetch(`${erp.url}/api/expense/_attachments/${file.id}/content`, { headers: { authorization: `Bearer ${users.acc.token}` } });
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(PNG)).toBe(true);
    await ok('sup', 'POST', `expense/claims/${claim.id}/approve`, {});
    await ok('acc', 'POST', `expense/claims/${claim.id}/pay`, { method: 'transfer' });
    await page.reload();
    await item.waitFor();
    expect(await panel.getByRole('button', { name: 'ลบ ใบเสร็จน้ำมัน.png' }).count()).toBe(0);
    const del = await api('staff', 'DELETE', `expense/_attachments/${file.id}`);
    expect(del.status).toBe(409);
    expect((await api('staff', 'POST', 'expense/_attachments', { ref: `claim:${claim.id}`, fileName: 'ใบใหม่.png', dataBase64: PNG.toString('base64') })).status).toBe(409);
    await shot(page, 'UAT-60');
    // finance still attaches the transfer slip
    expect((await api('acc', 'POST', 'expense/_attachments', { ref: `claim:${claim.id}`, fileName: 'สลิปโอนเงิน.png', dataBase64: PNG.toString('base64') })).status).toBe(201);
  });

  it('UAT-61 ประวัติการแก้ไขแสดงใครแก้อะไร (และไม่เก็บเลขบัญชีเต็ม)', async () => {
    await as(page, 'hr');
    await open(page, `/m/payroll/profileEdit/${docs.e3.id}`);
    await page.getByLabel('ค่าจ้างรายวัน').fill('420');
    await page.getByLabel(/เลขบัญชี/).fill('333-0-77777-1');
    await page.getByRole('button', { name: /บันทึก/ }).first().click();
    await page.getByRole('heading', { name: 'บุญมี รายวัน' }).waitFor();
    expect(await page.locator('details.audit-trail').count()).toBe(0); // HR has no payroll.audit.read
    await as(page, 'admin');
    await open(page, `/m/payroll/profileDetail/${docs.e3.id}`);
    await page.locator('details.audit-trail summary').click();
    const trail = page.locator('details.audit-trail');
    await trail.getByRole('row').filter({ hasText: users.hr.name }).first().waitFor();
    const txt = await trail.innerText();
    expect(txt).toContain('dailyWage: 420');
    expect(txt).not.toContain('77777');
    await shot(page, 'UAT-61');
    const log = await ok('admin', 'GET', `payroll/_audit?ref=${docs.e3.id}`);
    expect(log[0]).toMatchObject({ user_name: users.hr.name, summary: expect.objectContaining({ dailyWage: 420, bankAccount: '••••7771' }) });
    expect(JSON.stringify(log)).not.toMatch(/11111|77777/);
  });

  /* ---------------- approvals delegation ---------------- */

  it('UAT-62 มอบอำนาจอนุมัติแทนช่วงลา ผู้รับมอบอนุมัติแทนได้', async () => {
    await as(phone, 'sup');
    await open(phone, '/m/approvals/delegationNew');
    await pick(phone, phone.locator('.form-grid'), 'ผู้อนุมัติแทน', users.sup2.name);
    await phone.getByLabel('ตั้งแต่วันที่').fill(today);
    await phone.getByLabel('ถึงวันที่').fill(addDays(today, 1));
    await phone.getByLabel('หมายเหตุ').fill('ลาพักร้อน');
    await phone.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await phone.getByText(users.sup2.name).first().waitFor();
    await shot(phone, 'UAT-62', 'phone');
    expect((await api('sup', 'POST', 'approvals/delegations', { toUserId: users.sup.id, startsOn: addDays(today, 5), endsOn: addDays(today, 6) })).status).toBe(400);
    expect((await api('sup', 'POST', 'approvals/delegations', { toUserId: users.sup2.id, startsOn: '2020-01-01', endsOn: '2020-01-02' })).status).toBe(400);

    const req = await ok('staff', 'POST', 'approvals/requests', { typeId: ids.prType, title: 'ขอซื้อเครื่องวัดความหนา', amount: 18500, submit: true });
    await as(page, 'sup2');
    await open(page, '/m/approvals/inbox');
    const row = page.getByRole('row').filter({ hasText: req.no });
    await row.waitFor();
    expect(await row.innerText()).toContain(users.sup.name); // อนุมัติแทน
    await shot(page, 'UAT-62');
    await row.getByRole('button', { name: 'อนุมัติ' }).click();
    await dialogAction(page, 'อนุมัติ');
    await page.getByText('ไม่มีคำขอที่รอคุณอนุมัติ').waitFor();
    const done = await ok('staff', 'GET', `approvals/requests/${req.id}`);
    expect(done.status).toBe('approved');
    expect(done.steps[0]).toMatchObject({ acted_by_name: users.sup2.name });
    expect(done.history.map((h: any) => h.action_label)).toContain(`อนุมัติ (แทน ${users.sup.name})`);
    await open(page, `/m/approvals/requestDetail/${req.id}`);
    await page.getByText(`อนุมัติ (แทน ${users.sup.name})`).first().waitFor();
    await shot(page, 'UAT-62');
  });

  /* ---------------- QC-HOLD → purchase return ---------------- */

  it('UAT-63 ตรวจรับไม่ผ่าน ของเข้าคลังกักกัน QC-HOLD (ไม่นับพร้อมใช้)', async () => {
    const insp = await ok('qc', 'POST', 'quality/inspections', {
      stage: 'incoming', itemId: docs.sheet.id, itemCode: docs.sheet.code, itemName: docs.sheet.name, qty: 100, warehouseCode: 'MAIN', lotNo: 'LOT-RT-01',
      sourceRef: docs.po.no, supplierId: docs.supplier.id, supplierName: docs.supplier.name,
    });
    ids.insp = insp.id;
    docs.insp = insp;
    const thick = insp.results.find((r: any) => r.name === 'ความหนา');
    const rust = insp.results.find((r: any) => r.name === 'สนิม/รอยขีดข่วน');
    await ok('qc', 'POST', `quality/inspection-results/${thick.id}`, { value: 2.01 });
    await ok('qc', 'POST', `quality/inspection-results/${rust.id}/fail`, { note: 'สนิมขึ้น 30 แผ่น' });
    await as(phone, 'qc');
    await open(phone, `/m/quality/inspDetail/${insp.id}`);
    await phone.getByRole('button', { name: 'ปิดงานตรวจ' }).click();
    await phone.getByRole('dialog').getByLabel('จำนวนรับ (เว้นว่าง = ตามผลตรวจ)').fill('70');
    await phone.getByRole('dialog').getByLabel('จำนวนปฏิเสธ').fill('30');
    await dialogAction(phone, 'ปิดงานตรวจ');
    await expect.poll(async () => (await ok('qc', 'GET', `quality/inspections/${insp.id}`)).status).toBe('completed');
    await shot(phone, 'UAT-63', 'phone');
    await erp.settle();
    await open(phone, '/m/inventory/holds');
    await phone.getByText(insp.no).first().waitFor();
    await shot(phone, 'UAT-63', 'phone');
    const holds = await ok('qc', 'GET', 'inventory/holds');
    expect(holds).toEqual([expect.objectContaining({ status: 'rejected', qty: 30, hold_warehouse_code: 'QC-HOLD' })]);
    const bal = await ok('qc', 'GET', `inventory/balances?itemId=${docs.sheet.id}`);
    const at = (wh: string) => bal.find((b: any) => (b.warehouse_code ?? b.warehouseCode) === wh);
    expect(at('MAIN')).toMatchObject({ available: 70 });
    expect(at('QC-HOLD')).toMatchObject({ available: 0 });
  });

  it('UAT-64 ส่งคืนผู้ขายจาก QC-HOLD ลดเจ้าหนี้และภาษีซื้อ', async () => {
    await as(page, 'buyer');
    await open(page, `/m/purchasing/poDetail/${docs.po.id}`);
    await page.getByRole('button', { name: 'ส่งคืนผู้ขาย' }).click();
    const dlg = page.getByRole('dialog');
    expect(await dlg.getByLabel('ส่งออกจากคลัง').inputValue()).toBe('QC-HOLD');
    await dlg.getByLabel('อ้างอิง NCR / เอกสาร').fill(docs.insp.no);
    await dlg.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    const line = dlg.locator('.lines-editor tbody tr').first();
    await pick(page, line, 'สินค้า', 'RM-SHEET');
    await line.getByLabel('จำนวน').fill('30');
    await line.getByLabel('เหตุผล').fill('QC ไม่ผ่าน สนิม');
    await shot(page, 'UAT-64');
    await dialogAction(page, 'ส่งคืนผู้ขาย');
    await page.waitForURL(/\/m\/purchasing\/rtDetail\//);
    await page.getByRole('heading', { name: /^RT-/ }).waitFor();
    const rt = await ok('buyer', 'GET', `purchasing/purchase-returns/${page.url().split('/').pop()}`);
    expect(rt).toMatchObject({ net: 6000, vat: 420, gross: 6420, warehouse_code: 'QC-HOLD' });
    await shot(page, 'UAT-64');
    // more than was received and not yet returned → refused
    expect((await api('buyer', 'POST', `purchasing/purchase-orders/${docs.po.id}/returns`, { lines: [{ itemId: docs.sheet.id, qty: 71 }], warehouseCode: 'MAIN' })).status).toBe(409);
    await erp.settle();
    expect((await ok('qc', 'GET', 'inventory/holds?status=returned'))).toEqual([expect.objectContaining({ status: 'returned', qty: 0 })]);
    const bal = await ok('qc', 'GET', `inventory/balances?itemId=${docs.sheet.id}&warehouseCode=QC-HOLD`);
    expect(Number(bal[0]?.onHand ?? bal[0]?.on_hand ?? 0)).toBe(0);
    const jv = (await ok('acc', 'GET', 'accounting/journals?source=purchasing.goods_returned'))[0];
    const detail = await ok('acc', 'GET', `accounting/journals/${jv.id}`);
    const lineOf = (code: string) => detail.lines.find((l: any) => l.account_code === code);
    expect(lineOf('21100')).toMatchObject({ debit: 6420 });
    expect(lineOf('11400')).toMatchObject({ credit: 6000 });
    expect(lineOf('11500')).toMatchObject({ credit: 420 });
    expect((await ok('acc', 'GET', `accounting/reports/trial-balance?asOf=${today}`)).totals.difference).toBe(0);
  });
});

/** 1×1 PNG */
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000000000500010d0a2db40000000049454e44ae426082', 'hex');

/** a service order for `customer`, confirmed and invoiced on `issueDate` (credit 30 days); returns the printable invoice */
async function invoiceFor(who: string, customer: any, description: string, net: number, issueDate: string) {
  const o = await ok(who, 'POST', 'sales/orders', {
    customerId: customer.id, customerName: customer.name, customerTaxId: customer.tax_id ?? undefined, customerAddress: customer.address ?? undefined,
    creditDays: 30, lines: [{ description, qty: 1, unitPrice: net }],
  });
  await ok(who, 'POST', `sales/orders/${o.id}/confirm`);
  return ok(who, 'POST', `sales/orders/${o.id}/invoice`, { issueDate });
}
