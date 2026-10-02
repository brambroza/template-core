/**
 * UAT for the office / service modules (UAT-28 onward in docs/uat/cases.json): approvals, expense, hr, booking, crm,
 * helpdesk, projects, assets, quality and the automation bell — driven in Chromium against a real installation of all
 * 18 modules, each step as the role that does it in real life. Screenshots go to docs/uat/screens and are merged into
 * docs/uat/shots.json (uat.test.ts does the same, so the two files can run in any order).
 */
import type { ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import { definition as purchasing } from '@erp/svc-purchasing';
import { definition as sales } from '@erp/svc-sales';
import { definition as production } from '@erp/svc-production';
import { definition as maintenance } from '@erp/svc-maintenance';
import { definition as costing } from '@erp/svc-costing';
import { definition as automation } from '@erp/svc-automation';
import { definition as quality } from '@erp/svc-quality';
import { definition as approvals } from '@erp/svc-approvals';
import { definition as expense } from '@erp/svc-expense';
import { definition as hr } from '@erp/svc-hr';
import { definition as booking } from '@erp/svc-booking';
import { definition as crm } from '@erp/svc-crm';
import { definition as helpdesk } from '@erp/svc-helpdesk';
import { definition as projects } from '@erp/svc-projects';
import { definition as assets } from '@erp/svc-assets';
import { install, type Installation } from '../e2e/helpers.ts';
import { CHROMIUM, login, logout, pick, startWeb, stopWeb } from '../ui-e2e/browser.ts';

const SCREENS = fileURLToPath(new URL('../../docs/uat/screens', import.meta.url));
const SHOTS_INDEX = fileURLToPath(new URL('../../docs/uat/shots.json', import.meta.url));
const shots: Record<string, { file: string; device: 'desktop' | 'phone' }[]> = {};

async function shot(page: Page, caseId: string, device: 'desktop' | 'phone' = 'desktop') {
  mkdirSync(SCREENS, { recursive: true });
  const list = (shots[caseId] ??= []);
  const file = `${caseId}${list.length ? `-${list.length + 1}` : ''}.jpg`;
  await page.screenshot({ path: `${SCREENS}/${file}`, type: 'jpeg', quality: 72, fullPage: true });
  list.push({ file, device });
}

/** Read-merge-write: the factory run (uat.test.ts) and this run each replace only their own cases. */
function saveShots() {
  const old = existsSync(SHOTS_INDEX) ? JSON.parse(readFileSync(SHOTS_INDEX, 'utf8')) : {};
  const all = { ...old, ...shots };
  const sorted = Object.fromEntries(Object.keys(all).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))).map((k) => [k, all[k]]));
  writeFileSync(SHOTS_INDEX, JSON.stringify(sorted, null, 2) + '\n');
}

const TENANT = 'uat-office';
const PASSWORD = 'uat-pass-1';
const base = 'http://127.0.0.1:3933';
/** Thai business date (Asia/Bangkok). */
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** The next Monday after today (a working day in the future). */
const nextMonday = (() => { let d = addDays(today, 1); while (new Date(`${d}T00:00:00Z`).getUTCDay() !== 1) d = addDays(d, 1); return d; })();

const text = async (page: Page, selector: string) => (await page.locator(selector).first().textContent()) ?? '';
const fact = (page: Page, label: string) => text(page, `.fact:has(dt:text-is("${label}"))`);

let browser: Browser;
let erp: Installation;
let web: ChildProcess;
let page: Page;
let phone: Page;
let admin: string;
let tenantId: string;
const users: Record<string, { id: string; email: string; name: string; token: string }> = {};
const ids: Record<string, string> = {};

/** Who is signed in on each page, so a step only re-logs when the role changes. */
const signedIn = new Map<Page, string>();
async function as(p: Page, who: string) {
  if (signedIn.get(p) === who) return;
  await logout(p, base);
  if (who === 'admin') await login(p, base, TENANT);
  else await login(p, base, TENANT, users[who].email, PASSWORD);
  signedIn.set(p, who);
}
const api = async (who: string, method: string, path: string, body?: unknown) => erp.call(method, `/api/${path}`, body, who === 'admin' ? admin : users[who].token);
const open = async (p: Page, path: string) => { await p.goto(`${base}${path}`); await p.locator('.screen').first().waitFor(); };
const dialogAction = async (p: Page, label: string) => p.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();

const ROLES: Record<string, string[]> = {
  staff: ['approvals.request.read', 'approvals.request.write', 'approvals.request.approve', 'expense.claim.read', 'expense.claim.write', 'hr.leave.request', 'hr.attendance.self',
    'booking.resource.read', 'booking.book.create', 'helpdesk.ticket.create', 'helpdesk.kb.read', 'projects.project.read', 'projects.task.write', 'projects.timesheet.log',
    'assets.asset.read', 'assets.repair.report', 'automation.notify.read'],
  hr: ['hr.*', 'identity.user.read'],
  accounting: ['expense.*', 'assets.*'],
  it: ['helpdesk.ticket.create', 'helpdesk.ticket.read', 'helpdesk.ticket.work', 'helpdesk.kb.read', 'helpdesk.kb.write'],
  qc: ['quality.*', 'master.item.read', 'master.partner.read'],
  sales: ['crm.*', 'master.item.read', 'master.partner.read'],
  pm: ['projects.*'],
};
const PEOPLE: [key: string, email: string, name: string, roles: string[]][] = [
  ['staff', 'staff@uat.co.th', 'สมชาย ใจดี', ['staff']],
  ['head', 'head@uat.co.th', 'วิชัย หัวหน้า', ['staff']],
  ['hr', 'hr@uat.co.th', 'นภาพร ใจงาม', ['staff', 'hr']],
  ['acc', 'acc@uat.co.th', 'สุดารัตน์ บุญมา', ['staff', 'accounting']],
  ['it', 'it@uat.co.th', 'ธนากร พึ่งบุญ', ['staff', 'it']],
  ['qc', 'qc@uat.co.th', 'อรุณี ทองดี', ['staff', 'qc']],
  ['sales', 'sales@uat.co.th', 'ปิยะพงษ์ ขายเก่ง', ['staff', 'sales']],
  ['pm', 'pm@uat.co.th', 'กมลชนก วางแผน', ['staff', 'pm']],
];

/** Company setup an administrator would do once (not under test here): roles, users, employees, categories, resources, plans. */
async function seed() {
  const roleIds: Record<string, string> = {};
  for (const [key, permissions] of Object.entries(ROLES)) {
    const r = await api('admin', 'POST', 'identity/roles', { name: `UAT ${key}`, permissions });
    roleIds[key] = r.body.id;
  }
  for (const [key, email, name, roles] of PEOPLE) {
    const u = await api('admin', 'POST', 'identity/users', { email, name, password: PASSWORD, roleIds: roles.map((r) => roleIds[r]) });
    const tok = (await erp.call('POST', '/api/identity/auth/login', { tenant: TENANT, email, password: PASSWORD })).body.token;
    users[key] = { id: u.body.id, email, name, token: tok };
  }
  // HR: leave types by law, employees linked to their logins
  await api('admin', 'POST', 'hr/leave-types/defaults');
  let n = 1;
  for (const [key, , name] of PEOPLE) {
    const [first, last] = name.split(' ');
    await api('admin', 'POST', 'hr/employees', { code: `EMP-${String(n++).padStart(3, '0')}`, firstName: first, lastName: last, startDate: '2024-01-15', userId: users[key].id });
  }
  // approvals: purchase request = head of department, then finance
  ids.prType = (await api('admin', 'POST', 'approvals/types', {
    code: 'PR', name: 'ขอซื้อ', approvers: [{ userId: users.head.id, userName: users.head.name }, { userId: users.acc.id, userName: users.acc.name }],
  })).body.id;
  // a memo type whose chain the requester picks (lockApprovers off) — used to prove nobody approves their own request
  ids.memoType = (await api('admin', 'POST', 'approvals/types', {
    code: 'MEMO', name: 'บันทึกข้อความ', lockApprovers: false, approvers: [{ userId: users.head.id, userName: users.head.name }],
  })).body.id;
  // expense categories
  await api('admin', 'POST', 'expense/categories', { code: 'FUEL', name: 'ค่าน้ำมัน', monthlyLimit: 3000 });
  await api('admin', 'POST', 'expense/categories', { code: 'HOTEL', name: 'ค่าที่พัก', requiresReceipt: true });
  // rooms and vehicles
  await api('admin', 'POST', 'booking/resources', { code: 'MR-1', name: 'ห้องประชุมเล็ก', kind: 'room', capacity: 10, location: 'ชั้น 2' });
  await api('admin', 'POST', 'booking/resources', { code: 'VAN-01', name: 'รถตู้', kind: 'vehicle', capacity: 12, plateNo: 'นข 1234', requiresApproval: true });
  // helpdesk: IT category, 2 h response / 8 h resolve, default technician
  await api('admin', 'POST', 'helpdesk/categories', { code: 'IT', name: 'ไอที/คอมพิวเตอร์', slaResponseHours: 2, slaResolveHours: 8, defaultAssigneeId: users.it.id, defaultAssigneeName: users.it.name });
  // a running project with the staff member as a member
  const pj = (await api('admin', 'POST', 'projects/projects', {
    name: 'ติดตั้งระบบ ERP สาขาบางนา', budget: 200000, managerId: users.pm.id, managerName: users.pm.name,
    members: [{ userId: users.staff.id, userName: users.staff.name, role: 'ผู้ติดตั้ง', hourlyRate: 300 }],
  })).body;
  await api('admin', 'POST', `projects/projects/${pj.id}/activate`);
  ids.project = pj.id;
  // fixed-asset category
  await api('admin', 'POST', 'assets/categories', { code: 'COMP', name: 'คอมพิวเตอร์และอุปกรณ์ไอที', usefulLifeYears: 3 });
  // QC: a raw material with an incoming inspection plan
  const item = (await api('admin', 'POST', 'master-data/items', { code: 'RM-SHEET', name: 'เหล็กแผ่น 2 มม.', type: 'raw', uom: 'แผ่น' })).body;
  await api('admin', 'POST', 'quality/plans', {
    itemId: item.id, itemCode: item.code, itemName: item.name, stage: 'incoming', name: 'ตรวจรับเหล็กแผ่น', samplingMode: 'fixed', samplingValue: 5,
    checkpoints: [
      { name: 'ความหนา', type: 'measure', unit: 'มม.', min: 1.95, max: 2.05, critical: true },
      { name: 'สนิม/รอยขีดข่วน', type: 'visual' },
    ],
  });
}

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM });
  erp = await install([identity, masterData, inventory, purchasing, sales, production, maintenance, costing, automation, quality,
    approvals, expense, hr, booking, crm, helpdesk, projects, assets]);
  ({ token: admin, tenantId } = await erp.provision(TENANT));
  await seed();
  web = await startWeb(erp.url, 3933);
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
});

afterAll(async () => {
  if (Object.keys(shots).length) saveShots();
  await browser?.close();
  stopWeb(web);
  await erp?.close();
});

describe('UAT — office & service modules (uat-office)', () => {
  /* ---------------- e-Approval ---------------- */

  it('UAT-28 ขออนุมัติซื้อ 2 ขั้น: หัวหน้าอนุมัติจากมือถือ แล้วการเงินอนุมัติ', async () => {
    await as(page, 'staff');
    await open(page, '/m/approvals/requestNew');
    await pick(page, page.locator('.form-grid'), 'ประเภทคำขอ', 'PR');
    await page.getByLabel('เรื่อง', { exact: true }).fill('ขอซื้อเครื่องพิมพ์ฉลาก');
    await page.getByLabel('รายละเอียด / เหตุผล').fill('เครื่องเดิมเสีย ใช้พิมพ์ฉลากส่งของ');
    await page.getByLabel('จำนวนเงิน (ถ้ามี)').fill('25000');
    expect(await page.getByLabel('ชื่อผู้ขอ').count()).toBe(0); // the requester is whoever is signed in
    await shot(page, 'UAT-28');
    await page.getByRole('button', { name: 'บันทึกคำขอ' }).click();
    await page.getByRole('heading', { name: 'APV-2569-0001' }).waitFor();
    expect(await fact(page, 'ขั้นอนุมัติ')).toContain('ขั้นที่ 1/2');
    expect(await fact(page, 'รอใครอนุมัติ')).toContain(users.head.name);
    expect(await fact(page, 'ผู้ขอ')).toContain(users.staff.name);
    expect(await page.getByRole('button', { name: 'อนุมัติ', exact: true }).count()).toBe(0); // not the requester's job
    ids.apv1 = page.url().split('/').pop()!;
    await shot(page, 'UAT-28');

    await as(phone, 'head');
    await open(phone, '/m/approvals/inbox');
    const row = phone.getByRole('row').filter({ hasText: 'APV-2569-0001' });
    await row.waitFor();
    await shot(phone, 'UAT-28', 'phone');
    await row.getByRole('button', { name: 'อนุมัติ' }).click();
    await dialogAction(phone, 'อนุมัติ');
    await phone.getByText('ไม่มีคำขอที่รอคุณอนุมัติ').waitFor();

    await as(page, 'acc');
    await open(page, `/m/approvals/requestDetail/${ids.apv1}`);
    expect(await fact(page, 'ขั้นอนุมัติ')).toContain('ขั้นที่ 2/2');
    await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await page.getByRole('dialog').getByLabel('ความเห็น (ไม่บังคับ)').fill('อนุมัติตามงบไตรมาส 4');
    await dialogAction(page, 'อนุมัติ');
    await page.locator('.status', { hasText: 'อนุมัติแล้ว' }).first().waitFor();
    const r = (await api('staff', 'GET', `approvals/requests/${ids.apv1}`)).body;
    expect(r).toMatchObject({ status: 'approved', amount: 25000 });
    expect(r.history.map((h: any) => h.action)).toEqual(['created', 'submitted', 'approved', 'approved']);
    await shot(page, 'UAT-28');
  });

  it('UAT-29 หัวหน้าส่งกลับแก้ไข ผู้ขอแก้และส่งใหม่ — และอนุมัติคำขอของตัวเองไม่ได้', async () => {
    await as(page, 'staff');
    await open(page, '/m/approvals/requestNew');
    await pick(page, page.locator('.form-grid'), 'ประเภทคำขอ', 'PR');
    await page.getByLabel('เรื่อง', { exact: true }).fill('ขอซื้อพัดลมไอน้ำ 2 ตัว');
    await page.getByLabel('จำนวนเงิน (ถ้ามี)').fill('9000');
    await page.getByRole('button', { name: 'บันทึกคำขอ' }).click();
    await page.getByRole('heading', { name: 'APV-2569-0002' }).waitFor();
    const id = page.url().split('/').pop()!;

    await as(page, 'head');
    await open(page, `/m/approvals/requestDetail/${id}`);
    await page.getByRole('button', { name: 'ส่งกลับแก้ไข' }).click();
    await page.getByRole('dialog').getByLabel('ต้องแก้ไขอะไร').fill('แนบใบเสนอราคา 2 ร้าน และลดเหลือ 1 ตัว');
    await dialogAction(page, 'ส่งกลับแก้ไข');
    await page.locator('.status', { hasText: 'ส่งกลับแก้ไข' }).first().waitFor();
    await shot(page, 'UAT-29');

    await as(page, 'staff');
    await open(page, `/m/approvals/requestEdit/${id}`);
    await page.getByLabel('จำนวนเงิน (ถ้ามี)').fill('4500');
    await page.getByLabel('รายละเอียด / เหตุผล').fill('ลดเหลือ 1 ตัว แนบใบเสนอราคาแล้ว');
    await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
    await page.getByRole('heading', { name: 'APV-2569-0002' }).waitFor();
    await page.getByRole('button', { name: 'ส่งขออนุมัติ' }).click();
    await page.locator('.status', { hasText: 'รออนุมัติ' }).first().waitFor();
    expect(await fact(page, 'ขั้นอนุมัติ')).toContain('ขั้นที่ 1/2');
    await shot(page, 'UAT-29');

    // the PR chain is locked: the requester cannot pick his own approvers
    const mine = [{ userId: users.staff.id, userName: users.staff.name }, { userId: users.head.id, userName: users.head.name }];
    expect((await api('staff', 'POST', 'approvals/requests', { typeId: ids.prType, title: 'ขอซื้อหมึกพิมพ์', amount: 800, submit: true, approvers: mine })).status).toBe(403);
    // on an unlocked memo type he can put himself on the chain — still no approve button, and the server refuses (bugs-0.3 APV-01)
    const own = (await api('staff', 'POST', 'approvals/requests', { typeId: ids.memoType, title: 'ขอซื้อหมึกพิมพ์', amount: 800, submit: true, approvers: mine })).body;
    await open(page, `/m/approvals/requestDetail/${own.id}`);
    expect(await fact(page, 'รอใครอนุมัติ')).toContain(users.staff.name);
    expect(await page.getByRole('button', { name: 'อนุมัติ', exact: true }).count()).toBe(0);
    expect((await api('staff', 'POST', `approvals/requests/${own.id}/approve`, {})).status).toBe(403);
    await shot(page, 'UAT-29');
  });

  /* ---------------- expense ---------------- */

  it('UAT-30 เบิกค่าใช้จ่าย (ค่าน้ำมัน + ค่าที่พัก) อนุมัติและโอนเงิน', async () => {
    await as(page, 'staff');
    await open(page, '/m/expense/claimNew');
    await page.getByLabel('วัตถุประสงค์').fill('เดินทางไปติดตั้งเครื่องที่ลูกค้าระยอง');
    expect(await page.getByLabel('ชื่อผู้เบิก').count()).toBe(0); // the claimant is whoever is signed in
    const lines = page.locator('.lines-editor');
    const r0 = lines.locator('tbody tr').nth(0);
    await r0.getByLabel('วันที่จ่าย').fill(today);
    await pick(page, r0, 'หมวด', 'FUEL');
    await r0.getByLabel('รายละเอียด').fill('เติมน้ำมัน');
    await r0.getByLabel('จำนวนเงิน (ก่อน VAT)').fill('1000');
    await r0.getByLabel('VAT (ถ้ามี)').fill('70');
    await lines.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    const r1 = lines.locator('tbody tr').nth(1);
    await r1.getByLabel('วันที่จ่าย').fill(today);
    await pick(page, r1, 'หมวด', 'HOTEL');
    await r1.getByLabel('รายละเอียด').fill('โรงแรม 1 คืน');
    await r1.getByLabel('จำนวนเงิน (ก่อน VAT)').fill('1200');
    await r1.getByLabel('เลขที่ใบเสร็จ').fill('RC-889');
    await shot(page, 'UAT-30');
    await page.getByRole('button', { name: 'บันทึกใบเบิก' }).click();
    await page.getByRole('heading', { name: 'EXP-2569-0001' }).waitFor();
    expect(await fact(page, 'สถานะ')).toContain('รออนุมัติ');
    expect(await fact(page, 'ยอดเบิกรวม')).toContain('2,270.00');
    expect(await fact(page, 'ผู้เบิก')).toContain(users.staff.name);
    expect(await fact(page, 'ตัวอักษร')).toBe('ตัวอักษรสองพันสองร้อยเจ็ดสิบบาทถ้วน');
    const id = page.url().split('/').pop()!;
    await shot(page, 'UAT-30');

    await as(page, 'acc');
    await open(page, '/m/expense/claims');
    const row = page.getByRole('row').filter({ hasText: 'EXP-2569-0001' });
    await row.getByRole('button', { name: 'อนุมัติ' }).click();
    await dialogAction(page, 'อนุมัติ');
    await open(page, '/m/expense/toPay');
    const pay = page.getByRole('row').filter({ hasText: 'EXP-2569-0001' });
    expect(await pay.innerText()).toContain('2,270.00');
    await pay.getByRole('button', { name: 'โอนแล้ว' }).click();
    await page.getByRole('dialog').getByLabel('เลขที่อ้างอิง / เลขที่เช็ค').fill('KBANK-0001');
    await shot(page, 'UAT-30');
    await dialogAction(page, 'โอนแล้ว');
    await page.getByText('ไม่มีใบเบิกค้างจ่าย').waitFor();
    await open(page, `/m/expense/claimDetail/${id}`);
    expect(await fact(page, 'สถานะ')).toContain('จ่ายแล้ว');
    expect(await fact(page, 'วิธีจ่าย')).toContain('โอนเงิน');
    await shot(page, 'UAT-30');
  });

  it('UAT-31 เงินทดรองจ่าย แล้วเคลียร์กับใบเบิก (พนักงานคืนส่วนเกิน)', async () => {
    await as(phone, 'staff');
    await open(phone, '/m/expense/advanceNew');
    await phone.getByLabel('วัตถุประสงค์').fill('ออกบูธงานแฟร์ไบเทค');
    await phone.getByLabel('จำนวนเงิน', { exact: true }).fill('5000');
    await phone.getByRole('button', { name: 'ส่งขอเงินทดรอง' }).click();
    await phone.getByRole('heading', { name: 'ADV-2569-0001' }).waitFor();
    const adv = phone.url().split('/').pop()!;
    await shot(phone, 'UAT-31', 'phone');
    // the trip's claim (approved by finance below)
    const claim = (await api('staff', 'POST', 'expense/claims', {
      purpose: 'ค่าใช้จ่ายงานแฟร์', submit: true,
      lines: [{ expenseDate: today, categoryId: (await api('staff', 'GET', 'expense/categories?q=HOTEL')).body[0].id, amount: 4000, receiptNo: 'H-9' }],
    })).body;

    await as(page, 'acc');
    await open(page, `/m/expense/advanceDetail/${adv}`);
    await page.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await page.getByRole('button', { name: 'บันทึกจ่ายเงินทดรอง' }).click();
    await page.getByRole('dialog').getByLabel('วิธีจ่าย').selectOption('cash');
    await dialogAction(page, 'บันทึกจ่ายเงินทดรอง');
    await page.getByRole('button', { name: 'เคลียร์กับใบเบิก' }).waitFor();
    expect((await api('acc', 'POST', `expense/advances/${adv}/clear`, { claimId: claim.id })).status).toBe(409); // claim not approved yet
    await api('acc', 'POST', `expense/claims/${claim.id}/approve`, {});
    await page.getByRole('button', { name: 'เคลียร์กับใบเบิก' }).click();
    await pick(page, page.getByRole('dialog'), 'ใบเบิกที่ใช้เคลียร์ (อนุมัติแล้ว)', claim.no);
    await shot(page, 'UAT-31');
    await dialogAction(page, 'เคลียร์กับใบเบิก');
    await page.locator('.fact:has(dt:text-is("ผลการเคลียร์"))').getByText('พนักงานคืนเงินบริษัท 1,000.00 บาท').waitFor();
    expect(await fact(page, 'เคลียร์ด้วยใบเบิก')).toContain(claim.no);
    await shot(page, 'UAT-31');
  });

  /* ---------------- HR ---------------- */

  it('UAT-32 ยื่นลาพักร้อนจากมือถือ ฝ่ายบุคคลอนุมัติ วันลาคงเหลือลดลง', async () => {
    await as(phone, 'staff');
    await open(phone, '/m/hr/leaveNew');
    await pick(phone, phone.locator('.form-grid'), 'ประเภทการลา', 'ลาพักร้อน');
    await phone.getByLabel('ลาตั้งแต่วันที่').fill(nextMonday);
    await phone.getByLabel('ถึงวันที่ (เว้นว่าง = วันเดียว)').fill(addDays(nextMonday, 1));
    await phone.getByLabel('เหตุผล').fill('พาครอบครัวไปเที่ยวเชียงใหม่');
    await shot(phone, 'UAT-32', 'phone');
    await phone.getByRole('button', { name: 'ส่งใบลา' }).click();
    await phone.getByRole('heading', { name: /^LV-2569-0001/ }).waitFor();
    const lv = phone.url().split('/').pop()!;
    expect((await api('staff', 'GET', `hr/leave-requests/${lv}`)).body).toMatchObject({ status: 'pending', days: 2 });
    await shot(phone, 'UAT-32', 'phone');
    // the same days again → refused as overlapping
    expect((await api('staff', 'POST', 'hr/leave-requests', { leaveTypeId: (await api('staff', 'GET', 'hr/leave-types?q=SICK')).body[0].id, fromDate: nextMonday })).status).toBe(409);

    await as(page, 'hr');
    await open(page, '/m/hr/leaveInbox');
    const row = page.getByRole('row').filter({ hasText: 'LV-2569-0001' });
    await row.waitFor();
    await shot(page, 'UAT-32');
    await row.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await page.getByText('ไม่มีใบลารออนุมัติ').waitFor();

    await open(phone, '/m/hr/me');
    const annual = phone.locator('table').filter({ hasText: 'วันลาคงเหลือปีนี้' }).getByRole('row').filter({ hasText: 'ลาพักร้อน' });
    const bal = (await api('staff', 'GET', 'hr/me')).body.balance.find((b: any) => b.code === 'ANNUAL');
    expect(bal).toMatchObject({ quota: 6, used: nextMonday.slice(0, 4) === today.slice(0, 4) ? 2 : 0, remaining: nextMonday.slice(0, 4) === today.slice(0, 4) ? 4 : 6 });
    void annual;
    await shot(phone, 'UAT-32', 'phone');
  });

  it('UAT-33 ลงเวลาเข้างานจากมือถือ และฝ่ายบุคคลเห็นในกระดานวันนี้', async () => {
    await as(phone, 'staff');
    await open(phone, '/m/hr/me');
    await phone.getByRole('button', { name: 'ลงเวลาเข้างาน' }).click();
    await phone.locator('.toast').filter({ hasText: 'ลงเวลาเข้างาน' }).first().waitFor();
    await phone.getByRole('button', { name: 'ลงเวลาออกงาน' }).waitFor();
    expect(await fact(phone, 'เข้างานวันนี้')).toMatch(/\d{1,2}:\d{2}/);
    await shot(phone, 'UAT-33', 'phone');
    expect((await api('staff', 'POST', 'hr/attendance/check-in', {})).status).toBe(409); // twice the same day

    await as(page, 'hr');
    await open(page, '/m/hr/attendanceDaily');
    const row = page.getByRole('row').filter({ hasText: users.staff.name.split(' ')[0] });
    await row.first().waitFor();
    expect(await row.first().innerText()).toMatch(/\d{1,2}:\d{2}/);
    await shot(page, 'UAT-33');
  });

  /* ---------------- booking ---------------- */

  it('UAT-34 จองห้องประชุม แล้วอีกคนจองเวลาชนกัน ระบบไม่ยอม', async () => {
    const day = addDays(nextMonday, 2);
    await as(page, 'staff');
    await open(page, '/m/booking/bookingNew');
    await pick(page, page.locator('.form-grid'), 'ห้อง / รถ / อุปกรณ์', 'MR-1');
    await page.getByLabel('วัตถุประสงค์').fill('ประชุมทีมขายประจำเดือน');
    await page.getByLabel('วันที่', { exact: true }).fill(day);
    await page.getByLabel('เวลาเริ่ม (HH:MM)').fill('09:00');
    await page.getByLabel('เวลาสิ้นสุด (HH:MM)').fill('10:00');
    await page.getByLabel('จำนวนผู้เข้าร่วม/ผู้โดยสาร').fill('8');
    await page.getByRole('button', { name: 'จอง', exact: true }).click();
    await page.getByRole('heading', { name: 'BK-2569-0001' }).waitFor();
    expect(await fact(page, 'สถานะ')).toContain('ยืนยัน');
    expect(await fact(page, 'ผู้จอง')).toContain(users.staff.name); // from the login
    await shot(page, 'UAT-34');

    await as(page, 'sales');
    await open(page, '/m/booking/bookingNew');
    await pick(page, page.locator('.form-grid'), 'ห้อง / รถ / อุปกรณ์', 'MR-1');
    await page.getByLabel('วัตถุประสงค์').fill('คุยงานลูกค้า');
    await page.getByLabel('วันที่', { exact: true }).fill(day);
    await page.getByLabel('เวลาเริ่ม (HH:MM)').fill('09:30');
    await page.getByLabel('เวลาสิ้นสุด (HH:MM)').fill('10:30');
    await page.getByRole('button', { name: 'จอง', exact: true }).click();
    await page.locator('.form-error').waitFor();
    expect(await text(page, '.form-error')).toMatch(/ห้องประชุมเล็ก ถูกจองแล้วช่วง .*09:00–10:00 น\. \(BK-2569-0001: ประชุมทีมขายประจำเดือน — สมชาย ใจดี\)/);
    await shot(page, 'UAT-34');
    await page.getByLabel('เวลาเริ่ม (HH:MM)').fill('10:00');
    await page.getByLabel('เวลาสิ้นสุด (HH:MM)').fill('11:00');
    await page.getByRole('button', { name: 'จอง', exact: true }).click();
    await page.getByRole('heading', { name: 'BK-2569-0002' }).waitFor(); // back-to-back is fine
    await open(page, `/m/booking/board?date=${day}`);
    const slots = page.getByRole('row').filter({ hasText: 'ห้องประชุมเล็ก' }).first();
    await slots.filter({ hasText: 'คุยงานลูกค้า' }).waitFor();
    expect(await slots.innerText()).toMatch(/09:00–10:00 ประชุมทีมขายประจำเดือน · 10:00–11:00 คุยงานลูกค้า/);
    await shot(page, 'UAT-34');
  });

  it('UAT-35 จองรถตู้ (ต้องอนุมัติ) อนุมัติแล้วคืนรถพร้อมเลขไมล์', async () => {
    const yesterday = addDays(today, -1);
    await as(phone, 'staff');
    await open(phone, '/m/booking/bookingNew');
    await pick(phone, phone.locator('.form-grid'), 'ห้อง / รถ / อุปกรณ์', 'VAN-01');
    await phone.getByLabel('วัตถุประสงค์').fill('ส่งของลูกค้าบางนา');
    await phone.getByLabel('วันที่', { exact: true }).fill(yesterday);
    await phone.getByLabel('เวลาเริ่ม (HH:MM)').fill('08:00');
    await phone.getByLabel('เวลาสิ้นสุด (HH:MM)').fill('12:00');
    await phone.getByLabel('ปลายทาง (สำหรับรถ)').fill('บางนา');
    await phone.getByRole('button', { name: 'จอง', exact: true }).click();
    await phone.getByRole('heading', { name: 'BK-2569-0003' }).waitFor();
    expect(await fact(phone, 'สถานะ')).toContain('รออนุมัติ');
    const id = phone.url().split('/').pop()!;
    await shot(phone, 'UAT-35', 'phone');

    await as(page, 'admin');
    await open(page, '/m/booking/approvals');
    const row = page.getByRole('row').filter({ hasText: 'BK-2569-0003' });
    await row.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    await page.getByText('ไม่มีการจองรออนุมัติ').waitFor();

    await open(phone, `/m/booking/bookingDetail/${id}`);
    await phone.getByRole('button', { name: 'คืนรถ / บันทึกเลขไมล์' }).click();
    const dlg = phone.getByRole('dialog');
    await dlg.getByLabel('เลขไมล์ก่อนใช้ (ว่าง = ต่อจากเที่ยวก่อน)').fill('15300');
    await dlg.getByLabel('เลขไมล์หลังใช้').fill('15420');
    await dlg.getByLabel('ค่าน้ำมัน (บาท)').fill('850.50');
    await shot(phone, 'UAT-35', 'phone');
    await dialogAction(phone, 'คืนรถ / บันทึกเลขไมล์');
    await phone.getByRole('button', { name: 'คืนรถ / บันทึกเลขไมล์' }).first().waitFor({ state: 'detached' });
    expect((await api('staff', 'GET', `booking/bookings/${id}`)).body).toMatchObject({ status: 'completed', distance_km: 120, fuel_cost: 850.5 });
    expect(await fact(phone, 'ระยะทาง (กม.)')).toContain('120');
    await shot(phone, 'UAT-35', 'phone');
  });

  /* ---------------- CRM ---------------- */

  it('UAT-36 ลีดจาก LINE → ติดต่อแล้ว → เปิดโอกาสขาย', async () => {
    await as(page, 'sales');
    await open(page, '/m/crm/leadNew');
    await page.getByLabel('บริษัท/ร้าน').fill('บริษัท ไทยแพ็คเกจจิ้ง จำกัด');
    await page.getByLabel('ผู้ติดต่อ').fill('คุณเอ');
    await page.getByLabel('โทรศัพท์').fill('081-111-2222');
    await page.getByLabel('มาจาก').selectOption('line');
    await page.getByLabel('สนใจสินค้า/บริการ').fill('เครื่องพิมพ์ฉลาก');
    await page.getByRole('button', { name: 'บันทึกลีด' }).click();
    await page.getByRole('heading', { name: 'LD-2569-0001' }).waitFor();
    expect(await fact(page, 'มาจาก')).toContain('LINE');
    await shot(page, 'UAT-36');
    await page.getByRole('button', { name: 'ติดต่อแล้ว' }).click();
    await page.getByRole('button', { name: 'ติดต่อแล้ว' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'เปิดโอกาสขาย' }).click();
    await page.getByRole('dialog').getByLabel('มูลค่าคาดการณ์ (บาท)').fill('120000');
    await dialogAction(page, 'เปิดโอกาสขาย');
    await page.getByRole('heading', { name: 'OP-2569-0001' }).waitFor();
    expect(await fact(page, 'โอกาสขาย')).toContain('เครื่องพิมพ์ฉลาก — บริษัท ไทยแพ็คเกจจิ้ง จำกัด');
    expect(await fact(page, 'มูลค่า')).toContain('120,000.00');
    ids.opp = page.url().split('/').pop()!;
    await shot(page, 'UAT-36');
  });

  it('UAT-37 ใบเสนอราคา (ส่วนลด 10% + VAT) ส่งลูกค้า ลูกค้าตอบรับ ปิดการขาย', async () => {
    await open(page, '/m/crm/quoteNew');
    await page.getByLabel('ชื่อลูกค้า').fill('บริษัท ไทยแพ็คเกจจิ้ง จำกัด');
    await page.getByLabel('เรียน (ผู้ติดต่อ)').fill('คุณเอ');
    await pick(page, page.locator('.form-grid'), 'โอกาสขาย', 'OP-2569-0001');
    const r0 = page.locator('.lines-editor tbody tr').nth(0);
    await r0.getByLabel('รายละเอียด').fill('เครื่องพิมพ์ฉลาก รุ่น LP-400');
    await r0.getByLabel('จำนวน').fill('2');
    await r0.getByLabel('ราคาต่อหน่วย').fill('50000');
    await r0.getByLabel('ส่วนลด %').fill('10');
    await page.getByRole('button', { name: 'บันทึกร่าง' }).click();
    await page.getByRole('heading', { name: 'QT-2569-0001' }).waitFor();
    expect(await fact(page, 'ส่วนลด')).toContain('10,000.00');
    expect(await fact(page, 'ก่อน VAT')).toContain('90,000.00');
    expect(await fact(page, 'VAT 7%')).toContain('6,300.00');
    expect(await fact(page, 'ยอดรวมทั้งสิ้น')).toContain('96,300.00');
    expect(await fact(page, 'ตัวอักษร')).toBe('ตัวอักษรเก้าหมื่นหกพันสามร้อยบาทถ้วน');
    await shot(page, 'UAT-37');
    await page.getByRole('button', { name: 'ส่งให้ลูกค้าแล้ว' }).click();
    await page.getByRole('button', { name: 'ลูกค้าตอบรับ' }).click();
    await dialogAction(page, 'ลูกค้าตอบรับ');
    await page.getByRole('button', { name: 'ลูกค้าตอบรับ' }).first().waitFor({ state: 'detached' });
    await open(page, `/m/crm/opportunity/${ids.opp}`);
    expect(await fact(page, 'มูลค่า')).toContain('90,000.00');
    expect(await fact(page, 'โอกาสสำเร็จ')).toContain('100');
    expect((await api('sales', 'GET', `crm/opportunities/${ids.opp}`)).body.stage).toBe('won');
    await shot(page, 'UAT-37');
  });

  /* ---------------- helpdesk ---------------- */

  it('UAT-38 แจ้งปัญหาด่วนมาก: SLA ครึ่งหนึ่ง ช่างรับเรื่อง แก้เสร็จ ผู้แจ้งให้คะแนน', async () => {
    await as(phone, 'staff');
    await open(phone, '/m/helpdesk/ticketNew');
    await phone.getByLabel('เรื่อง', { exact: true }).fill('คอมพิวเตอร์ฝ่ายบัญชีเปิดไม่ติด');
    await phone.getByLabel('รายละเอียดปัญหา').fill('กดปุ่มแล้วไฟไม่ขึ้น ต้องปิดงบสิ้นเดือนวันนี้');
    await pick(phone, phone.locator('.form-grid'), 'หมวดหมู่', 'IT');
    await phone.getByLabel('ความเร่งด่วน').selectOption('urgent');
    await phone.getByRole('button', { name: 'ส่งเรื่อง' }).click();
    await phone.getByRole('heading', { name: 'TK-2569-0001' }).waitFor();
    const id = phone.url().split('/').pop()!;
    const tk = (await api('staff', 'GET', `helpdesk/tickets/${id}`)).body;
    const hours = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 3600000;
    expect(hours(tk.created_at, tk.response_due_at)).toBeCloseTo(1, 1); // 2 h halved for urgent
    expect(hours(tk.created_at, tk.due_at)).toBeCloseTo(4, 1); // 8 h halved
    expect(await fact(phone, 'ผู้รับผิดชอบ')).toContain(users.it.name);
    await shot(phone, 'UAT-38', 'phone');

    await as(page, 'it');
    await open(page, `/m/helpdesk/ticket/${id}`);
    await page.getByRole('button', { name: 'รับเรื่อง/เริ่มทำ' }).click();
    await page.getByRole('button', { name: 'รับเรื่อง/เริ่มทำ' }).waitFor({ state: 'detached' });
    await page.getByRole('button', { name: 'แก้ไขเสร็จ' }).click();
    await page.getByRole('dialog').getByLabel('วิธีแก้ไข').fill('เปลี่ยนสายไฟและปลั๊กพ่วง เปิดเครื่องได้ปกติ');
    await dialogAction(page, 'แก้ไขเสร็จ');
    await page.getByRole('button', { name: 'ยืนยันปิดเรื่อง' }).waitFor();
    await shot(page, 'UAT-38');

    await open(phone, `/m/helpdesk/ticket/${id}`);
    await phone.getByRole('button', { name: 'ยืนยันปิดเรื่อง' }).click();
    await phone.getByRole('dialog').getByLabel('ความพึงพอใจ').selectOption('5');
    await phone.getByRole('dialog').getByLabel('ความเห็นเพิ่มเติม').fill('มาเร็วมาก ขอบคุณครับ');
    await dialogAction(phone, 'ยืนยันปิดเรื่อง');
    await phone.getByRole('button', { name: 'ยืนยันปิดเรื่อง' }).first().waitFor({ state: 'detached' });
    expect((await api('staff', 'GET', `helpdesk/tickets/${id}`)).body).toMatchObject({ status: 'closed', satisfaction: 5 });
    expect(await fact(phone, 'ความพึงพอใจ (1–5)')).toContain('5');
    await shot(phone, 'UAT-38', 'phone');
  });

  it('UAT-39 เรื่องที่เกิน SLA ขึ้นในรายการ "เกิน SLA" ของทีม IT', async () => {
    const tk = (await api('staff', 'POST', 'helpdesk/tickets', { title: 'เครื่องพิมพ์ชั้น 2 กระดาษติด', categoryId: (await api('staff', 'GET', 'helpdesk/categories')).body[0].id })).body;
    // eight hours later… (move the deadlines into the past)
    await erp.services.helpdesk.db.tx(tenantId, (c) =>
      c.query(`update tickets set due_at = now() - interval '1 hour', response_due_at = now() - interval '7 hours' where id = $1`, [tk.id]));
    await as(page, 'it');
    await open(page, '/m/helpdesk/overdueTickets');
    const row = page.getByRole('row').filter({ hasText: tk.no });
    await row.waitFor();
    expect(await row.innerText()).toContain('เครื่องพิมพ์ชั้น 2 กระดาษติด');
    await shot(page, 'UAT-39');
    await open(page, `/m/helpdesk/ticket/${tk.id}`);
    expect(await fact(page, 'เกิน SLA')).toContain('ใช่');
    await shot(page, 'UAT-39');
  });

  /* ---------------- projects ---------------- */

  it('UAT-40 ลงชั่วโมงทำงาน (ไม่เกิน 24 ชม./วัน) ส่ง timesheet สัปดาห์ ผู้จัดการโครงการอนุมัติ', async () => {
    await as(phone, 'staff');
    await open(phone, '/m/projects/timesheetNew');
    await phone.getByLabel('วันที่ทำงาน').fill(today);
    await pick(phone, phone.locator('.form-grid'), 'โครงการ', 'PJ-2569-0001');
    await phone.getByLabel('ชั่วโมง (0.25–24)').fill('8');
    await phone.getByLabel('ทำอะไร').fill('ติดตั้งเครื่องแม่ข่ายและเดินสาย LAN');
    await phone.getByRole('button', { name: 'บันทึกชั่วโมง' }).click();
    await phone.getByRole('row').filter({ hasText: 'ติดตั้งเครื่องแม่ข่าย' }).first().waitFor();
    await shot(phone, 'UAT-40', 'phone');

    await open(phone, '/m/projects/timesheetNew');
    await phone.getByLabel('วันที่ทำงาน').fill(today);
    await pick(phone, phone.locator('.form-grid'), 'โครงการ', 'PJ-2569-0001');
    await phone.getByLabel('ชั่วโมง (0.25–24)').fill('17');
    await phone.getByRole('button', { name: 'บันทึกชั่วโมง' }).click();
    await phone.locator('.field-error, .form-error').first().waitFor();
    expect(await phone.locator('.field-error, .form-error').allInnerTexts()).toContainEqual(expect.stringContaining('รวมเกิน 24 ชั่วโมง'));
    await shot(phone, 'UAT-40', 'phone');

    await open(phone, '/m/projects/myWeek');
    await phone.getByRole('button', { name: 'ส่งชั่วโมงทำงานให้อนุมัติ' }).click();
    await dialogAction(phone, 'ส่งชั่วโมงทำงานให้อนุมัติ');
    await expect.poll(async () => (await api('staff', 'GET', 'projects/timesheets/week')).body.status).toBe('submitted');
    expect((await api('staff', 'GET', 'projects/timesheets/week')).body).toMatchObject({ status: 'submitted', total: 8 });

    await as(page, 'pm');
    await open(page, '/m/projects/weekApprovals');
    const row = page.getByRole('row').filter({ hasText: users.staff.name });
    expect(await row.innerText()).toContain('8');
    await shot(page, 'UAT-40');
    await row.getByRole('button', { name: 'อนุมัติ', exact: true }).click();
    // (the button is renamed "กำลังบันทึก…" while the request runs, so its disappearance alone does not mean the approval landed)
    await expect.poll(async () => (await api('staff', 'GET', 'projects/timesheets/week')).body.status).toBe('approved');
    await page.getByRole('row').filter({ hasText: users.staff.name }).getByRole('button', { name: 'อนุมัติ', exact: true }).waitFor({ state: 'detached' });
    const p = (await api('pm', 'GET', `projects/projects/${ids.project}`)).body;
    expect(p).toMatchObject({ hours_logged: 8, cost: 2400 }); // 8 h × 300 baht
    await open(page, `/m/projects/projectDetail/${ids.project}`);
    await shot(page, 'UAT-40');
  });

  /* ---------------- fixed assets ---------------- */

  it('UAT-41 ลงทะเบียนทรัพย์สิน และดูค่าเสื่อมราคารายเดือน', async () => {
    await as(page, 'acc');
    await open(page, '/m/assets/assetNew');
    await page.getByLabel('ชื่อทรัพย์สิน').fill('โน้ตบุ๊กฝ่ายบัญชี');
    await pick(page, page.locator('.form-grid'), 'หมวด', 'COMP');
    await page.getByLabel('Serial No.').fill('SN-5CD1234');
    await page.getByLabel('ที่ตั้ง').fill('ฝ่ายบัญชี ชั้น 2');
    await page.getByLabel('วันที่ซื้อ').fill('2026-01-15');
    await page.getByLabel('ราคาทุน (บาท)').fill('36000');
    await page.getByRole('button', { name: 'บันทึกทรัพย์สิน' }).click();
    await page.getByRole('heading', { name: 'AS-2569-0001' }).waitFor();
    expect(await fact(page, 'ค่าเสื่อม/เดือน')).toContain('1,000.00');
    ids.asset = page.url().split('/').pop()!;
    await shot(page, 'UAT-41');
    await open(page, '/m/assets/depreciationReport?month=2026-09');
    const row = page.getByRole('row').filter({ hasText: 'AS-2569-0001' });
    expect(await row.innerText()).toMatch(/1,000\.00[\s\S]*9,000\.00[\s\S]*27,000\.00/);
    await shot(page, 'UAT-41');
  });

  it('UAT-42 ตัดจำหน่ายทรัพย์สิน: ลงวันที่ล่วงหน้าไม่ได้ คำนวณกำไรจากการขาย', async () => {
    await open(page, `/m/assets/assetDetail/${ids.asset}`);
    await page.getByRole('button', { name: 'ตัดจำหน่าย' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('วันที่ตัดจำหน่าย').fill(addDays(today, 30));
    await dlg.getByLabel('วิธี', { exact: true }).selectOption('sold');
    await dlg.getByLabel('ราคาขาย (บาท)').fill('30000');
    await dialogAction(page, 'ตัดจำหน่าย');
    await dlg.locator('.form-error, .field-error').first().waitFor();
    await shot(page, 'UAT-42');
    await dlg.getByLabel('วันที่ตัดจำหน่าย').fill('2026-09-30');
    await dialogAction(page, 'ตัดจำหน่าย');
    await page.getByRole('button', { name: 'ตัดจำหน่าย' }).first().waitFor({ state: 'detached' });
    expect(await fact(page, 'มูลค่าตามบัญชี ณ วันตัดจำหน่าย')).toContain('27,000.00');
    expect(await fact(page, 'กำไร(ขาดทุน)จากการจำหน่าย')).toContain('3,000.00');
    expect((await api('acc', 'POST', `assets/assets/${ids.asset}/repairs`, { description: 'จอแตก' })).status).toBe(409);
    await shot(page, 'UAT-42');
  });

  /* ---------------- quality ---------------- */

  it('UAT-43 ตรวจรับวัตถุดิบ: ค่าที่ขอบสเปกผ่าน ค่าเกินไม่ผ่าน → ออก NCR', async () => {
    await as(phone, 'qc');
    await open(phone, '/m/quality/inspNew');
    await phone.getByLabel('ขั้นตอนการตรวจ').selectOption('incoming');
    await pick(phone, phone.locator('.form-grid'), 'สินค้า/วัตถุดิบ', 'RM-SHEET');
    await phone.getByLabel('เลขล็อต').fill('LOT-2610-A');
    await phone.getByLabel('อ้างอิง (เลข PO / ใบสั่งผลิต)').fill('PO-2569-0099');
    await phone.getByLabel('จำนวนทั้งล็อต').fill('100');
    await phone.getByRole('button', { name: 'สร้างงานตรวจ' }).click();
    await phone.getByRole('heading', { name: 'QC-2569-0001' }).waitFor();
    const id = phone.url().split('/').pop()!;
    await phone.getByRole('button', { name: 'บันทึกผลตรวจ' }).click();
    await phone.waitForURL(/\/m\/quality\/inspResults\//);
    const thick = () => phone.getByRole('row').filter({ hasText: 'ความหนา' });
    const resultOf = (name: string) => phone.getByRole('row').filter({ hasText: name }).locator('td').nth(1);
    await thick().getByRole('button', { name: 'บันทึกค่า' }).click();
    await phone.getByRole('dialog').getByLabel('ค่าที่วัดได้').fill('2.05'); // exactly the max
    await dialogAction(phone, 'บันทึกค่า');
    await expect.poll(() => resultOf('ความหนา').innerText()).toBe('ผ่าน');
    await shot(phone, 'UAT-43', 'phone');
    await thick().getByRole('button', { name: 'บันทึกค่า' }).click();
    await phone.getByRole('dialog').getByLabel('ค่าที่วัดได้').fill('2.20');
    await phone.getByRole('dialog').getByLabel('หมายเหตุ').fill('วัดซ้ำ 3 จุด หนาเกินทุกจุด');
    await dialogAction(phone, 'บันทึกค่า');
    await expect.poll(() => resultOf('ความหนา').innerText()).toBe('ไม่ผ่าน');
    await phone.getByRole('row').filter({ hasText: 'สนิม/รอยขีดข่วน' }).getByRole('button', { name: 'ผ่าน', exact: true }).click();
    await expect.poll(() => resultOf('สนิม/รอยขีดข่วน').innerText()).toBe('ผ่าน');
    // close the inspection from its report page (bugs-0.3 UI-02: on the results page the phone dialog is pushed off-screen)
    await open(phone, `/m/quality/inspDetail/${id}`);
    await phone.getByRole('button', { name: 'ปิดงานตรวจ' }).click();
    await dialogAction(phone, 'ปิดงานตรวจ');
    await expect.poll(async () => (await api('qc', 'GET', `quality/inspections/${id}`)).body.status).toBe('completed');
    expect((await api('qc', 'GET', `quality/inspections/${id}`)).body).toMatchObject({ result: 'fail', accepted_qty: 0, rejected_qty: 100 });
    await phone.getByRole('button', { name: 'ออก NCR' }).waitFor();
    expect(await fact(phone, 'ผลตรวจ')).toContain('ไม่ผ่าน');
    await shot(phone, 'UAT-43', 'phone');
    await phone.getByRole('button', { name: 'ออก NCR' }).click();
    await phone.getByRole('dialog').getByLabel('การจัดการของเสีย').selectOption('return_to_supplier');
    await dialogAction(phone, 'ออก NCR');
    await phone.getByRole('heading', { name: 'NCR-2569-0001' }).waitFor();
    expect(await fact(phone, 'สิ่งที่ไม่เป็นไปตามข้อกำหนด')).toContain('ความหนา (วัดได้ 2.2 มม.');
    expect(await fact(phone, 'จำนวนที่ได้รับผลกระทบ')).toContain('100');
    ids.ncr = phone.url().split('/').pop()!;
    await shot(phone, 'UAT-43', 'phone');
  });

  it('UAT-44 สอบสวนสาเหตุ NCR เพิ่มการแก้ไข (CA) และปิด NCR', async () => {
    await as(page, 'qc');
    await open(page, `/m/quality/ncrDetail/${ids.ncr}`);
    await page.getByRole('button', { name: 'เริ่มสอบสวนสาเหตุ' }).click();
    await page.getByRole('dialog').getByLabel('วิเคราะห์ 5 Why').fill('1) หนาเกิน 2) ผู้ขายเปลี่ยนโรงรีด 3) ไม่แจ้งเปลี่ยน');
    await page.getByRole('dialog').getByLabel('สาเหตุราก').fill('ผู้ขายเปลี่ยนแหล่งผลิตโดยไม่แจ้ง');
    await dialogAction(page, 'เริ่มสอบสวนสาเหตุ');
    await page.getByRole('button', { name: 'เพิ่มการแก้ไข (CA)' }).click();
    await page.getByRole('dialog').getByLabel('การแก้ไข/ป้องกัน').fill('ให้ผู้ขายส่งใบรับรองความหนาทุกล็อต');
    await page.getByRole('dialog').getByLabel('กำหนดเสร็จ').fill(addDays(today, 14));
    await dialogAction(page, 'เพิ่มการแก้ไข (CA)');
    await page.getByRole('row').filter({ hasText: 'CA-2569-0001' }).waitFor();
    await shot(page, 'UAT-44');
    // closing with the CA still open is refused
    expect((await api('qc', 'POST', `quality/ncrs/${ids.ncr}/close`, {})).status).toBe(409);
    const ca = (await api('qc', 'GET', `quality/ncrs/${ids.ncr}`)).body.actions[0];
    await api('qc', 'POST', `quality/corrective-actions/${ca.id}/done`, {});
    await page.reload();
    await page.getByRole('button', { name: 'ปิด NCR' }).click();
    await dialogAction(page, 'ปิด NCR');
    await page.getByRole('button', { name: 'ปิด NCR' }).first().waitFor({ state: 'detached' });
    expect((await api('qc', 'GET', `quality/ncrs/${ids.ncr}`)).body).toMatchObject({ status: 'closed', disposition: 'return_to_supplier', root_cause: 'ผู้ขายเปลี่ยนแหล่งผลิตโดยไม่แจ้ง' });
    await shot(page, 'UAT-44');
  });

  /* ---------------- automation ---------------- */

  it('UAT-45 บอทแจ้งเตือน: มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติที่กระดิ่ง (เฉพาะผู้อนุมัติคนนั้น)', async () => {
    await as(page, 'admin');
    await open(page, '/m/automation/templates');
    const card = page.locator('.gcard', { hasText: 'มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ' });
    await card.getByRole('button', { name: 'เปิดใช้' }).click();
    await page.getByRole('heading', { name: 'มีคำขออนุมัติใหม่ แจ้งผู้อนุมัติ' }).waitFor();
    await shot(page, 'UAT-45');
    const r = (await api('staff', 'POST', 'approvals/requests', { typeId: ids.prType, title: 'ขอซื้อจอคอมพิวเตอร์', amount: 6500, submit: true })).body;
    await erp.settle();
    // addressed to the step-1 approver only: not to the requester, not to the administrator
    const mentions = async (who: string) => (await api(who, 'GET', 'automation/notifications')).body.items.some((n: any) => `${n.title} ${n.body}`.includes(r.no));
    expect(await mentions('admin')).toBe(false);
    expect(await mentions('staff')).toBe(false);
    expect(await mentions('head')).toBe(true);

    await as(page, 'head');
    await open(page, '/');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('erp:notifications')));
    const bell = page.getByRole('button', { name: /การแจ้งเตือน \(\d+ ยังไม่อ่าน\)/ });
    await bell.waitFor();
    await bell.click();
    const item = page.getByRole('dialog', { name: 'การแจ้งเตือน' }).getByRole('button', { name: new RegExp(`${r.no}.*ขอซื้อจอคอมพิวเตอร์.*${users.staff.name}.*รอคุณอนุมัติ`) });
    await item.waitFor();
    await shot(page, 'UAT-45');
    await item.click();
    await page.getByRole('heading', { name: r.no }).waitFor();
  });

  /* ---------------- roles & tenants ---------------- */

  it('UAT-46 พนักงานทั่วไปเห็นเฉพาะเมนูบริการตนเอง', async () => {
    await as(page, 'staff');
    await open(page, '/');
    const groups = (await page.getByRole('navigation').locator('.nav-group-title').allInnerTexts()).map((g) => g.trim());
    for (const g of ['อนุมัติออนไลน์', 'เบิกค่าใช้จ่าย', 'บุคคลและลงเวลา', 'จองห้องและรถ', 'แจ้งปัญหา', 'โครงการ']) expect(groups).toContain(g);
    for (const g of ['ควบคุมคุณภาพ', 'ลูกค้าสัมพันธ์', 'ผู้ใช้และสิทธิ์', 'จัดซื้อ', 'ขาย']) expect(groups).not.toContain(g);
    const nav = page.getByRole('navigation');
    expect(await nav.getByRole('link', { name: 'ใบลารออนุมัติ' }).count()).toBe(0);
    expect(await nav.getByRole('link', { name: 'อนุมัติชั่วโมงทำงาน' }).count()).toBe(0);
    // no company money for ordinary staff: all claims, payment queue, spend reports, depreciation/book value
    for (const l of ['ใบเบิกทั้งหมด', 'รอจ่ายเงิน', 'สรุปตามหมวด', 'ค่าเสื่อมรายเดือน', 'ค่าเสื่อมตามหมวด']) expect(await nav.getByRole('link', { name: l }).count()).toBe(0);
    await shot(page, 'UAT-46');
    // and the server agrees even when the URL is typed in
    expect((await api('staff', 'GET', 'hr/leave-requests/pending')).status).toBe(403);
    expect((await api('staff', 'GET', 'quality/ncrs')).status).toBe(403);
    expect((await api('staff', 'GET', 'assets/depreciation')).status).toBe(403);
    expect((await api('staff', 'GET', `assets/assets/${ids.asset}`)).body).toMatchObject({ cost: null, book_value: null });
    await as(page, 'qc');
    await open(page, '/');
    expect((await page.getByRole('navigation').locator('.nav-group-title').allInnerTexts()).map((g) => g.trim())).toContain('ควบคุมคุณภาพ');
    await shot(page, 'UAT-46');
  });

  it('UAT-47 ข้อมูลโมดูลสำนักงานของแต่ละบริษัทแยกกัน', async () => {
    const other = await erp.provision('other-office');
    await logout(page, base);
    signedIn.delete(page);
    await login(page, base, 'other-office');
    signedIn.set(page, 'other-admin');
    await open(page, '/m/approvals/requests');
    await page.getByText('ยังไม่มีคำขออนุมัติ').waitFor();
    expect(await page.getByRole('cell', { name: 'APV-2569-0001' }).count()).toBe(0);
    await shot(page, 'UAT-47');
    expect((await erp.call('GET', `/api/approvals/requests/${ids.apv1}`, undefined, other.token)).status).toBe(404);
    expect((await erp.call('GET', `/api/assets/assets/${ids.asset}`, undefined, other.token)).status).toBe(404);
    await open(page, '/m/expense/claims');
    await page.getByText('ยังไม่มีใบเบิก').waitFor();
    await shot(page, 'UAT-47');
  });
});
