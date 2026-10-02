import type { ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright-core';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import { definition as purchasing } from '@erp/svc-purchasing';
import { definition as sales } from '@erp/svc-sales';
import { definition as maintenance } from '@erp/svc-maintenance';
import { install, type Installation } from '../e2e/helpers.ts';
import { CHROMIUM, login, pick, startWeb, stopWeb } from './browser.ts';

const SHOTS = process.env.SCREENSHOT_DIR;

const shot = async (page: Page, name: string) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } };

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: CHROMIUM }); });
afterAll(async () => { await browser?.close(); });

describe('web app — customer with Core + Inventory + Purchasing + Sales', () => {
  let erp: Installation;
  let web: ChildProcess;
  let page: Page;
  const base = 'http://127.0.0.1:3911';

  beforeAll(async () => {
    erp = await install([identity, masterData, inventory, purchasing, sales]);
    const { token } = await erp.provision('trading-co');
    // this test drives the generic screens with one admin; segregation of duties (wave 8, on by default) is covered by purchasing's sod.test.ts and UAT-07
    await erp.call('PUT', '/api/purchasing/settings', { creatorCannotApprove: false }, token);
    web = await startWeb(erp.url, 3911);
    page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  });
  afterAll(async () => { await page?.close(); stopWeb(web); await erp?.close(); });

  it('logs in and shows only the purchased modules in the menu', async () => {
    await login(page, base, 'trading-co');
    const nav = page.getByRole('navigation');
    for (const label of ['ใบสั่งซื้อ', 'ใบสั่งขาย', 'ยอดคงเหลือ', 'สินค้าและวัตถุดิบ', 'ผู้ใช้']) await expect(nav.getByRole('link', { name: label, exact: true }).count()).resolves.toBe(1);
    expect(await nav.getByRole('link', { name: 'งานซ่อม' }).count()).toBe(0);
    await shot(page, '01-home');
  });

  it('creates master data through generated forms', async () => {
    await page.getByRole('navigation').getByRole('link', { name: 'สินค้าและวัตถุดิบ', exact: true }).click();
    await page.getByRole('link', { name: 'เพิ่มสินค้า' }).click();
    await page.getByLabel('รหัส', { exact: true }).fill('RM-STEEL');
    await page.getByLabel('ชื่อ', { exact: true }).fill('เหล็กแผ่น 2 มม.');
    await page.getByLabel('ประเภท').selectOption('raw');
    await page.getByLabel('หน่วยนับ').fill('kg');
    await page.getByRole('button', { name: 'บันทึกสินค้า' }).click();
    await page.getByRole('cell', { name: 'RM-STEEL' }).waitFor();

    await page.goto(`${base}/m/master-data/partnerNew`);
    await page.getByLabel('รหัส', { exact: true }).fill('S-001');
    await page.getByLabel('ชื่อ', { exact: true }).fill('บริษัท สยามเหล็ก จำกัด');
    await page.getByLabel('เป็น').selectOption('supplier');
    await page.getByLabel('เลขประจำตัวผู้เสียภาษี').fill('123');
    await page.getByRole('button', { name: 'บันทึกคู่ค้า' }).click();
    await page.locator('.field-error').first().waitFor(); // server rejects the checksum
    await expect(page.getByLabel('เลขประจำตัวผู้เสียภาษี').getAttribute('aria-invalid')).resolves.toBe('true');
    await page.getByLabel('เลขประจำตัวผู้เสียภาษี').fill('0105536000313');
    await page.getByRole('button', { name: 'บันทึกคู่ค้า' }).click();
    await page.getByRole('cell', { name: 'S-001' }).waitFor();
  });

  it('runs a purchase order: create with lookups -> approve -> receive -> stock appears', async () => {
    await page.goto(`${base}/m/purchasing/poNew`);
    await pick(page, page, 'ผู้ขาย', 'S-001');
    await pick(page, page.locator('.lines-editor'), 'สินค้า', 'RM-STEEL');
    await page.locator('.lines-editor').getByLabel('จำนวน').fill('100');
    await page.locator('.lines-editor').getByLabel('ราคาต่อหน่วย').fill('32.50');
    await shot(page, '02-po-form');
    await page.getByRole('button', { name: 'สร้างใบสั่งซื้อ' }).click();
    await page.getByRole('heading', { name: /^PO-\d{4}-0001$/ }).waitFor();
    await expect(page.locator('.fact', { hasText: 'ยอดรวม' }).textContent()).resolves.toContain('3,477.50');

    await page.getByRole('button', { name: 'อนุมัติ' }).click();
    await page.locator('.status', { hasText: 'อนุมัติแล้ว' }).waitFor();
    await page.getByRole('button', { name: 'รับของที่ค้างทั้งหมด' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'รับของที่ค้างทั้งหมด' }).click();
    await page.locator('.status', { hasText: 'รับครบ' }).waitFor();
    await shot(page, '03-po-received');

    await erp.settle();
    await page.goto(`${base}/m/inventory/balances`);
    const row = page.getByRole('row', { name: /RM-STEEL/ });
    await expect(row.textContent()).resolves.toContain('100');
    await row.click();
    await page.getByRole('heading', { name: 'สต็อกการ์ด' }).waitFor();
    await page.getByRole('cell', { name: 'รับเข้า' }).waitFor();
  });

  it('blocks over-issue with a clear message', async () => {
    await page.goto(`${base}/m/inventory/issue`);
    await pick(page, page, 'จากคลัง', 'MAIN');
    await pick(page, page.locator('.lines-editor'), 'สินค้า', 'RM-STEEL');
    await page.locator('.lines-editor').getByLabel('จำนวน').fill('999');
    await page.getByRole('button', { name: 'บันทึกจ่ายออก' }).click();
    await page.locator('.form-error').waitFor();
    await expect(page.locator('.form-error').textContent()).resolves.toMatch(/สต็อกไม่พอ: RM-STEEL ที่คลัง MAIN คงเหลือ 100/);
  });

  it('sells and prints a tax invoice', async () => {
    await page.goto(`${base}/m/master-data/partnerNew`);
    await page.getByLabel('รหัส', { exact: true }).fill('C-001');
    await page.getByLabel('ชื่อ', { exact: true }).fill('บริษัท ลูกค้าดี จำกัด');
    await page.getByLabel('เป็น').selectOption('customer');
    await page.getByRole('button', { name: 'บันทึกคู่ค้า' }).click();
    await page.getByRole('cell', { name: 'C-001' }).waitFor();

    await page.goto(`${base}/m/sales/soNew`);
    await pick(page, page, 'ลูกค้า', 'C-001');
    await pick(page, page.locator('.lines-editor'), 'สินค้า', 'RM-STEEL');
    await page.locator('.lines-editor').getByLabel('จำนวน').fill('10');
    await page.locator('.lines-editor').getByLabel('ราคาต่อหน่วย').fill('50');
    await page.getByRole('button', { name: 'สร้างใบสั่งขาย' }).click();
    await page.getByRole('heading', { name: /^SO-/ }).waitFor();
    await page.getByRole('button', { name: 'ยืนยันคำสั่งซื้อ' }).click();
    await page.getByRole('button', { name: 'บันทึกส่งของ' }).click();
    await page.getByRole('button', { name: 'ออกใบกำกับภาษี' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'ออกใบกำกับภาษี' }).click();
    await page.getByRole('heading', { name: /^INV-/ }).waitFor();
    await expect(page.locator('.fact', { hasText: 'ตัวอักษร' }).textContent()).resolves.toContain('ห้าร้อยสามสิบห้าบาทถ้วน');
    await shot(page, '04-invoice');

    await erp.settle();
    await page.goto(`${base}/m/inventory/balances`);
    await expect(page.getByRole('row', { name: /RM-STEEL/ }).textContent()).resolves.toContain('90');
  });

  it('creates a role with module permissions from the catalog', async () => {
    await page.goto(`${base}/m/identity/roleNew`);
    await page.getByLabel('ชื่อบทบาท').fill('พนักงานคลัง');
    await page.getByRole('checkbox', { name: 'ทุกสิทธิ์ของคลังสินค้า' }).check();
    await page.getByRole('checkbox', { name: 'ดูสินค้า/วัตถุดิบ' }).check();
    await page.getByRole('button', { name: 'บันทึกบทบาท' }).click();
    const row = page.getByRole('row', { name: /พนักงานคลัง/ });
    await expect(row.textContent()).resolves.toContain('inventory.*');
  });
});

describe('web app — customer with Core + Maintenance only', () => {
  let erp: Installation;
  let web: ChildProcess;
  let page: Page;
  const base = 'http://127.0.0.1:3912';

  beforeAll(async () => {
    erp = await install([identity, masterData, maintenance]);
    await erp.provision('factory-a');
    web = await startWeb(erp.url, 3912);
    page = await browser.newPage({ viewport: { width: 390, height: 844 } }); // phone
  });
  afterAll(async () => { await page?.close(); stopWeb(web); await erp?.close(); });

  it('shows only maintenance and core, and refuses screens of modules not installed', async () => {
    await login(page, base, 'factory-a');
    await page.getByRole('button', { name: 'เมนู' }).click();
    const nav = page.getByRole('navigation');
    expect(await nav.getByRole('link', { name: 'แจ้งซ่อม', exact: true }).count()).toBe(1);
    expect(await nav.getByRole('link', { name: 'ใบสั่งขาย' }).count()).toBe(0);
    await page.goto(`${base}/m/sales/soList`);
    await page.getByRole('heading', { name: 'ยังไม่ได้ติดตั้งโมดูลนี้' }).waitFor();
  });

  it('reports a breakdown from a phone and closes it', async () => {
    await page.goto(`${base}/m/maintenance/machineNew`);
    await page.getByLabel('รหัส (พิมพ์บน QR)').fill('PRESS-01');
    await page.getByLabel('ชื่อ', { exact: true }).fill('เครื่องปั๊ม 80 ตัน');
    await page.getByRole('button', { name: 'บันทึกเครื่องจักร' }).click();
    await page.getByRole('cell', { name: 'PRESS-01' }).waitFor();

    await page.goto(`${base}/m/maintenance/woNew`);
    await pick(page, page, 'เครื่องจักร', 'PRESS-01');
    await page.getByLabel('อาการ', { exact: true }).fill('น้ำมันไฮดรอลิกรั่ว');
    await page.getByRole('button', { name: 'แจ้งซ่อม' }).click();
    await page.getByRole('heading', { name: /^WO-/ }).waitFor();
    await shot(page, '05-mobile-wo');
    await page.getByRole('button', { name: 'รับงาน' }).click();
    await page.locator('.status', { hasText: 'กำลังซ่อม' }).waitFor();
    await page.getByRole('button', { name: 'ปิดงานซ่อม' }).click();
    const dlg = page.getByRole('dialog');
    await dlg.getByLabel('วิธีแก้').fill('เปลี่ยนซีลกระบอกสูบ');
    await dlg.getByLabel('เครื่องหยุด (นาที)').fill('45');
    await dlg.getByRole('button', { name: 'ปิดงานซ่อม' }).click();
    await page.locator('.status', { hasText: 'เสร็จแล้ว' }).waitFor();
  });
});
