/**
 * UAT for wave 9 — Thai tax completeness and sessions (UAT-65 onward in docs/uat/cases.json): ใบลดหนี้ with goods returned to stock,
 * ใบเพิ่มหนี้, supplier bills (goods from a PO, a repair service), paying with 3% WHT → 50 ทวิ, the monthly ภ.ง.ด.53 and its exports,
 * the automatic journals for all of it, ภ.พ.30 boxes for last month incl. the credit note → record the filing → the excess carried into
 * this month, e-Tax (seller settings, .p12 upload, XML, XAdES signature, "sent" record), and token revocation (logout everywhere, change
 * password, admin force-logout). Driven in Chromium against a real installation as the person who does each step; screenshots go to
 * docs/uat/screens and are merged into docs/uat/shots.json (read-merge-write, like the other UAT files).
 *
 * Calendar: last month (P) is the VAT month under test — goods bought P-02, sold P-05, returned P-10 (ใบลดหนี้), repair service billed
 * P-12 and paid P-15 with WHT. The accountant files P's ภ.พ.30 today (early in this month, before the 15th / 23rd deadline). This month
 * has a service invoice + a ใบเพิ่มหนี้, so its ภ.พ.30 preview uses the excess carried from P.
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
import { definition as accounting } from '@erp/svc-accounting';
import { definition as etax } from '@erp/svc-etax';
import { install, type Installation } from '../e2e/helpers.ts';
import { CHROMIUM, login, logout, pick, startWeb, stopWeb } from '../ui-e2e/browser.ts';

const SCREENS = fileURLToPath(new URL('../../docs/uat/screens', import.meta.url));
const SHOTS_INDEX = fileURLToPath(new URL('../../docs/uat/shots.json', import.meta.url));
const P12_B64 = readFileSync(fileURLToPath(new URL('../../services/etax/test/fixtures/signer-aes.p12.b64', import.meta.url)), 'utf8').replace(/\s+/g, '');
const P12_PASSWORD = 'test-pass-1234';
const shots: Record<string, { file: string; device: 'desktop' | 'phone' }[]> = {};

async function shot(page: Page, caseId: string, device: 'desktop' | 'phone' = 'desktop') {
  mkdirSync(SCREENS, { recursive: true });
  const list = (shots[caseId] ??= []);
  await page.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().iterations !== Infinity).map((a) => a.finished.catch(() => undefined))),
    new Promise((r) => setTimeout(r, 2000)),
  ]));
  const file = `${caseId}${list.length ? `-${list.length + 1}` : ''}.jpg`;
  await page.screenshot({ path: `${SCREENS}/${file}`, type: 'jpeg', quality: 72, fullPage: true });
  list.push({ file, device });
}

/** Read-merge-write: every UAT file writes the same index; each run replaces only its own cases. */
function saveShots() {
  const old = existsSync(SHOTS_INDEX) ? JSON.parse(readFileSync(SHOTS_INDEX, 'utf8')) : {};
  const all = { ...old, ...shots };
  const sorted = Object.fromEntries(Object.keys(all).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))).map((k) => [k, all[k]]));
  writeFileSync(SHOTS_INDEX, JSON.stringify(sorted, null, 2) + '\n');
}

const TENANT = 'uat-tax';
const PORT = 3936;
const base = `http://127.0.0.1:${PORT}`;
/** Thai business date (Asia/Bangkok). */
const today = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const thisMonth = today.slice(0, 7);
const addDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const prevMonthEnd = addDays(`${thisMonth}-01`, -1);
const prevMonth = prevMonthEnd.slice(0, 7);
const P = (day: number) => `${prevMonth}-${String(day).padStart(2, '0')}`;
const pYear = Number(prevMonth.slice(0, 4));
const money = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const text = async (page: Page, selector: string) => (await page.locator(selector).first().textContent()) ?? '';
const fact = (page: Page, label: string) => text(page, `.fact:has(dt:text-is("${label}"))`);

let browser: Browser;
let erp: Installation;
let web: ChildProcess;
let page: Page;
let phone: Page;
let admin: string;
const users: Record<string, { id: string; email: string; name: string; token: string; password: string }> = {};
const docs: Record<string, any> = {};

const signedIn = new Map<Page, string>();
async function as(p: Page, who: string) {
  if (signedIn.get(p) === who) return;
  await logout(p, base);
  if (who === 'admin') await login(p, base, TENANT);
  else await login(p, base, TENANT, users[who].email, users[who].password);
  signedIn.set(p, who);
}
const api = async (who: string, method: string, path: string, body?: unknown) => erp.call(method, `/api/${path}`, body, who === 'admin' ? admin : users[who].token);
const ok = async (who: string, method: string, path: string, body?: unknown) => {
  const r = await api(who, method, path, body);
  if (r.status >= 400) throw new Error(`${who} ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};
/** a non-JSON download (CSV / RD text / XML) through the gateway with someone's token */
const download = async (token: string, path: string) => {
  const res = await fetch(`${erp.url}/api/${path}`, { headers: { authorization: `Bearer ${token}` } });
  return { status: res.status, headers: res.headers, body: Buffer.from(await res.arrayBuffer()) };
};
const open = async (p: Page, path: string) => { await p.goto(`${base}${path}`); await p.locator('.screen').first().waitFor(); };
const dialogAction = async (p: Page, label: string) => p.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
const sessionToken = (p: Page) => p.evaluate(() => JSON.parse(localStorage.getItem('erp.session') ?? '{}').token as string);
const INSTALLED = ['identity', 'master-data', 'inventory', 'purchasing', 'sales', 'accounting', 'etax'];

/** people and the suggested Thai role template each one gets */
const PEOPLE: [key: string, email: string, name: string, template: string][] = [
  ['acc', 'acc@tax.co.th', 'สุดารัตน์ บัญชีดี', 'accounting'],
  ['owner', 'owner@tax.co.th', 'ประเสริฐ เจ้าของ', 'executive'],
  ['buyer', 'buyer@tax.co.th', 'ชัยวัฒน์ จัดซื้อ', 'purchasing'],
  ['sales', 'sales@tax.co.th', 'วรรณา ขายเก่ง', 'sales'],
  ['store', 'store@tax.co.th', 'สมศักดิ์ คลังสินค้า', 'warehouse'],
];

/** Company setup and last month's trading that happened before the cases (not under test here). */
async function seed() {
  await ok('admin', 'PUT', 'identity/company', {
    legalName: 'บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด', nameEn: 'GO Along Manufacturing Co., Ltd.', taxId: '0105560001235', branchCode: '00000',
    address: '99/9 หมู่ 5 ถ.เทพารักษ์ ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540', phone: '02-123-4567',
  });
  const roleIds: Record<string, string> = {};
  for (const tpl of new Set(PEOPLE.map((p) => p[3]))) {
    roleIds[tpl] = (await ok('admin', 'POST', 'identity/roles/from-template', { template: tpl, name: `UAT ${tpl}`, modules: INSTALLED })).id;
  }
  for (const [key, email, name, tpl] of PEOPLE) {
    const password = `uat-pass-${key}`;
    const u = await ok('admin', 'POST', 'identity/users', { email, name, password, roleIds: [roleIds[tpl]] });
    const tok = (await erp.call('POST', '/api/identity/auth/login', { tenant: TENANT, email, password })).body.token;
    users[key] = { id: u.id, email, name, token: tok, password };
  }
  docs.customer = await ok('admin', 'POST', 'master-data/partners', {
    code: 'C-001', name: 'บริษัท ลูกค้าชั้นดี จำกัด', kind: 'customer', taxId: '0105558123451', branch: '00000',
    address: '1 ถ.สุขุมวิท แขวงบางนาเหนือ เขตบางนา กรุงเทพฯ 10260', email: 'ap@lukkha.co.th',
  });
  docs.steel = await ok('admin', 'POST', 'master-data/partners', {
    code: 'S-001', name: 'บริษัท เหล็กสยาม จำกัด', kind: 'supplier', taxId: '0105536012346', branch: '00000', address: '88 ถ.พระราม 2 แขวงแสมดำ เขตบางขุนเทียน กรุงเทพฯ 10150',
  });
  docs.repair = await ok('admin', 'POST', 'master-data/partners', {
    code: 'S-002', name: 'บริษัท ช่างซ่อมเครื่องจักร จำกัด', kind: 'supplier', taxId: '0105547123454', branch: '00001', address: '12 ถ.บางนา-ตราด ต.บางพลีใหญ่ อ.บางพลี จ.สมุทรปราการ 10540',
  });
  docs.stand = await ok('admin', 'POST', 'master-data/items', { code: 'FG-STAND', name: 'ขาตั้งเหล็ก', type: 'finished', uom: 'ชิ้น' });

  // last month: 100 stands bought at 500 (VAT 3,500), received P-02
  const po = await ok('buyer', 'POST', 'purchasing/purchase-orders', {
    supplierId: docs.steel.id, supplierName: docs.steel.name, orderDate: P(1), lines: [{ itemId: docs.stand.id, itemCode: docs.stand.code, itemName: docs.stand.name, qty: 100, unitPrice: 500 }],
  });
  await ok('owner', 'POST', `purchasing/purchase-orders/${po.id}/approve`);
  await ok('store', 'POST', `purchasing/purchase-orders/${po.id}/receive`, { receivedDate: P(2) });
  docs.po = po;
  // … 20 sold at 1,000 on P-05 (ใบกำกับ 21,400)
  const so = await ok('sales', 'POST', 'sales/orders', {
    customerId: docs.customer.id, customerName: docs.customer.name, customerTaxId: docs.customer.tax_id, customerBranch: '00000',
    customerAddress: docs.customer.address, customerEmail: 'ap@lukkha.co.th', orderDate: P(4), creditDays: 30, ref: 'PO-LK-6901',
    lines: [{ itemId: docs.stand.id, itemCode: docs.stand.code, itemName: docs.stand.name, qty: 20, unitPrice: 1000 }],
  });
  await ok('sales', 'POST', `sales/orders/${so.id}/confirm`);
  await ok('store', 'POST', `sales/orders/${so.id}/deliver`);
  docs.inv = await ok('acc', 'POST', `sales/orders/${so.id}/invoice`, { issueDate: P(5) });
  // this month: an installation job (service, 100,000 + VAT)
  const job = await ok('sales', 'POST', 'sales/orders', {
    customerId: docs.customer.id, customerName: docs.customer.name, customerTaxId: docs.customer.tax_id, customerBranch: '00000',
    customerAddress: docs.customer.address, customerEmail: 'ap@lukkha.co.th', creditDays: 30,
    lines: [{ description: 'ค่าบริการติดตั้งชั้นวางเหล็กพร้อมยึดพื้น', qty: 1, unitPrice: 100000 }],
  });
  await ok('sales', 'POST', `sales/orders/${job.id}/confirm`);
  docs.jobInv = await ok('acc', 'POST', `sales/orders/${job.id}/invoice`, { issueDate: today });
  await erp.settle();
}

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM });
  erp = await install([identity, masterData, inventory, purchasing, sales, accounting, etax]);
  ({ token: admin } = await erp.provision(TENANT));
  await seed();
  web = await startWeb(erp.url, PORT);
  page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, reducedMotion: 'reduce' });
});

afterAll(async () => {
  if (Object.keys(shots).length) saveShots();
  await browser?.close();
  stopWeb(web);
  await erp?.close();
});

describe('UAT — tax documents, WHT, ภ.พ.30, e-Tax, sessions (uat-tax)', () => {
  /* ---------------- sales: credit / debit notes ---------------- */

  it('UAT-65 ออกใบลดหนี้รับคืนสินค้า 5 ชิ้นจากใบกำกับเดือนก่อน: ลูกหนี้ลดและสต็อกกลับเข้าคลัง', async () => {
    await as(page, 'acc');
    await open(page, `/m/sales/invoice/${docs.inv.id}`);
    expect(await fact(page, 'รวมทั้งสิ้น')).toContain('21,400.00');
    await page.getByRole('button', { name: 'ออกใบลดหนี้' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('เหตุผลการออกใบลดหนี้ (มาตรา 82/10)').selectOption('returned');
    await dlg.getByLabel('คำอธิบายเพิ่มเติม (พิมพ์ต่อท้ายเหตุผล)').fill('ขาตั้งบิดงอจากการขนส่ง ลูกค้าส่งคืน 5 ชิ้น');
    await dlg.getByLabel('วันที่ใบลดหนี้ (ว่าง = วันนี้)').fill(P(10));
    if (!(await dlg.locator('.lines-editor tbody tr').count())) await dlg.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    const line = dlg.locator('.lines-editor tbody tr').first();
    await line.getByLabel('ลำดับรายการในใบกำกับ (#)').fill('1');
    await line.getByLabel('จำนวน (ว่าง = ทั้งรายการ)').fill('5');
    await line.getByLabel('รับสินค้าคืนเข้าคลัง').check();
    await shot(page, 'UAT-65');
    await dialogAction(page, 'ออกใบลดหนี้');
    await page.waitForURL(/\/m\/sales\/creditNote\//);
    await page.getByRole('heading', { name: /^CN-/ }).waitFor();
    docs.cn = await ok('acc', 'GET', `sales/credit-notes/${page.url().split('/').pop()}`);
    expect(docs.cn).toMatchObject({ original_net: 20000, correct_net: 15000, net: 5000, vat: 350, gross: 5350 });
    expect(await fact(page, 'อ้างอิงใบกำกับภาษีเลขที่')).toContain(docs.inv.no);
    expect(await fact(page, 'รวมเงินที่ลดหนี้')).toContain('5,350.00');
    // printed: the word ใบลดหนี้, seller + buyer, original invoice, values, reason (มาตรา 86/10)
    await page.emulateMedia({ media: 'print' });
    const head = await page.locator('.print-letterhead').innerText();
    expect(head).toContain('ใบลดหนี้');
    expect(head).toContain('บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด');
    expect(head).toContain('0-1055-60001-23-5');
    const paper = await page.locator('main').innerText();
    for (const s of ['บริษัท ลูกค้าชั้นดี จำกัด', docs.inv.no, '20,000.00', '15,000.00', '5,000.00', '350.00', 'ได้รับคืนสินค้าที่ขาย', '86/10']) expect(paper).toContain(s);
    await shot(page, 'UAT-65');
    await page.emulateMedia({ media: 'screen' });
    await erp.settle();
    // receivables: 21,400 − 5,350 = 16,050 still owed for the invoice; the invoice itself is unchanged on paper
    const inv = await ok('acc', 'GET', `sales/invoices/${docs.inv.id}`);
    expect(inv).toMatchObject({ gross: 21400, credit_total: 5350, outstanding: 16050 });
    const ar = await ok('acc', 'GET', `sales/receivables?asOf=${prevMonthEnd}`);
    expect(ar.rows.find((r: any) => r.customer_name === docs.customer.name)).toMatchObject({ outstanding: 16050 });
    await open(page, `/m/sales/invoice/${docs.inv.id}`);
    expect(await fact(page, 'ค้างชำระ')).toContain('16,050.00');
    await page.getByRole('cell', { name: docs.cn.no }).waitFor();
    await shot(page, 'UAT-65');
    // stock: 100 in − 20 delivered + 5 back = 85 in MAIN, the move refers to the credit note
    const bal = await ok('acc', 'GET', `inventory/balances?itemId=${docs.stand.id}`);
    expect(bal.find((b: any) => (b.warehouseCode ?? b.warehouse_code) === 'MAIN')).toMatchObject({ onHand: 85 });
    await open(page, `/m/inventory/stockCard/${docs.stand.id}`);
    await page.getByRole('row').filter({ hasText: docs.cn.no }).first().waitFor();
    await shot(page, 'UAT-65');
    // more than was sold (and not yet returned) cannot come back
    const tooMany = await api('acc', 'POST', `sales/invoices/${docs.inv.id}/credit-notes`, { reasonCode: 'returned', issueDate: P(11), lines: [{ lineNo: 1, qty: 16, returnToStock: true }] });
    expect(tooMany.status).toBe(400);
    // the sales person sees notes but cannot issue one
    expect((await api('sales', 'POST', `sales/invoices/${docs.inv.id}/credit-notes`, { reasonCode: 'returned', amount: 100 })).status).toBe(403);
  });

  it('UAT-66 ออกใบเพิ่มหนี้ค่าติดตั้งเพิ่ม: ยอดค้างชำระเพิ่มและพิมพ์ตามมาตรา 86/9', async () => {
    await open(page, `/m/sales/invoice/${docs.jobInv.id}`);
    await page.getByRole('button', { name: 'ออกใบเพิ่มหนี้' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('เหตุผลการออกใบเพิ่มหนี้ (มาตรา 82/9)').selectOption('service');
    await dlg.getByLabel('คำอธิบายเพิ่มเติม (พิมพ์ต่อท้ายเหตุผล)').fill('ลูกค้าให้ติดตั้งเพิ่ม 1 จุด ตามใบสั่งงานเพิ่มเติม');
    if (!(await dlg.locator('.lines-editor tbody tr').count())) await dlg.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    const line = dlg.locator('.lines-editor tbody tr').first();
    await line.getByLabel('คำอธิบาย (ว่าง = ตามใบกำกับ)').fill('ค่าติดตั้งชั้นวางเพิ่ม 1 จุด');
    await line.getByLabel('ราคาต่อหน่วยที่เพิ่ม (ว่าง = ตามใบกำกับ)').fill('5000');
    await shot(page, 'UAT-66');
    await dialogAction(page, 'ออกใบเพิ่มหนี้');
    await page.waitForURL(/\/m\/sales\/debitNote\//);
    await page.getByRole('heading', { name: /^DN-/ }).waitFor();
    docs.dn = await ok('acc', 'GET', `sales/debit-notes/${page.url().split('/').pop()}`);
    expect(docs.dn).toMatchObject({ original_net: 100000, correct_net: 105000, net: 5000, vat: 350, gross: 5350, issue_date: today });
    await page.emulateMedia({ media: 'print' });
    expect(await page.locator('.print-letterhead').innerText()).toContain('ใบเพิ่มหนี้');
    expect(await page.locator('main').innerText()).toContain('86/9');
    await shot(page, 'UAT-66');
    await page.emulateMedia({ media: 'screen' });
    const inv = await ok('acc', 'GET', `sales/invoices/${docs.jobInv.id}`);
    expect(inv).toMatchObject({ debit_total: 5350, outstanding: 112350 });
    await open(page, '/m/sales/debitNotes');
    await page.getByRole('row').filter({ hasText: docs.dn.no }).waitFor();
    await shot(page, 'UAT-66');
  });

  /* ---------------- purchasing: bills, payments with WHT, 50 ทวิ, ภ.ง.ด.53 ---------------- */

  it('UAT-67 จัดซื้อตั้งหนี้จากใบสั่งซื้อตามใบกำกับภาษีผู้ขาย (ไม่ลงภาษีซื้อซ้ำ)', async () => {
    await as(page, 'buyer');
    await open(page, `/m/purchasing/poDetail/${docs.po.id}`);
    await page.getByRole('button', { name: 'ตั้งหนี้ (ใบกำกับภาษีผู้ขาย)' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('เลขที่ใบกำกับภาษี/ใบแจ้งหนี้ของผู้ขาย').fill('IV6909-0042');
    await dlg.getByLabel('วันที่ใบกำกับภาษี').fill(P(2));
    await pick(page, dlg, 'ผู้ขาย (ดึงเลขผู้เสียภาษี/สาขา/ที่อยู่)', 'S-001');
    await dlg.getByLabel('วันที่ตั้งหนี้ (เว้นว่าง = วันนี้)').fill(P(3));
    await dlg.getByLabel('เครดิต (วัน)').fill('30');
    await shot(page, 'UAT-67');
    await dialogAction(page, 'ตั้งหนี้ (ใบกำกับภาษีผู้ขาย)');
    await page.waitForURL(/\/m\/purchasing\/billDetail\//);
    await page.getByRole('heading', { name: /^AP-/ }).waitFor();
    docs.goodsBill = await ok('buyer', 'GET', `purchasing/bills/${page.url().split('/').pop()}`);
    expect(docs.goodsBill).toMatchObject({ kind: 'goods', net: 50000, vat: 3500, gross: 53500, vat_claimable: true, supplier_tax_id: '0105536012346', due_date: addDays(P(3), 30) });
    expect(await fact(page, 'ภาษีซื้อ')).toContain('ขอคืนได้');
    await shot(page, 'UAT-67');
    // the same supplier invoice twice → refused; the buyer cannot pay (segregation of duties)
    expect((await api('buyer', 'POST', `purchasing/purchase-orders/${docs.po.id}/bills`, { supplierInvoiceNo: 'IV6909-0042', supplierInvoiceDate: P(2) })).status).toBe(409);
    expect((await api('buyer', 'POST', `purchasing/bills/${docs.goodsBill.id}/payments`, { method: 'transfer' })).status).toBe(403);
    await erp.settle();
    // accounting: matched to the goods receipt — no second ภาษีซื้อ; the purchase VAT register now shows the supplier's tax invoice
    const sb = (await ok('acc', 'GET', `accounting/supplier-bills?q=${docs.goodsBill.no}`))[0];
    expect(sb).toMatchObject({ treatment: 'matched' });
    const input = await ok('acc', 'GET', `accounting/reports/vat/lines?month=${prevMonth}&kind=input`);
    expect(input.rows).toEqual([expect.objectContaining({ document_no: 'IV6909-0042', party_tax_id: '0105536012346', vat: 3500 })]);
  });

  it('UAT-68 ตั้งหนี้ค่าซ่อมเครื่องจักร (ค่าบริการ) จากใบกำกับภาษีผู้ให้บริการ', async () => {
    await as(page, 'acc');
    await open(page, '/m/purchasing/billNew');
    await page.getByLabel('ประเภท', { exact: true }).selectOption('service');
    await pick(page, page.locator('.screen'), 'ผู้ขาย / ผู้ให้บริการ', 'S-002');
    await page.getByLabel('เลขที่ใบกำกับภาษี/ใบแจ้งหนี้', { exact: true }).fill('SV-2569-0915');
    await page.getByLabel('วันที่ใบกำกับภาษี', { exact: true }).fill(P(12));
    await page.getByLabel('วันที่ตั้งหนี้ (เว้นว่าง = วันนี้)').fill(P(12));
    await page.getByLabel('ตอนจ่าย ต้องหักภาษี ณ ที่จ่ายประเภท').selectOption('service');
    const lines = page.locator('.lines-editor');
    if (!(await lines.locator('tbody tr').count())) await lines.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    const row = lines.locator('tbody tr').first();
    await row.getByLabel('รายการ', { exact: true }).fill('ค่าซ่อมเครื่องตัดเหล็กพร้อมเปลี่ยนลูกปืน');
    await row.getByLabel('ราคาต่อหน่วย', { exact: true }).fill('10000');
    await shot(page, 'UAT-68');
    await page.getByRole('button', { name: 'ตั้งหนี้', exact: true }).click();
    await page.getByRole('heading', { name: /^AP-/ }).waitFor();
    docs.svcBill = await ok('acc', 'GET', `purchasing/bills/${page.url().split('/').pop()}`);
    expect(docs.svcBill).toMatchObject({ kind: 'service', net: 10000, vat: 700, gross: 10700, vat_claimable: true, supplier_branch: '00001' });
    expect(await fact(page, 'ค้างจ่าย')).toContain('10,700.00');
    await shot(page, 'UAT-68');
  });

  it('UAT-69 จ่ายค่าซ่อมหักภาษี ณ ที่จ่าย 3% และพิมพ์หนังสือรับรอง 50 ทวิ', async () => {
    await open(page, `/m/purchasing/billDetail/${docs.svcBill.id}`);
    await page.getByRole('button', { name: 'จ่ายชำระ' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('วันที่จ่าย (เว้นว่าง = วันนี้)').fill(P(15));
    await dlg.getByLabel('จ่ายโดย').selectOption('transfer');
    await dlg.getByLabel('อ้างอิงการโอน / เลขที่เช็ค').fill('KBANK-PV-0915');
    await dlg.getByLabel('หักภาษี ณ ที่จ่าย', { exact: true }).selectOption('service');
    await shot(page, 'UAT-69');
    await dialogAction(page, 'จ่ายชำระ');
    await page.waitForURL(/\/m\/purchasing\/paymentDetail\//);
    await page.getByRole('heading', { name: /^PV-/ }).waitFor();
    docs.pv = await ok('acc', 'GET', `purchasing/supplier-payments/${page.url().split('/').pop()}`);
    expect(docs.pv).toMatchObject({ gross: 10700, wht_total: 300, net_paid: 10400, form: 'PND53' });
    expect(await fact(page, 'หักภาษี ณ ที่จ่าย')).toContain('300.00');
    expect(await fact(page, 'จ่ายสุทธิ')).toContain('10,400.00');
    await shot(page, 'UAT-69');
    await page.getByRole('button', { name: '50 ทวิ ฉบับที่ 1' }).click();
    await page.waitForURL(/\/m\/purchasing\/whtCert1\//);
    await page.locator('.fact').first().waitFor();
    const cert = await ok('acc', 'GET', `purchasing/wht-certificates/${docs.pv.id}`);
    expect(cert).toMatchObject({ total_paid: 10000, total_tax: 300 });
    expect(cert.total_tax_text).toContain('สามร้อยบาทถ้วน');
    await page.emulateMedia({ media: 'print' });
    const paper = await page.locator('main').innerText();
    for (const s of ['บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด', '0-1055-60001-23-5', 'บริษัท ช่างซ่อมเครื่องจักร จำกัด', '10,000.00', '300.00', 'สามร้อยบาทถ้วน', 'ภ.ง.ด.53']) expect(paper).toContain(s);
    await shot(page, 'UAT-69');
    await page.emulateMedia({ media: 'screen' });
    // the goods bill is paid in full without WHT (purchase of goods); bill and payables are cleared
    await ok('acc', 'POST', `purchasing/bills/${docs.goodsBill.id}/payments`, { paymentDate: P(20), method: 'transfer', bankRef: 'KBANK-PV-0920' });
    const payables = await ok('acc', 'GET', 'purchasing/payables');
    expect(Array.isArray(payables) ? payables : payables.rows).toEqual([]);
  });

  it('UAT-70 ภ.ง.ด.53 เดือนก่อนแสดงผู้ถูกหัก ยอดเงิน กำหนดยื่น และส่งออก CSV / RD Prep', async () => {
    await open(page, `/m/purchasing/whtReturns?year=${pYear}`);
    const row = page.getByRole('row').filter({ hasText: 'ภ.ง.ด.53' }).first();
    await row.waitFor();
    expect(await row.innerText()).toContain('300.00');
    await shot(page, 'UAT-70');
    await row.click();
    await page.waitForURL(/\/m\/purchasing\/whtReturn\//);
    await page.getByRole('row').filter({ hasText: 'บริษัท ช่างซ่อมเครื่องจักร จำกัด' }).waitFor();
    const id = decodeURIComponent(page.url().split('/').pop()!);
    expect(id).toBe(`${prevMonth}_PND53`);
    const ret = await ok('acc', 'GET', `purchasing/wht/returns/${id}`);
    expect(ret).toMatchObject({ payees: 1, total_amount: 10000, total_tax: 300 });
    expect(ret.rows[0]).toMatchObject({ seq: 1, tax_id: '0105547123454', branch: '00001', amount: 10000, tax: 300 });
    // on screen: totals in words, the deadlines in Buddhist-era dates, and the RD Prep text the accountant copies
    expect(await fact(page, 'รวมภาษีที่นำส่ง')).toContain('300.00');
    expect(await fact(page, 'ตัวอักษร')).toContain('สามร้อยบาทถ้วน');
    expect(await fact(page, 'กำหนดยื่น')).toMatch(new RegExp(`ยื่นแบบกระดาษภายใน 7 \\S+ ${pYear + 543 + (prevMonth.endsWith('-12') ? 1 : 0)}`));
    const rdOnScreen = await page.locator('.fact:has(dt:text-matches("^ข้อความไฟล์ RD Prep"))').first().innerText();
    expect(rdOnScreen).toContain(`1|0105547123454|00001|บริษัท|ช่างซ่อมเครื่องจักร จำกัด|`);
    expect(rdOnScreen).toContain('|3.00|10000.00|300.00|1');
    expect(ret.rd_text).toContain('|3.00|10000.00|300.00|1');
    await shot(page, 'UAT-70');
    const csv = await download(users.acc.token, `purchasing/wht/returns/${id}/export?format=csv`);
    expect(csv.status).toBe(200);
    expect(csv.body.toString('utf8')).toContain('0105547123454');
    const rd = await download(users.acc.token, `purchasing/wht/returns/${id}/export?format=rd&encoding=utf8`);
    expect(rd.status).toBe(200);
    expect(rd.headers.get('x-rd-prep-layout')).toBe('unverified'); // BUG-0.4-W9-01: the gateway used to drop this header
    expect(rd.body.toString('utf8')).toBe(ret.rd_text);
    // the whole list of ใบแนบ rows for the month (what the CSV button of the list exports)
    await open(page, `/m/purchasing/whtRows?period=${prevMonth}&form=PND53`);
    await page.getByRole('row').filter({ hasText: '0105547123454' }).first().waitFor();
    await shot(page, 'UAT-70');
    // the buyer cannot see WHT returns
    expect((await api('buyer', 'GET', `purchasing/wht/returns/${id}`)).status).toBe(403);
  });

  /* ---------------- accounting ---------------- */

  it('UAT-71 สมุดรายวันอัตโนมัติ: ใบลดหนี้ ใบเพิ่มหนี้ ตั้งหนี้ค่าบริการ จ่ายหัก ณ ที่จ่าย และรายงานภาษีหัก ณ ที่จ่ายค้างจ่าย', async () => {
    await erp.settle();
    await open(page, '/m/accounting/jvList');
    for (const ref of [docs.cn.no, docs.dn.no, docs.svcBill.no, docs.pv.no]) await page.getByRole('row').filter({ hasText: ref }).first().waitFor();
    await shot(page, 'UAT-71');
    expect(await ok('acc', 'GET', 'accounting/posting-errors')).toEqual([]);
    const jvOf = async (source: string, ref: string) => {
      const j = (await ok('acc', 'GET', `accounting/journals?source=${source}`)).find((x: any) => x.ref === ref || String(x.description).includes(ref));
      expect(j, `${source} ${ref}`).toBeTruthy();
      const d = await ok('acc', 'GET', `accounting/journals/${j.id}`);
      return { jv: j, side: (code: string) => d.lines.filter((l: any) => l.account_code === code).reduce((a: any, l: any) => ({ debit: a.debit + Number(l.debit), credit: a.credit + Number(l.credit) }), { debit: 0, credit: 0 }) };
    };
    const cn = await jvOf('sales.note_issued', docs.cn.no);
    expect(cn.jv.entry_date).toBe(P(10));
    expect(cn.side('41900')).toMatchObject({ debit: 5000 });
    expect(cn.side('21200')).toMatchObject({ debit: 350 });
    expect(cn.side('11300')).toMatchObject({ credit: 5350 });
    const dn = await jvOf('sales.note_issued', docs.dn.no);
    expect(dn.side('11300')).toMatchObject({ debit: 5350 });
    expect(dn.side('21200')).toMatchObject({ credit: 350 });
    const bill = await jvOf('purchasing.bill_recorded', docs.svcBill.no);
    expect(bill.jv.entry_date).toBe(P(12));
    expect(bill.side('53400')).toMatchObject({ debit: 10000 });
    expect(bill.side('11500')).toMatchObject({ debit: 700 });
    expect(bill.side('21100')).toMatchObject({ credit: 10700 });
    const pv = await jvOf('purchasing.supplier_paid', docs.pv.no);
    expect(pv.jv.entry_date).toBe(P(15));
    expect(pv.side('21100')).toMatchObject({ debit: 10700 });
    expect(pv.side('11200')).toMatchObject({ credit: 10400 });
    expect(pv.side('21320')).toMatchObject({ credit: 300 });
    await open(page, `/m/accounting/jvDetail/${cn.jv.id}`);
    await page.getByText(docs.inv.no).first().waitFor();
    await shot(page, 'UAT-71');
    // WHT payable reconciles with purchasing's ภ.ง.ด.53
    const wht = await ok('acc', 'GET', `accounting/reports/wht-payable?year=${pYear}`);
    expect(wht.summary).toEqual([expect.objectContaining({ month: prevMonth, form: 'PND53', base: 10000, amount: 300 })]);
    await open(page, `/m/accounting/whtPayable?year=${pYear}`);
    await page.getByRole('row').filter({ hasText: '300.00' }).first().waitFor();
    await shot(page, 'UAT-71');
    // the output VAT register of last month shows the credit note against the original invoice
    const out = await ok('acc', 'GET', `accounting/reports/vat/lines?month=${prevMonth}&kind=output`);
    expect(out.rows.map((r: any) => [r.document_no, r.vat])).toEqual(expect.arrayContaining([[docs.inv.no, 1400], [docs.cn.no, -350]]));
    expect(out.rows.find((r: any) => r.document_no === docs.cn.no)).toMatchObject({ ref_invoice_no: docs.inv.no });
    await open(page, `/m/accounting/vatLines?kind=output&month=${prevMonth}`);
    await page.getByRole('row').filter({ hasText: docs.cn.no }).waitFor();
    await shot(page, 'UAT-71');
    expect((await ok('acc', 'GET', `accounting/reports/trial-balance?asOf=${today}`)).totals.difference).toBe(0);
  });

  it('UAT-72 ภ.พ.30 เดือนก่อนรวมใบลดหนี้ บันทึกการยื่น แล้วภาษีชำระเกินยกไปเดือนนี้', async () => {
    const pp = await ok('acc', 'GET', `accounting/pp30/${prevMonth}`);
    // output 1,400 − 350 (credit note) = 1,050 on 15,000; input 3,500 + 700 = 4,200 on 60,000 → excess 3,150
    expect(pp).toMatchObject({ box4: 15000, box5: 1050, box6: 60000, box7: 4200, box8: 0, box9: 3150, box10: 0, box11: 0, box12: 3150, box16: 3150, filed: false });
    await open(page, `/m/accounting/pp30List?year=${pYear}`);
    await page.getByRole('row').filter({ hasText: '1,050.00' }).first().waitFor();
    await shot(page, 'UAT-72');
    await open(page, `/m/accounting/pp30Detail/${prevMonth}`);
    expect(await fact(page, '12. ชำระเกิน (ถ้า 10. มากกว่า 8. หรือ 9. รวมกับ 10.)')).toContain('3,150.00');
    await shot(page, 'UAT-72');
    await page.getByRole('button', { name: 'บันทึกว่ายื่นแล้ว' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('วันที่ยื่นแบบ').fill(today);
    await dlg.getByLabel('ช่องทาง', { exact: true }).selectOption('efiling');
    await dlg.getByLabel('เลขที่ใบเสร็จ / เลขอ้างอิงการยื่น (จาก rd.go.th)').fill('E30-6909-000123');
    await dlg.getByLabel('จำนวนเงินที่ชำระ (บาท)').fill('0');
    await dlg.getByLabel('กรณีชำระเกิน').selectOption('carry');
    await dialogAction(page, 'บันทึกว่ายื่นแล้ว');
    await expect.poll(async () => (await ok('acc', 'GET', `accounting/pp30/${prevMonth}`)).filed).toBe(true);
    await page.reload();
    await page.getByRole('row').filter({ hasText: 'E30-6909-000123' }).waitFor();
    await shot(page, 'UAT-72');
    // filing it again as an ordinary return → refused (an amendment needs a reason)
    expect((await api('acc', 'POST', `accounting/pp30/${prevMonth}/file`, { filedDate: today, channel: 'efiling', refundOrCarry: 'carry', paidAmount: 0 })).status).toBe(409);
    // this month: output 7,000 + 350 (debit note), box 10 = last month's box 16 from the recorded filing
    const now = await ok('acc', 'GET', `accounting/pp30/${thisMonth}`);
    expect(now).toMatchObject({ box5: 7350, box7: 0, box8: 7350, box10: 3150, box11: 4200, box15: 4200 });
    await open(page, `/m/accounting/pp30Detail/${thisMonth}`);
    expect(await fact(page, '10. ภาษีที่ชำระเกินยกมา')).toContain('3,150.00');
    await shot(page, 'UAT-72');
    // the buyer cannot record a filing
    expect((await api('buyer', 'POST', `accounting/pp30/${thisMonth}/file`, { filedDate: today, channel: 'efiling', refundOrCarry: 'carry', paidAmount: 0 })).status).toBe(403);
  });

  /* ---------------- e-Tax ---------------- */

  it('UAT-73 ตั้งค่า e-Tax: ข้อมูลผู้ขาย และอัปโหลดใบรับรองดิจิทัล (.p12)', async () => {
    await open(page, '/m/etax/settingsEdit');
    await page.getByLabel('ชื่อผู้ขาย (ตามที่จดทะเบียน ภ.พ.20)').fill('บริษัท โกอะลอง แมนูแฟคเจอริ่ง จำกัด');
    await page.getByLabel('เลขประจำตัวผู้เสียภาษี').fill('0105560001235');
    await page.getByLabel('เลขที่', { exact: true }).fill('99/9');
    await page.getByLabel('ที่อยู่ บรรทัด 1').fill('หมู่ 5 ถ.เทพารักษ์');
    await page.getByLabel('ตำบล/แขวง', { exact: true }).fill('บางพลีใหญ่');
    await page.getByLabel('อำเภอ/เขต', { exact: true }).fill('บางพลี');
    await page.getByLabel('จังหวัด', { exact: true }).fill('สมุทรปราการ');
    await page.getByLabel('รหัสจังหวัด (2 หลัก)').fill('11');
    await page.getByLabel('รหัสไปรษณีย์').fill('10540');
    await page.getByLabel('อีเมลผู้ขาย').fill('etax@goalong.co.th');
    await shot(page, 'UAT-73');
    await page.getByRole('button', { name: 'บันทึก', exact: true }).click();
    await page.waitForURL(/\/m\/etax\/settings$/);
    await expect.poll(async () => (await ok('acc', 'GET', 'etax/settings')).configured).toBe(true);
    await page.getByRole('button', { name: 'อัปโหลดใบรับรอง (.p12)' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('ชื่อไฟล์').fill('goalong-2569.p12');
    await dlg.getByLabel('ไฟล์ .p12 แบบ base64').fill(P12_B64);
    await dlg.getByLabel('รหัสผ่านใบรับรอง').fill('wrong-password');
    await dialogAction(page, 'อัปโหลดใบรับรอง (.p12)');
    await dlg.locator('.field-error, .form-error, [role=alert]').first().waitFor();
    expect((await ok('acc', 'GET', 'etax/settings')).has_certificate).toBeFalsy();
    await dlg.getByLabel('รหัสผ่านใบรับรอง').fill(P12_PASSWORD);
    await dialogAction(page, 'อัปโหลดใบรับรอง (.p12)');
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await expect.poll(async () => (await ok('acc', 'GET', 'etax/settings')).has_certificate).toBe(true);
    await page.reload();
    expect(await fact(page, 'มีใบรับรองดิจิทัล')).toContain('ใช่');
    // the test certificate belongs to 0105561234567, not this company → the warning stays visible on the settings screen
    expect(await fact(page, 'ข้อควรตรวจ')).toContain('0105560001235');
    const settings = await ok('acc', 'GET', 'etax/settings');
    expect(JSON.stringify(settings)).not.toContain(P12_B64.slice(0, 40)); // the file never comes back
    expect(JSON.stringify(settings)).not.toContain(P12_PASSWORD);
    await shot(page, 'UAT-73');
    // the sales person may look at e-Tax documents but not at the settings / certificate
    expect((await api('sales', 'POST', 'etax/settings/certificate', { dataBase64: P12_B64, password: P12_PASSWORD })).status).toBe(403);
  });

  it('UAT-74 e-Tax: ใบกำกับภาษีมาอัตโนมัติ สร้าง XML ลงลายมือชื่อ แล้วบันทึกว่าส่งแล้ว', async () => {
    await open(page, '/m/etax/documents');
    for (const no of [docs.inv.no, docs.jobInv.no, docs.cn.no, docs.dn.no]) await page.getByRole('row').filter({ hasText: no }).first().waitFor();
    await shot(page, 'UAT-74');
    const list = await ok('acc', 'GET', 'etax/documents');
    const doc = list.find((d: any) => d.doc_no === docs.jobInv.no);
    expect(doc).toMatchObject({ status: 'draft', gross: 107000 });
    expect(list.find((d: any) => d.doc_no === docs.cn.no)).toMatchObject({ kind: 'credit', status: 'draft' });
    await open(page, `/m/etax/document/${doc.id}`);
    expect(await fact(page, 'ขอบเขตของระบบ')).toContain('ระบบนี้ไม่ได้ส่งให้กรมสรรพากร/ETDA');
    await page.getByRole('button', { name: 'สร้าง XML' }).click();
    await page.getByRole('dialog').getByLabel('ประเภทเอกสาร').selectOption('T02');
    await dialogAction(page, 'สร้าง XML');
    await expect.poll(async () => (await ok('acc', 'GET', `etax/documents/${doc.id}`)).status).toBe('generated');
    await page.reload();
    await page.getByRole('button', { name: 'ลงลายมือชื่อดิจิทัล' }).click();
    await page.getByRole('dialog').getByLabel('รหัสผ่านใบรับรอง (.p12)').fill(P12_PASSWORD);
    await dialogAction(page, 'ลงลายมือชื่อดิจิทัล');
    await expect.poll(async () => (await ok('acc', 'GET', `etax/documents/${doc.id}`)).status).toBe('signed');
    await page.reload();
    await shot(page, 'UAT-74');
    const xml = await download(users.acc.token, `etax/documents/${doc.id}/xml?signed=1`);
    expect(xml.status).toBe(200);
    const x = xml.body.toString('utf8');
    expect(x).toContain(docs.jobInv.no);
    expect(x).toContain('0105560001235');
    expect(x).toContain('0105558123451');
    expect(x).toContain('107000.00');
    expect(x).toMatch(/SignatureValue/);
    const ver = await ok('acc', 'GET', `etax/documents/${doc.id}/verification`);
    expect(JSON.stringify(ver)).toMatch(/true|ok|valid/i);
    await page.getByRole('button', { name: 'บันทึกว่าส่งแล้ว' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('ช่องทาง', { exact: true }).selectOption('email_etda');
    await dlg.getByLabel('เลขอ้างอิง').fill('ETDA-MAIL-20261003-77');
    await dialogAction(page, 'บันทึกว่าส่งแล้ว');
    await expect.poll(async () => (await ok('acc', 'GET', `etax/documents/${doc.id}`)).status).toBe('sent_manual');
    await page.reload();
    expect(await fact(page, 'เลขอ้างอิง')).toContain('ETDA-MAIL-20261003-77');
    await shot(page, 'UAT-74');
    // once recorded as sent it cannot be regenerated / cancelled any more
    expect((await api('acc', 'POST', `etax/documents/${doc.id}/generate`, {})).status).toBe(409);
    expect((await api('acc', 'POST', `etax/documents/${doc.id}/cancel`, { reason: 'ทดสอบ' })).status).toBe(409);
  });

  /* ---------------- sessions (token revocation) ---------------- */

  it('UAT-75 ออกจากระบบ = ออกทุกอุปกรณ์: โทเคนเดิมใช้ไม่ได้อีก', async () => {
    await as(phone, 'sales');
    await open(phone, '/m/sales/soList');
    const tokenOnPhone = await sessionToken(phone);
    expect((await erp.call('GET', '/api/sales/orders', undefined, tokenOnPhone)).status).toBe(200);
    await as(page, 'sales');
    await open(page, '/m/sales/soList');
    await page.getByRole('button', { name: 'ออกจากระบบ' }).click();
    await page.waitForURL(/\/login\?logout=1/);
    await page.getByText('ออกจากระบบทุกอุปกรณ์แล้ว').waitFor();
    signedIn.delete(page);
    await shot(page, 'UAT-75');
    await erp.settle();
    // the phone's token (and the one issued at setup) is refused everywhere — identity at once, the other modules after the event
    for (const t of [tokenOnPhone, users.sales.token]) {
      const r = await erp.call('GET', '/api/sales/orders', undefined, t);
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('session_revoked');
      expect((await erp.call('GET', '/api/identity/me', undefined, t)).status).toBe(401);
    }
    // the phone notices on its next request and asks to log in again
    await phone.goto(`${base}/m/sales/soList`);
    await phone.waitForURL(/\/login\?revoked=1/);
    await phone.getByText(/เซสชันถูกยกเลิก/).waitFor();
    signedIn.delete(phone);
    await shot(phone, 'UAT-75', 'phone');
    // logging in again works at once
    const again = await erp.call('POST', '/api/identity/auth/login', { tenant: TENANT, email: users.sales.email, password: users.sales.password });
    expect(again.status).toBe(200);
    expect((await erp.call('GET', '/api/sales/orders', undefined, again.body.token)).status).toBe(200);
    users.sales.token = again.body.token;
  });

  it('UAT-76 เปลี่ยนรหัสผ่าน: รหัสเดิมผิดเปลี่ยนไม่ได้ เปลี่ยนแล้วอุปกรณ์อื่นถูกออก แต่หน้าจอนี้ใช้ต่อได้', async () => {
    await as(page, 'acc');
    const oldToken = users.acc.token;
    await page.getByRole('link', { name: 'เปลี่ยนรหัสผ่าน' }).click();
    await page.waitForURL(/\/m\/identity\/changePassword/);
    await page.getByLabel('รหัสผ่านปัจจุบัน').fill('not-my-password');
    await page.getByLabel('รหัสผ่านใหม่').fill('Acc-new-2569!');
    await page.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน' }).click();
    await page.locator('.field-error, .form-error').first().waitFor();
    expect(page.url()).toContain('/m/identity/changePassword'); // still signed in, not thrown out
    await shot(page, 'UAT-76');
    await page.getByLabel('รหัสผ่านปัจจุบัน').fill(users.acc.password);
    await page.getByRole('button', { name: 'เปลี่ยนรหัสผ่าน' }).click();
    await page.getByRole('heading', { name: 'ภาพรวมวันนี้' }).waitFor();
    await page.locator('.toast').first().waitFor();
    await shot(page, 'UAT-76');
    // this browser keeps working with the rotated token
    await open(page, '/m/accounting/jvList');
    await page.getByRole('row').filter({ hasText: docs.pv.no }).first().waitFor();
    const rotated = await sessionToken(page);
    expect(rotated).not.toBe(oldToken);
    await erp.settle();
    expect((await erp.call('GET', '/api/accounting/journals', undefined, oldToken)).status).toBe(401);
    expect((await erp.call('GET', '/api/accounting/journals', undefined, rotated)).status).toBe(200);
    // the old password no longer logs in, the new one does
    expect((await erp.call('POST', '/api/identity/auth/login', { tenant: TENANT, email: users.acc.email, password: users.acc.password })).status).not.toBe(200);
    users.acc.password = 'Acc-new-2569!';
    const fresh = await erp.call('POST', '/api/identity/auth/login', { tenant: TENANT, email: users.acc.email, password: users.acc.password });
    expect(fresh.status).toBe(200);
    users.acc.token = fresh.body.token;
  });

  it('UAT-77 ผู้ดูแลบังคับผู้ใช้ออกจากระบบ (มือถือหาย) แล้วผู้ใช้เข้าใหม่ได้', async () => {
    await as(phone, 'buyer');
    await open(phone, '/m/purchasing/poList');
    const buyerToken = await sessionToken(phone);
    await as(page, 'admin');
    await open(page, `/m/identity/userDetail/${users.buyer.id}`);
    await page.getByRole('button', { name: 'บังคับออกจากระบบ' }).click();
    await dialogAction(page, 'บังคับออกจากระบบ');
    await page.locator('.toast').first().waitFor();
    await page.reload();
    await expect.poll(async () => (await fact(page, 'สาเหตุ')).trim().length).toBeGreaterThan(0);
    await shot(page, 'UAT-77');
    await erp.settle();
    expect((await erp.call('GET', '/api/purchasing/purchase-orders', undefined, buyerToken)).status).toBe(401);
    await phone.goto(`${base}/m/purchasing/poList`);
    await phone.waitForURL(/\/login\?revoked=1/);
    signedIn.delete(phone);
    await shot(phone, 'UAT-77', 'phone');
    // the buyer logs in again with the same password; a buyer cannot force-logout anyone
    await login(phone, base, TENANT, users.buyer.email, users.buyer.password);
    signedIn.set(phone, 'buyer');
    users.buyer.token = await sessionToken(phone);
    expect((await api('buyer', 'POST', `identity/users/${users.acc.id}/revoke-sessions`, {})).status).toBe(403);
  });
});
