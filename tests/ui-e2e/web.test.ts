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
import { definition as production } from '@erp/svc-production';
import { install, type Installation } from '../e2e/helpers.ts';
import { CHROMIUM, login, pick, startWeb, stopWeb } from './browser.ts';

const SHOTS = process.env.SCREENSHOT_DIR;

const shot = async (page: Page, name: string) => { if (SHOTS) { mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: true }); } };

let browser: Browser;
beforeAll(async () => { browser = await chromium.launch({ executablePath: CHROMIUM }); });
afterAll(async () => { await browser?.close(); });

describe('web app — customer with Core + Inventory + Purchasing + Sales', () => {
  let erp: Installation;
  let token: string;
  let web: ChildProcess;
  let page: Page;
  const base = 'http://127.0.0.1:3911';

  beforeAll(async () => {
    erp = await install([identity, masterData, inventory, purchasing, sales]);
    ({ token } = await erp.provision('trading-co'));
    // this test drives the generic screens with one admin; segregation of duties (wave 8, on by default) is covered by purchasing's sod.test.ts and UAT-07
    await erp.call('PUT', '/api/purchasing/settings', { creatorCannotApprove: false }, token);
    web = await startWeb(erp.url, 3911);
    page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  });
  afterAll(async () => { await page?.close(); stopWeb(web); await erp?.close(); });

  it('logs in and shows only the purchased modules in the menu', async () => {
    await login(page, base, 'trading-co');
    const nav = page.getByRole('navigation');
    // the menu fills in after the module catalog loads: wait for each item, then make sure it is there exactly once
    for (const label of ['ใบสั่งซื้อ', 'ใบสั่งขาย', 'ยอดคงเหลือ', 'สินค้าและวัตถุดิบ', 'ผู้ใช้']) {
      await nav.getByRole('link', { name: label, exact: true }).first().waitFor({ timeout: 15000 });
      await expect(nav.getByRole('link', { name: label, exact: true }).count()).resolves.toBe(1);
    }
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

  it('pages a long list: 25 rows a page, page buttons, rows per page', async () => {
    for (let i = 1; i <= 40; i++) {
      const code = `CUS-P${String(i).padStart(3, '0')}`;
      await erp.call('POST', '/api/master-data/partners', { code, name: `ลูกค้าทดสอบ ${i}`, kind: 'customer' }, token);
    }
    await page.goto(`${base}/m/master-data/partners`);
    await page.getByRole('cell', { name: 'CUS-P001' }).waitFor();
    const pager = page.getByRole('navigation', { name: 'แบ่งหน้า' });
    await expect(pager.getByRole('status').textContent()).resolves.toMatch(/แสดง 1–25 จาก 4\d รายการ/);
    expect(await page.locator('tbody tr').count()).toBe(25);
    await pager.getByRole('button', { name: 'หน้า 2' }).click();
    await page.getByRole('cell', { name: 'CUS-P040' }).waitFor();
    expect(await page.getByRole('cell', { name: 'CUS-P001' }).count()).toBe(0);
    await expect(pager.getByRole('button', { name: 'หน้า 2' }).getAttribute('aria-current')).resolves.toBe('page');
    await pager.getByLabel('จำนวนรายการต่อหน้า').selectOption('50');
    expect(await page.locator('tbody tr').count()).toBeGreaterThan(40);
    expect(await pager.getByRole('button', { name: 'หน้า 2' }).count()).toBe(0);
    // a new search starts again on page 1
    await pager.getByLabel('จำนวนรายการต่อหน้า').selectOption('25');
    await pager.getByRole('button', { name: 'หน้า 2' }).click();
    await page.getByLabel('ค้นหารหัสหรือชื่อ').fill('ลูกค้าทดสอบ 3');
    await page.getByRole('cell', { name: 'CUS-P003' }).waitFor();
    expect(await pager.getByRole('button', { name: 'หน้า 2' }).count()).toBe(0);
  });

  it('picks dates in Thai: Buddhist years, typed in any form, calendar, select-all and retype', async () => {
    await page.goto(`${base}/m/purchasing/poNew`);
    const due = page.getByLabel('กำหนดส่ง', { exact: true });
    await due.fill('2026-11-20');
    await page.getByLabel('หมายเหตุ').click();
    await expect(due.inputValue()).resolves.toBe('20 พ.ย. 2569');
    // replace a filled date by selecting it and typing (the regression: text must not change on focus)
    await due.fill('31/12/2569');
    await page.getByLabel('หมายเหตุ').click();
    await expect(due.inputValue()).resolves.toBe('31 ธ.ค. 2569');
    // the calendar opens on the chosen month, in Buddhist years, and a click picks the day
    await page.locator('[data-field="expectedDate"]').getByRole('button', { name: 'เปิดปฏิทิน' }).click();
    const cal = page.getByRole('dialog', { name: 'เลือกวันที่' });
    await expect(cal.locator('.cal-title').textContent()).resolves.toBe('ธันวาคม 2569');
    await cal.getByRole('button', { name: '15 ธันวาคม 2569' }).click();
    await expect(due.inputValue()).resolves.toBe('15 ธ.ค. 2569');
    await expect(cal.count()).resolves.toBe(0);
    // keyboard: Alt+↓ opens, → moves a day, Enter picks
    await due.focus();
    await due.press('Alt+ArrowDown');
    await cal.waitFor();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('Enter');
    await expect(due.inputValue()).resolves.toBe('16 ธ.ค. 2569');
    await shot(page, '08-date-picker');
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

describe('web app — multi-level BOM (production)', () => {
  let erp: Installation;
  let token: string;
  let web: ChildProcess;
  let page: Page;
  const base = 'http://127.0.0.1:3914';
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    erp = await install([identity, masterData, production]);
    ({ token } = await erp.provision('bom-co'));
    for (const [code, name, type] of [['RM-SHEET', 'เหล็กแผ่น', 'raw'], ['SP-SCREW', 'สกรู', 'spare'], ['SA-PANEL', 'แผ่นบาน', 'semi'], ['SA-DOOR', 'บานประตู', 'semi'], ['FG-CAB', 'ตู้เหล็ก', 'finished']]) {
      ids[code] = (await erp.call('POST', '/api/master-data/items', { code, name, type }, token)).body.id;
    }
    const it = (code: string, name: string) => ({ itemId: ids[code], itemCode: code, itemName: name });
    await erp.call('PUT', '/api/production/boms', { ...it('SA-PANEL', 'แผ่นบาน'), lines: [{ ...it('RM-SHEET', 'เหล็กแผ่น'), qty: 2 }] }, token);
    await erp.call('PUT', '/api/production/boms', { ...it('SA-DOOR', 'บานประตู'), lines: [{ ...it('SA-PANEL', 'แผ่นบาน'), qty: 1 }, { ...it('SP-SCREW', 'สกรู'), qty: 6 }] }, token);
    await erp.call('PUT', '/api/production/boms', { ...it('FG-CAB', 'ตู้เหล็ก'), lines: [{ ...it('SA-DOOR', 'บานประตู'), qty: 2 }, { ...it('SP-SCREW', 'สกรู'), qty: 10 }] }, token);
    web = await startWeb(erp.url, 3914);
    page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    await login(page, base, 'bom-co');
  });
  afterAll(async () => { await page?.close(); stopWeb(web); await erp?.close(); });

  it('shows every level, folds a sub-assembly, opens its own BOM', async () => {
    await page.goto(`${base}/m/production/bomDetail/${ids['FG-CAB']}`);
    const tree = page.locator('table.tree').first();
    await tree.getByRole('cell', { name: /RM-SHEET/ }).waitFor();
    await expect(tree.locator('tbody tr').evaluateAll((rows) => rows.map((r) => `${r.getAttribute('data-level')} ${r.querySelector('td')!.textContent!.replace(/สร้างสูตรย่อย/, '').trim()}`)))
      .resolves.toEqual(['1 SA-DOOR', '2 SA-PANEL', '3 RM-SHEET', '2 SP-SCREW', '1 SP-SCREW']);
    // 2 doors × 1 panel × 2 sheets = 4; screws 2×6 + 10 = 22 in the all-levels total
    await page.getByText('3 ระดับ · 5 รายการ').waitFor();
    await page.getByRole('button', { name: 'ย่อ SA-DOOR' }).click();
    expect(await tree.locator('tbody tr:visible').count()).toBe(2);
    await page.getByRole('button', { name: 'ขยาย SA-DOOR' }).click();
    expect(await tree.locator('tbody tr:visible').count()).toBe(5);
    await shot(page, '20-bom-tree');
    await tree.getByRole('link', { name: 'SA-PANEL' }).click();
    await page.getByRole('heading', { name: 'SA-PANEL' }).waitFor();
    // where-used two levels up
    const used = page.locator('table.tree').nth(1);
    await used.getByRole('link', { name: 'FG-CAB' }).waitFor();
    await expect(used.getByRole('link', { name: 'SA-DOOR' }).count()).resolves.toBe(1);
  });

  it('adds a level from a bought part and edits a BOM with its lines loaded', async () => {
    await page.goto(`${base}/m/production/bomDetail/${ids['SA-PANEL']}`);
    const row = page.locator('table.tree').first().locator('tbody tr').first();
    await row.hover();
    await row.getByRole('link', { name: /สร้างสูตรย่อย/ }).click();
    // the form opens with the part chosen as the product
    await expect(page.getByLabel('สินค้าที่ผลิต').inputValue()).resolves.toBe('RM-SHEET  เหล็กแผ่น');
    await pick(page, page, 'ส่วนประกอบ', 'SP-SCREW');
    await page.getByLabel('ใช้ต่อสูตร').first().fill('0.5');
    await page.getByRole('button', { name: 'บันทึกสูตร' }).click();
    await page.getByRole('heading', { name: 'RM-SHEET' }).waitFor();
    // FG-CAB is now 4 levels deep
    const cab = (await erp.call('GET', `/api/production/boms/${ids['FG-CAB']}`, undefined, token)).body;
    expect(cab.levels).toBe(4);

    await page.goto(`${base}/m/production/bomDetail/${ids['SA-DOOR']}`);
    await page.getByText('แก้ไข', { exact: true }).click();
    await expect(page.getByLabel('สินค้าที่ผลิต').inputValue()).resolves.toBe('SA-DOOR  บานประตู');
    const qty = page.getByLabel('ใช้ต่อสูตร');
    await expect(qty.count()).resolves.toBe(2);
    await expect(qty.nth(1).inputValue()).resolves.toBe('6');
    await qty.nth(1).fill('8');
    await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
    await page.getByRole('heading', { name: 'SA-DOOR' }).waitFor();
    const door = (await erp.call('GET', `/api/production/boms/${ids['SA-DOOR']}`, undefined, token)).body;
    expect(door.lines.map((l: any) => [l.item_code, l.qty])).toEqual([['SA-PANEL', 1], ['SP-SCREW', 8]]);
  });
});
