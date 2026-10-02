/**
 * Automated UAT run: executes every case in docs/uat/cases.json against a real installation
 * (all services + gateway + built web app) in Chromium, and saves a screenshot per case to
 * docs/uat/screens. `pnpm uat` runs it and writes docs/uat/run.json; `pnpm erp uat-report` turns
 * both into the UAT pack page.
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
import { createServer, type Server } from 'node:http';
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

const text = async (page: Page, selector: string) => (await page.locator(selector).first().textContent()) ?? '';
const fact = (page: Page, label: string) => text(page, `.fact:has(dt:text-is("${label}"))`);
const today = '2026-10-02';

let browser: Browser;
let erp: Installation;
let web: ChildProcess;
let page: Page;
let phone: Page;
const base = 'http://127.0.0.1:3931';
let uatToken = '';
let ai: { server: Server; url: string; questions: string[] };

/**
 * Stand-in for the Claude API so the assistant runs end-to-end without a key: it asks the ERP for the
 * maintenance summary, offers a button to the work-order list, then answers with the number it read.
 */
function fakeModel(): Promise<{ server: Server; url: string; questions: string[] }> {
  const questions: string[] = [];
  let open = 0;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const body = JSON.parse(raw);
      const last = body.messages.at(-1);
      let msg: unknown;
      if (typeof last.content === 'string') {
        questions.push(last.content);
        msg = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'r1', name: 'read_data', input: { module: 'maintenance', path: '/summary' } }] };
      } else if (last.content[0].tool_use_id === 'r1') {
        open = JSON.parse(last.content[0].content).openWorkOrders;
        msg = { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'o1', name: 'open_screen', input: { module: 'maintenance', screen: 'woList', values: { status: 'open' }, label: 'เปิดงานซ่อมที่ค้าง' } }] };
      } else {
        msg = { stop_reason: 'end_turn', content: [{ type: 'text', text: `ตอนนี้มีงานซ่อมค้าง ${open} งานครับ` }] };
      }
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(msg));
    });
  });
  return new Promise((r) => server.listen(0, '127.0.0.1', () => r({ server, url: `http://127.0.0.1:${(server.address() as any).port}`, questions })));
}

beforeAll(async () => {
  browser = await chromium.launch({ executablePath: CHROMIUM });
  erp = await install([identity, masterData, inventory, purchasing, sales, production, maintenance, costing, automation], { PROMPTPAY_ID: '0105536000313' });
  uatToken = (await erp.provision('uat-factory')).token;
  ai = await fakeModel();
  web = await startWeb(erp.url, 3931, { ANTHROPIC_API_KEY: 'uat-key', ANTHROPIC_BASE_URL: ai.url });
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
});

/** Read-merge-write: this run and the office/service run (business.test.ts) each replace only their own cases. */
function saveShots() {
  const old = existsSync(SHOTS_INDEX) ? JSON.parse(readFileSync(SHOTS_INDEX, 'utf8')) : {};
  const all = { ...old, ...shots };
  const sorted = Object.fromEntries(Object.keys(all).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4))).map((k) => [k, all[k]]));
  writeFileSync(SHOTS_INDEX, JSON.stringify(sorted, null, 2) + '\n');
}

afterAll(async () => {
  if (Object.keys(shots).length) saveShots();
  await browser?.close();
  stopWeb(web);
  ai?.server.close();
  await erp?.close();
});

async function nav(label: string) {
  const link = page.getByRole('navigation').getByRole('link', { name: label, exact: true });
  const href = await link.getAttribute('href');
  await link.click();
  await page.waitForURL((u) => u.pathname === href);
  await page.locator('.screen').first().waitFor();
}
const balance = async (code: string, wh: string) => {
  await page.goto(`${base}/m/inventory/balances`);
  const row = page.getByRole('row').filter({ has: page.getByRole('cell', { name: code, exact: true }) }).filter({ has: page.getByRole('cell', { name: wh, exact: true }) }).first();
  await row.waitFor();
  return row.locator('td').nth(3).innerText();
};

describe('UAT — full installation (uat-factory)', () => {
  it('UAT-01 เข้าสู่ระบบและเห็นเมนูตามโมดูลที่ซื้อ', async () => {
    await login(page, base, 'uat-factory');
    const menu = page.getByRole('navigation');
    for (const m of ['ขาย', 'จัดซื้อ', 'คลังสินค้า', 'วางแผนการผลิต', 'ซ่อมบำรุง', 'ต้นทุน', 'ข้อมูลหลัก', 'ผู้ใช้และสิทธิ์']) {
      await expect(menu.locator('.nav-group-title', { hasText: m }).count()).resolves.toBe(1);
    }
    await shot(page, 'UAT-01');
  });

  it('UAT-02 สร้างบทบาทพนักงานคลัง', async () => {
    await nav('บทบาทและสิทธิ์');
    await page.getByRole('link', { name: 'เพิ่มบทบาท' }).click();
    await page.getByLabel('ชื่อบทบาท').fill('พนักงานคลัง');
    await page.getByRole('checkbox', { name: 'ทุกสิทธิ์ของคลังสินค้า' }).check();
    await page.getByRole('checkbox', { name: 'ดูสินค้า/วัตถุดิบ' }).check();
    await shot(page, 'UAT-02');
    await page.getByRole('button', { name: 'บันทึกบทบาท' }).click();
    const row = page.getByRole('row', { name: /พนักงานคลัง/ });
    await expect(row.innerText()).resolves.toMatch(/inventory\.\*[\s\S]*master\.item\.read|master\.item\.read[\s\S]*inventory\.\*/); // chips may wrap onto separate lines
    await shot(page, 'UAT-02');
  });

  it('UAT-03 ผู้ใช้ใหม่เห็นเฉพาะเมนูที่มีสิทธิ์', async () => {
    await page.goto(`${base}/m/identity/userNew`);
    await page.getByLabel('อีเมล').fill('store@uat.co.th');
    await page.getByLabel('ชื่อ', { exact: true }).fill('สมชาย คลังดี');
    await page.getByLabel('รหัสผ่านเริ่มต้น').fill('store-pass-1');
    await page.getByRole('checkbox', { name: 'พนักงานคลัง' }).check();
    await page.getByRole('button', { name: 'เพิ่มผู้ใช้' }).click();
    await page.getByRole('cell', { name: 'store@uat.co.th' }).waitFor();
    await logout(page, base);
    await login(page, base, 'uat-factory', 'store@uat.co.th', 'store-pass-1');
    const menu = page.getByRole('navigation');
    expect(await menu.getByRole('link', { name: 'ยอดคงเหลือ' }).count()).toBe(1);
    expect(await menu.getByRole('link', { name: 'สินค้าและวัตถุดิบ' }).count()).toBe(1);
    expect(await menu.getByRole('link', { name: 'ใบสั่งซื้อ' }).count()).toBe(0);
    expect(await menu.getByRole('link', { name: 'ใบสั่งขาย' }).count()).toBe(0);
    expect(await menu.getByRole('link', { name: 'ผู้ใช้' }).count()).toBe(0);
    await shot(page, 'UAT-03');
    await logout(page, base);
    await login(page, base, 'uat-factory');
  });

  it('UAT-04 เพิ่มวัตถุดิบ อะไหล่ และสินค้าสำเร็จรูป', async () => {
    for (const [code, name, type, uom] of [['RM-STEEL', 'เหล็กแผ่น 2 มม.', 'raw', 'kg'], ['SP-BOLT', 'น็อต M8', 'spare', 'ตัว'], ['FG-BRACKET', 'ขายึด', 'finished', 'ชิ้น']]) {
      await page.goto(`${base}/m/master-data/itemNew`);
      await page.getByLabel('รหัส', { exact: true }).fill(code);
      await page.getByLabel('ชื่อ', { exact: true }).fill(name);
      await page.getByLabel('ประเภท').selectOption(type);
      await page.getByLabel('หน่วยนับ').fill(uom);
      await page.getByRole('button', { name: 'บันทึกสินค้า' }).click();
      await page.getByRole('cell', { name: code }).waitFor();
    }
    await shot(page, 'UAT-04');
    await page.goto(`${base}/m/master-data/itemNew`);
    await page.getByLabel('รหัส', { exact: true }).fill('RM-STEEL');
    await page.getByLabel('ชื่อ', { exact: true }).fill('ซ้ำ');
    await page.getByLabel('ประเภท').selectOption('raw');
    await page.getByRole('button', { name: 'บันทึกสินค้า' }).click();
    await page.locator('.form-error').waitFor();
    await shot(page, 'UAT-04');
  });

  it('UAT-05 เพิ่มผู้ขายและลูกค้า พร้อมตรวจเลขผู้เสียภาษี', async () => {
    await page.goto(`${base}/m/master-data/partnerNew`);
    await page.getByLabel('รหัส', { exact: true }).fill('S-001');
    await page.getByLabel('ชื่อ', { exact: true }).fill('บริษัท สยามเหล็ก จำกัด');
    await page.getByLabel('เป็น').selectOption('supplier');
    await page.getByLabel('เลขประจำตัวผู้เสียภาษี').fill('123');
    await page.getByRole('button', { name: 'บันทึกคู่ค้า' }).click();
    await page.locator('.field-error').first().waitFor();
    expect(await page.getByLabel('เลขประจำตัวผู้เสียภาษี').getAttribute('aria-invalid')).toBe('true');
    await shot(page, 'UAT-05');
    await page.getByLabel('เลขประจำตัวผู้เสียภาษี').fill('0105536000313');
    await page.getByRole('button', { name: 'บันทึกคู่ค้า' }).click();
    await page.getByRole('cell', { name: 'S-001' }).waitFor();
    await page.goto(`${base}/m/master-data/partnerNew`);
    await page.getByLabel('รหัส', { exact: true }).fill('C-001');
    await page.getByLabel('ชื่อ', { exact: true }).fill('บริษัท ลูกค้าดี จำกัด');
    await page.getByLabel('เป็น').selectOption('customer');
    await page.getByLabel('ที่อยู่').fill('99 ถ.สุขุมวิท ต.บางเมือง อ.เมือง จ.สมุทรปราการ 10270');
    await page.getByRole('button', { name: 'บันทึกคู่ค้า' }).click();
    await page.getByRole('cell', { name: 'C-001' }).waitFor();
    await shot(page, 'UAT-05');
  });

  it('UAT-06 สร้างใบสั่งซื้อ คำนวณ VAT 7%', async () => {
    await nav('สร้างใบสั่งซื้อ');
    await pick(page, page, 'ผู้ขาย', 'S-001');
    const lines = page.locator('.lines-editor');
    await pick(page, lines.locator('tbody tr').nth(0), 'สินค้า', 'RM-STEEL');
    await lines.locator('tbody tr').nth(0).getByLabel('จำนวน').fill('100');
    await lines.locator('tbody tr').nth(0).getByLabel('ราคาต่อหน่วย').fill('32.50');
    await lines.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    await pick(page, lines.locator('tbody tr').nth(1), 'สินค้า', 'SP-BOLT');
    await lines.locator('tbody tr').nth(1).getByLabel('จำนวน').fill('500');
    await lines.locator('tbody tr').nth(1).getByLabel('ราคาต่อหน่วย').fill('1.20');
    await shot(page, 'UAT-06');
    await page.getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click();
    await page.getByRole('heading', { name: 'PO-2569-0001' }).waitFor();
    expect(await fact(page, 'สถานะ')).toContain('ร่าง');
    expect(await fact(page, 'ก่อน VAT')).toContain('3,850.00');
    expect(await fact(page, 'VAT 7%')).toContain('269.50');
    expect(await fact(page, 'ยอดรวม')).toContain('4,119.50');
    await shot(page, 'UAT-06');
  });

  it('UAT-07 อนุมัติใบสั่งซื้อ', async () => {
    await page.getByRole('button', { name: 'อนุมัติ' }).click();
    await page.locator('.status', { hasText: 'อนุมัติแล้ว' }).waitFor();
    expect(await page.getByRole('button', { name: 'อนุมัติ', exact: true }).count()).toBe(0);
    expect(await page.getByRole('button', { name: 'รับของที่ค้างทั้งหมด' }).count()).toBe(1);
    await shot(page, 'UAT-07');
  });

  it('UAT-08 รับของตาม PO แล้วสต็อกเพิ่มอัตโนมัติ', async () => {
    await page.getByRole('button', { name: 'รับของที่ค้างทั้งหมด' }).click();
    await shot(page, 'UAT-08');
    await page.getByRole('dialog').getByRole('button', { name: 'รับของที่ค้างทั้งหมด' }).click();
    await page.locator('.status', { hasText: 'รับครบ' }).waitFor();
    await erp.settle();
    expect(await balance('RM-STEEL', 'MAIN')).toBe('100');
    expect(await balance('SP-BOLT', 'MAIN')).toBe('500');
    await shot(page, 'UAT-08');
    await page.getByRole('row').filter({ hasText: 'RM-STEEL' }).first().click();
    await page.getByRole('cell', { name: 'PO-2569-0001' }).waitFor();
    await shot(page, 'UAT-08');
  });

  it('UAT-09 จ่ายของเกินยอดคงเหลือต้องถูกปฏิเสธ', async () => {
    await nav('จ่ายออก');
    await pick(page, page, 'จากคลัง', 'MAIN');
    await pick(page, page.locator('.lines-editor'), 'สินค้า', 'RM-STEEL');
    await page.locator('.lines-editor').getByLabel('จำนวน').fill('999');
    await page.getByRole('button', { name: 'บันทึกจ่ายออก' }).click();
    await page.locator('.form-error').waitFor();
    expect(await text(page, '.form-error')).toContain('สต็อกไม่พอ: RM-STEEL ที่คลัง MAIN คงเหลือ 100 ต้องการจ่าย 999');
    await shot(page, 'UAT-09');
    expect(await balance('RM-STEEL', 'MAIN')).toBe('100');
  });

  it('UAT-10 โอนย้ายระหว่างคลัง', async () => {
    await page.goto(`${base}/m/inventory/warehouseNew`);
    await page.getByLabel('รหัส', { exact: true }).fill('LINE1');
    await page.getByLabel('ชื่อ', { exact: true }).fill('หน้าไลน์ 1');
    await page.getByRole('button', { name: 'บันทึกคลัง' }).click();
    await page.getByRole('cell', { name: 'LINE1' }).waitFor();
    await nav('โอนย้าย');
    await pick(page, page, 'จากคลัง', 'MAIN');
    await pick(page, page, 'ไปคลัง', 'LINE1');
    await pick(page, page.locator('.lines-editor'), 'สินค้า', 'SP-BOLT');
    await page.locator('.lines-editor').getByLabel('จำนวน').fill('50');
    await page.getByRole('button', { name: 'บันทึกการโอน' }).click();
    await page.getByRole('heading', { name: 'ยอดคงเหลือ' }).waitFor();
    expect(await balance('SP-BOLT', 'MAIN')).toBe('450');
    expect(await balance('SP-BOLT', 'LINE1')).toBe('50');
    await shot(page, 'UAT-10');
  });

  it('UAT-11 สร้างสูตรการผลิต (BOM)', async () => {
    await page.goto(`${base}/m/production/bomEdit`);
    await pick(page, page.locator('.form-grid'), 'สินค้าที่ผลิต', 'FG-BRACKET');
    const lines = page.locator('.lines-editor');
    await pick(page, lines.locator('tbody tr').nth(0), 'ส่วนประกอบ', 'RM-STEEL');
    await lines.locator('tbody tr').nth(0).getByLabel('ใช้ต่อสูตร').fill('0.5');
    await lines.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    await pick(page, lines.locator('tbody tr').nth(1), 'ส่วนประกอบ', 'SP-BOLT');
    await lines.locator('tbody tr').nth(1).getByLabel('ใช้ต่อสูตร').fill('4');
    await page.getByRole('button', { name: 'บันทึกสูตร' }).click();
    await page.getByRole('heading', { name: 'FG-BRACKET' }).waitFor();
    expect(await page.locator('.detail-lines tbody tr').count()).toBe(2);
    await shot(page, 'UAT-11');
  });

  it('UAT-12 ใบสั่งผลิต: ปล่อยงานและรายงานผลผลิต', async () => {
    await page.goto(`${base}/m/production/moNew`);
    await pick(page, page, 'สินค้าที่จะผลิต', 'FG-BRACKET');
    await page.getByLabel('จำนวน', { exact: true }).fill('20');
    await page.getByRole('button', { name: 'สร้างใบสั่งผลิต' }).click();
    await page.getByRole('heading', { name: 'MO-2569-0001' }).waitFor();
    const req = page.locator('.detail-lines');
    await expect(req.getByRole('row').filter({ hasText: 'RM-STEEL' }).innerText()).resolves.toContain('10');
    await expect(req.getByRole('row').filter({ hasText: 'SP-BOLT' }).innerText()).resolves.toContain('80');
    await shot(page, 'UAT-12');
    await page.getByRole('button', { name: 'ปล่อยงานเข้าไลน์' }).click();
    await page.locator('.status', { hasText: 'ปล่อยงาน' }).waitFor();
    await page.getByRole('button', { name: 'รายงานผลผลิต' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'รายงานผลผลิต' }).click();
    await page.locator('.status', { hasText: 'ผลิตเสร็จ' }).waitFor();
    await shot(page, 'UAT-12');
    await erp.settle();
    expect(await balance('RM-STEEL', 'MAIN')).toBe('90');
    expect(await balance('SP-BOLT', 'MAIN')).toBe('370');
    expect(await balance('FG-BRACKET', 'MAIN')).toBe('20');
    await shot(page, 'UAT-12');
  });

  it('UAT-13 ต้นทุนจริงต่อใบสั่งผลิต', async () => {
    await nav('ต้นทุนสินค้า');
    await expect(page.getByRole('row').filter({ hasText: 'RM-STEEL' }).innerText()).resolves.toContain('32.50');
    await expect(page.getByRole('row').filter({ hasText: 'SP-BOLT' }).innerText()).resolves.toContain('1.20');
    await shot(page, 'UAT-13');
    await nav('ต้นทุนจริงต่อใบสั่งผลิต');
    const row = page.getByRole('row').filter({ hasText: 'MO-2569-0001' });
    await expect(row.innerText()).resolves.toMatch(/421\.00[\s\S]*21\.05/);
    await shot(page, 'UAT-13');
  });

  it('UAT-14 ใบคำนวณต้นทุนสินค้า', async () => {
    await page.goto(`${base}/m/costing/sheetNew`);
    await pick(page, page.locator('.form-grid'), 'สินค้า', 'FG-BRACKET');
    await page.getByLabel('จำนวนที่คำนวณ').fill('100');
    await page.getByLabel('ชั่วโมงแรงงาน').fill('8');
    await page.getByLabel('ค่าแรงต่อชั่วโมง').fill('75');
    await page.getByLabel('โสหุ้ย % ของวัตถุดิบ+แรงงาน').fill('20');
    const lines = page.locator('.lines-editor');
    await pick(page, lines.locator('tbody tr').nth(0), 'วัตถุดิบ', 'RM-STEEL');
    await lines.locator('tbody tr').nth(0).getByLabel('จำนวน').fill('50');
    await lines.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    await pick(page, lines.locator('tbody tr').nth(1), 'วัตถุดิบ', 'SP-BOLT');
    await lines.locator('tbody tr').nth(1).getByLabel('จำนวน').fill('400');
    await page.getByRole('button', { name: 'คำนวณและบันทึก' }).click();
    await page.getByRole('heading', { name: /^CS-2569-0001$/ }).waitFor();
    expect(await fact(page, 'วัตถุดิบ')).toContain('2,105.00');
    expect(await fact(page, 'แรงงาน')).toContain('600.00');
    expect(await fact(page, 'โสหุ้ย')).toContain('541.00');
    expect(await fact(page, 'ต้นทุนรวม')).toContain('3,246.00');
    expect(await fact(page, 'ต้นทุนต่อหน่วย')).toContain('32.46');
    await shot(page, 'UAT-14');
  });

  it('UAT-15 ใบสั่งขาย: ยืนยันและส่งของ ตัดสต็อกอัตโนมัติ', async () => {
    await nav('สร้างใบสั่งขาย');
    await pick(page, page, 'ลูกค้า', 'C-001');
    await pick(page, page.locator('.lines-editor'), 'สินค้า', 'FG-BRACKET');
    await page.locator('.lines-editor').getByLabel('จำนวน').fill('15');
    await page.locator('.lines-editor').getByLabel('ราคาต่อหน่วย').fill('50');
    await page.getByRole('button', { name: 'สร้างใบสั่งขาย' }).click();
    await page.getByRole('heading', { name: 'SO-2569-0001' }).waitFor();
    expect(await fact(page, 'VAT 7%')).toContain('52.50');
    expect(await fact(page, 'ยอดรวม')).toContain('802.50');
    await page.getByRole('button', { name: 'ยืนยันคำสั่งซื้อ' }).click();
    await page.getByRole('button', { name: 'บันทึกส่งของ' }).click();
    await page.locator('.status', { hasText: 'ส่งของแล้ว' }).waitFor();
    await shot(page, 'UAT-15');
    await erp.settle();
    expect(await balance('FG-BRACKET', 'MAIN')).toBe('5');
    const so = page.url();
    void so;
  });

  it('UAT-16 ออกใบกำกับภาษี', async () => {
    await nav('ใบสั่งขาย');
    await page.getByRole('link', { name: 'SO-2569-0001' }).click();
    await page.getByRole('button', { name: 'ออกใบกำกับภาษี' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ออกใบกำกับภาษี' }).click();
    await page.getByRole('heading', { name: 'INV-2569-0001' }).waitFor();
    expect(await fact(page, 'วันที่')).toMatch(/2569$/);
    expect(await fact(page, 'ตัวอักษร')).toBe('ตัวอักษรแปดร้อยสองบาทห้าสิบสตางค์');
    await page.locator('img.qr').waitFor();
    await shot(page, 'UAT-16');
  });

  it('UAT-17 ลงทะเบียนเครื่องจักร', async () => {
    await page.goto(`${base}/m/maintenance/machineNew`);
    await page.getByLabel('รหัส (พิมพ์บน QR)').fill('PRESS-01');
    await page.getByLabel('ชื่อ', { exact: true }).fill('เครื่องปั๊ม 80 ตัน');
    await page.getByLabel('ที่ตั้ง').fill('Line 1');
    await page.getByRole('button', { name: 'บันทึกเครื่องจักร' }).click();
    await expect(page.getByRole('row').filter({ hasText: 'PRESS-01' }).innerText()).resolves.toContain('เดินเครื่อง');
    await shot(page, 'UAT-17');
  });

  it('UAT-18 แจ้งซ่อมจากมือถือ', async () => {
    await login(phone, base, 'uat-factory');
    await phone.getByRole('button', { name: 'เมนู' }).click();
    await shot(phone, 'UAT-18', 'phone');
    await phone.getByRole('navigation').getByRole('link', { name: 'แจ้งซ่อม', exact: true }).click();
    await pick(phone, phone, 'เครื่องจักร', 'PRESS-01');
    await phone.getByLabel('อาการ', { exact: true }).fill('น้ำมันไฮดรอลิกรั่ว');
    await phone.getByRole('button', { name: 'แจ้งซ่อม' }).click();
    await phone.getByRole('heading', { name: 'WO-2569-0001' }).waitFor();
    await phone.locator('.status', { hasText: 'รอดำเนินการ' }).waitFor();
    await shot(phone, 'UAT-18', 'phone');
    await page.goto(`${base}/m/maintenance/machines`);
    await expect(page.getByRole('row').filter({ hasText: 'PRESS-01' }).innerText()).resolves.toContain('เครื่องเสีย');
    await shot(page, 'UAT-18');
  });

  it('UAT-19 รับงานและปิดงานซ่อมพร้อมเบิกอะไหล่', async () => {
    await phone.getByRole('button', { name: 'รับงาน' }).click();
    await phone.locator('.status', { hasText: 'กำลังซ่อม' }).waitFor();
    await phone.getByRole('button', { name: 'ปิดงานซ่อม' }).click();
    const dlg = phone.getByRole('dialog');
    await dlg.getByLabel('วิธีแก้').fill('เปลี่ยนซีลกระบอกสูบ');
    await dlg.getByLabel('เครื่องหยุด (นาที)').fill('45');
    await dlg.getByLabel('เบิกอะไหล่จากคลัง').fill('MAIN'); // default is the SPARE store; this plant keeps bolts in MAIN
    await dlg.getByRole('button', { name: 'เพิ่มรายการ' }).click();
    await pick(phone, dlg, 'อะไหล่', 'SP-BOLT');
    await dlg.locator('.lines-editor').getByLabel('จำนวน').fill('6');
    await shot(phone, 'UAT-19', 'phone');
    await dlg.getByRole('button', { name: 'ปิดงานซ่อม' }).click();
    await phone.locator('.status', { hasText: 'เสร็จแล้ว' }).waitFor();
    await shot(phone, 'UAT-19', 'phone');
    await erp.settle();
    expect(await balance('SP-BOLT', 'MAIN')).toBe('364');
    await page.goto(`${base}/m/maintenance/machines`);
    await expect(page.getByRole('row').filter({ hasText: 'PRESS-01' }).innerText()).resolves.toContain('เดินเครื่อง');
  });

  it('UAT-20 แผน PM และสร้างงาน PM ที่ถึงกำหนด', async () => {
    await page.goto(`${base}/m/maintenance/pmNew`);
    await pick(page, page, 'เครื่องจักร', 'PRESS-01');
    await page.getByLabel('งาน', { exact: true }).fill('เปลี่ยนน้ำมันไฮดรอลิก');
    await page.getByLabel('ทำทุกกี่วัน').fill('30');
    await page.getByLabel('ครบกำหนดครั้งแรก').fill(today);
    await page.getByRole('button', { name: 'บันทึกแผน' }).click();
    await page.getByRole('cell', { name: 'เปลี่ยนน้ำมันไฮดรอลิก' }).waitFor();
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: 'สร้างงาน PM ที่ถึงกำหนด' }).click();
      await page.getByRole('dialog').getByLabel('ถึงวันที่').fill(today);
      await page.getByRole('dialog').getByRole('button', { name: 'สร้างงาน PM ที่ถึงกำหนด' }).click();
      await page.getByRole('dialog').waitFor({ state: 'hidden' });
    }
    await shot(page, 'UAT-20');
    await page.goto(`${base}/m/maintenance/woList`);
    await page.getByRole('row').filter({ hasText: 'PM' }).first().waitFor();
    expect(await page.getByRole('row').filter({ hasText: 'เปลี่ยนน้ำมันไฮดรอลิก' }).count()).toBe(1);
    await shot(page, 'UAT-20');
  });

  it('UAT-23 ภาพรวมวันนี้: ผัง 3 มิติและตัวเลขทุกฝ่าย', async () => {
    await page.goto(`${base}/`);
    await page.getByRole('heading', { name: 'ภาพรวมวันนี้' }).waitFor();
    await page.locator('.floor canvas').waitFor();
    await page.locator('.floor').getByText('PRESS-01').first().waitFor();
    for (const w of ['ขาย', 'จัดซื้อ', 'คลังสินค้า', 'ซ่อมบำรุง']) await page.getByRole('region', { name: w }).first().waitFor();
    await page.waitForTimeout(1500); // let the count-up finish
    await shot(page, 'UAT-23');
  });

  it('UAT-24 เปิดสูตรบอท "เครื่องเสีย แจ้งช่างทันที" ในคลิกเดียว', async () => {
    await nav('สูตรสำเร็จรูป');
    const card = page.locator('.gcard', { hasText: 'เครื่องเสีย แจ้งช่างทันที' });
    await shot(page, 'UAT-24');
    await card.getByRole('button', { name: 'เปิดใช้' }).click();
    await page.getByRole('heading', { name: 'เครื่องเสีย แจ้งช่างทันที' }).waitFor();
    expect(await fact(page, 'เปิดใช้')).toContain('ใช่');
    await page.getByRole('button', { name: 'ลองรัน (ไม่ส่งจริง)' }).click();
    await expect(page.locator('.toast').filter({ hasText: 'จะส่ง' }).first().innerText()).resolves.toContain('เครื่อง');
    await shot(page, 'UAT-24');
  });

  it('UAT-25 สั่งงานภาษาไทยด้วย ⌘K: แจ้งซ่อม PRESS-01 สายพานขาด', async () => {
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'คำสั่งหรือคำถาม' });
    await box.fill('แจ้งซ่อม PRESS-01 สายพานขาด');
    await page.getByRole('option', { name: /แจ้งซ่อมเครื่องจักร.*PRESS-01.*สายพานขาด/ }).waitFor();
    await shot(page, 'UAT-25');
    await box.press('Enter');
    await page.waitForURL(/\/m\/maintenance\/woNew/);
    expect(await page.getByRole('combobox', { name: 'เครื่องจักร' }).inputValue()).toContain('PRESS-01');
    expect(await page.getByLabel('อาการ', { exact: true }).inputValue()).toBe('สายพานขาด');
    await shot(page, 'UAT-25');
    await page.getByRole('button', { name: 'แจ้งซ่อม' }).click();
    await page.locator('.status', { hasText: 'รอดำเนินการ' }).waitFor();
  });

  it('UAT-26 บอทแจ้งเตือนในแอปเมื่อเครื่องเสีย', async () => {
    const wo = await page.getByRole('heading', { level: 1 }).innerText();
    await erp.settle();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('erp:notifications')));
    const bell = page.getByRole('button', { name: /การแจ้งเตือน \(\d+ ยังไม่อ่าน\)/ });
    await bell.waitFor();
    await bell.click();
    const item = page.getByRole('dialog', { name: 'การแจ้งเตือน' }).getByRole('button', { name: new RegExp(`เครื่องเสีย แจ้งช่างทันที.*PRESS-01.*${wo}`) });
    await item.waitFor();
    await shot(page, 'UAT-26');
    await item.click();
    await page.getByRole('heading', { name: wo }).waitFor();
    await page.goto(`${base}/m/automation/notifications`);
    await expect(page.getByRole('row').filter({ hasText: wo }).first().innerText()).resolves.toMatch(/\d{4}/); // read_at filled
    await shot(page, 'UAT-26');
  });

  it('UAT-27 ถามผู้ช่วย AI จากข้อมูลจริง', async () => {
    const open = (await erp.call('GET', '/api/maintenance/summary', undefined, uatToken)).body.openWorkOrders;
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'คำสั่งหรือคำถาม' });
    await box.fill('ตอนนี้มีงานซ่อมค้างกี่งาน');
    await page.getByRole('option', { name: /ถาม AI/ }).click();
    await page.getByText(`ตอนนี้มีงานซ่อมค้าง ${open} งานครับ`).waitFor();
    expect(ai.questions).toContain('ตอนนี้มีงานซ่อมค้างกี่งาน');
    await shot(page, 'UAT-27');
    await page.getByRole('button', { name: 'เปิดงานซ่อมที่ค้าง' }).click();
    await page.waitForURL(/\/m\/maintenance\/woList\?status=open/);
    await page.getByRole('cell', { name: 'สายพานขาด' }).waitFor();
    await shot(page, 'UAT-27');
  });

  it('UAT-22 ข้อมูลแต่ละบริษัทแยกกัน', async () => {
    const other = await erp.provision('other-co');
    const sup = (await erp.call('POST', '/api/master-data/partners', { code: 'X-1', name: 'ผู้ขายของบริษัทอื่น', kind: 'supplier' }, other.token)).body;
    const item = (await erp.call('POST', '/api/master-data/items', { code: 'X-ITEM', name: 'สินค้าบริษัทอื่น', type: 'raw' }, other.token)).body;
    await erp.call('POST', '/api/purchasing/purchase-orders', { supplierId: sup.id, supplierName: sup.name, lines: [{ itemId: item.id, itemCode: 'X-ITEM', qty: 1, unitPrice: 10 }] }, other.token);
    await logout(page, base);
    await login(page, base, 'other-co');
    await page.goto(`${base}/m/master-data/items`);
    await page.getByRole('cell', { name: 'X-ITEM' }).waitFor();
    expect(await page.getByRole('cell', { name: 'RM-STEEL' }).count()).toBe(0);
    await shot(page, 'UAT-22');
    await page.goto(`${base}/m/purchasing/poList`);
    await page.getByRole('cell', { name: 'PO-2569-0001' }).waitFor();
    expect(await page.getByRole('cell', { name: 'บริษัท สยามเหล็ก จำกัด' }).count()).toBe(0);
    await shot(page, 'UAT-22');
  });
});

describe('UAT — partial installation (small-factory: Core + Maintenance)', () => {
  let small: Installation;
  let smallWeb: ChildProcess;
  let p: Page;
  const smallBase = 'http://127.0.0.1:3932';
  beforeAll(async () => {
    small = await install([identity, masterData, maintenance]);
    await small.provision('small-factory');
    smallWeb = await startWeb(small.url, 3932);
    p = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  });
  afterAll(async () => { await p?.close(); stopWeb(smallWeb); await small?.close(); });

  it('UAT-21 ลูกค้าที่ซื้อบางโมดูลเห็นเฉพาะที่ซื้อ', async () => {
    await login(p, smallBase, 'small-factory');
    const groups = await p.getByRole('navigation').locator('.nav-group-title').allInnerTexts();
    expect(groups.map((g) => g.trim())).toEqual(['ซ่อมบำรุง', 'ข้อมูลหลัก', 'ผู้ใช้และสิทธิ์']);
    await shot(p, 'UAT-21');
    await p.goto(`${smallBase}/m/sales/soList`);
    await p.getByRole('heading', { name: 'ยังไม่ได้ติดตั้งโมดูลนี้' }).waitFor();
    await shot(p, 'UAT-21');
  });
});
