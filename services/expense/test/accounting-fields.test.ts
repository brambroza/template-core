/** Wave 5: expense.claim_paid carries what Accounting needs (paid date, method, category lines with VAT, cleared advance). */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);

describe('expense.claim_paid for accounting', () => {
  it('lists each line with category, amount before VAT and VAT, plus paid date and method', async () => {
    const tenantId = randomUUID();
    const staff = t.token(['expense.claim.read', 'expense.claim.write'], tenantId, { userId: randomUUID(), userName: 'สมชาย' });
    const boss = t.token(['*'], tenantId, { userId: randomUUID(), userName: 'ผู้จัดการ' });
    const cashier = t.token(['expense.claim.read', 'expense.claim.pay'], tenantId, { userId: randomUUID(), userName: 'การเงิน' });
    const api = (m: string, url: string, body: unknown, token: string) => t.api(m, url, body, { token });
    const fuel = (await api('POST', '/categories', { code: 'FUEL', name: 'ค่าน้ำมัน' }, boss)).body;
    const meal = (await api('POST', '/categories', { code: 'ENTERTAIN', name: 'ค่ารับรอง' }, boss)).body;
    const cl = (await api('POST', '/claims', { purpose: 'ไปพบลูกค้า', department: 'ขาย', submit: true, lines: [
      { expenseDate: today, categoryId: fuel.id, description: 'เติมน้ำมัน', amount: 1000, vat: 70 },
      { expenseDate: today, categoryId: meal.id, description: 'เลี้ยงรับรอง', amount: 500 },
    ] }, staff)).body;
    expect((await api('POST', `/claims/${cl.id}/approve`, {}, boss)).status).toBe(200);
    expect((await api('POST', `/claims/${cl.id}/pay`, { method: 'cash', paidDate: today, reference: 'PV-1' }, cashier)).status).toBe(200);
    const ev = (await t.published('expense.claim_paid')).map((e) => e.data).find((d) => d.claimId === cl.id);
    expect(ev).toMatchObject({ no: cl.no, total: 1570, paidDate: today, payMethod: 'cash', department: 'ขาย', lines: [
      { categoryCode: 'FUEL', categoryName: 'ค่าน้ำมัน', amount: 1000, vat: 70, description: 'เติมน้ำมัน' },
      { categoryCode: 'ENTERTAIN', categoryName: 'ค่ารับรอง', amount: 500, vat: 0, description: 'เลี้ยงรับรอง' },
    ] });
    // C3: no seller tax ID → the fuel VAT is not creditable; entertainment is ภาษีซื้อต้องห้าม (auto from the name)
    expect(ev.lines.map((l: any) => [l.categoryCode, l.vatClaimable, l.receiptType])).toEqual([['FUEL', false, 'full_tax_invoice'], ['ENTERTAIN', false, 'none']]);
    expect(ev.advanceAmount).toBeUndefined();
    expect(() => parseEvent('expense.claim_paid', ev)).not.toThrow();
  });

  it('C3: only a full tax invoice with the seller tax ID in a claimable category credits input VAT (accountant: 336 entertainment, 70 abbreviated fuel, 10% rejected)', async () => {
    const tenantId = randomUUID();
    const staff = t.token(['expense.claim.read', 'expense.claim.write'], tenantId, { userId: randomUUID(), userName: 'สมชาย' });
    const boss = t.token(['*'], tenantId, { userId: randomUUID(), userName: 'ผู้จัดการ' });
    const cashier = t.token(['expense.claim.read', 'expense.claim.pay'], tenantId, { userId: randomUUID(), userName: 'การเงิน' });
    const api = (m: string, url: string, body: unknown, token: string) => t.api(m, url, body, { token });
    const ent = (await api('POST', '/categories', { code: 'ENTERTAIN', name: 'ค่ารับรองลูกค้า' }, boss)).body;
    const car = (await api('POST', '/categories', { code: 'CARFUEL', name: 'น้ำมันรถยนต์นั่ง (รถเก๋ง)' }, boss)).body;
    const truck = (await api('POST', '/categories', { code: 'TRUCKFUEL', name: 'น้ำมันรถกระบะขนส่ง' }, boss)).body;
    const office = (await api('POST', '/categories', { code: 'OFFICE', name: 'เครื่องเขียน' }, boss)).body;
    expect([ent.vat_claimable, car.vat_claimable, truck.vat_claimable, office.vat_claimable]).toEqual([false, false, true, true]);
    const seller = { vendorName: 'ภัตตาคารริมน้ำ', vendorTaxId: '0105556123453', vendorBranch: '00000', receiptNo: 'INV-7788', receiptType: 'full_tax_invoice' };
    // stationery 500 + VAT 50 (= 10%): not a Thai VAT → 400 with a Thai message
    const bad = await api('POST', '/claims', { purpose: 'เครื่องเขียน', lines: [{ expenseDate: today, categoryId: office.id, amount: 500, vat: 50 }] }, staff);
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('ไม่ใช่ 7%');
    expect(bad.body.error.details.fieldErrors.vat).toBeDefined();
    // ± 1 baht for the seller's rounding is fine
    expect((await api('POST', '/claims', { purpose: 'ปัดเศษ', lines: [{ expenseDate: today, categoryId: office.id, amount: 99.5, vat: 7.9 }] }, staff)).status).toBe(201);
    expect((await api('POST', '/claims', { purpose: 'เลขผิด', lines: [{ expenseDate: today, categoryId: office.id, amount: 100, vat: 7, ...seller, vendorTaxId: '0105556123454' }] }, staff)).status).toBe(400);
    const cl = (await api('POST', '/claims', { purpose: 'พบลูกค้า', submit: true, lines: [
      { expenseDate: today, categoryId: ent.id, description: 'เลี้ยงรับรองลูกค้า', amount: 4800, vat: 336, ...seller },
      { expenseDate: today, categoryId: car.id, description: 'น้ำมันรถเก๋ง', amount: 1000, vat: 70, receiptType: 'abbreviated', vendorName: 'ปั๊ม' },
      { expenseDate: today, categoryId: truck.id, description: 'น้ำมันรถส่งของ (อย่างย่อ)', amount: 2000, vat: 140, receiptType: 'abbreviated' },
      { expenseDate: today, categoryId: truck.id, description: 'น้ำมันรถส่งของ', amount: 3000, vat: 210, ...seller, vendorName: 'ปั๊ม ปตท.' },
      { expenseDate: today, categoryId: office.id, description: 'กระดาษ', amount: 500, vat: 35, ...seller, vendorTaxId: undefined },
    ] }, staff)).body;
    expect(cl.lines.map((l: any) => l.vat_claimable)).toEqual([false, false, false, true, false]);
    // 336 + 70 + 140 + 35 go into the expense; only 210 is ภาษีซื้อ
    expect(cl).toMatchObject({ vat: 791, input_vat: 210, vat_expensed: 581, total: 12091 });
    expect(cl.warnings.filter((w: any) => w.kind === 'vat').map((w: any) => [w.lineNo, w.vat])).toEqual([[1, 336], [2, 70], [3, 140], [5, 35]]);
    expect(cl.warnings.find((w: any) => w.lineNo === 1).message).toContain('ภาษีซื้อต้องห้าม');
    expect(cl.warnings.find((w: any) => w.lineNo === 3).message).toContain('อย่างย่อ');
    expect((await api('POST', `/claims/${cl.id}/approve`, {}, boss)).status).toBe(200);
    expect((await api('POST', `/claims/${cl.id}/pay`, { method: 'transfer', paidDate: today }, cashier)).status).toBe(200);
    const ev = (await t.published('expense.claim_paid')).map((e) => e.data).find((d) => d.claimId === cl.id);
    expect(ev.lines[0]).toMatchObject({ amount: 4800, vat: 336, vatClaimable: false, receiptType: 'full_tax_invoice', vendorName: 'ภัตตาคารริมน้ำ', vendorTaxId: '0105556123453', vendorBranch: '00000', receiptNo: 'INV-7788', expenseDate: today });
    expect(ev.lines[3]).toMatchObject({ vat: 210, vatClaimable: true, vendorName: 'ปั๊ม ปตท.' });
    expect(() => parseEvent('expense.claim_paid', ev)).not.toThrow();
    // a company may decide otherwise for a category (category write permission), and other companies never see it
    expect((await api('PUT', `/categories/${truck.id}`, { vatClaimable: false }, staff)).status).toBe(403);
    expect((await api('PUT', `/categories/${truck.id}`, { vatClaimable: false }, boss)).body.vat_claimable).toBe(false);
    expect((await api('GET', `/categories/${truck.id}`, undefined, t.token(['*'], randomUUID()))).status).toBe(404);
  });
});
