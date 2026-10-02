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
    const api = (m: string, url: string, body: unknown, token: string) => t.api(m, url, body, { token });
    const fuel = (await api('POST', '/categories', { code: 'FUEL', name: 'ค่าน้ำมัน' }, boss)).body;
    const meal = (await api('POST', '/categories', { code: 'ENTERTAIN', name: 'ค่ารับรอง' }, boss)).body;
    const cl = (await api('POST', '/claims', { purpose: 'ไปพบลูกค้า', department: 'ขาย', submit: true, lines: [
      { expenseDate: today, categoryId: fuel.id, description: 'เติมน้ำมัน', amount: 1000, vat: 70 },
      { expenseDate: today, categoryId: meal.id, description: 'เลี้ยงรับรอง', amount: 500 },
    ] }, staff)).body;
    expect((await api('POST', `/claims/${cl.id}/approve`, {}, boss)).status).toBe(200);
    expect((await api('POST', `/claims/${cl.id}/pay`, { method: 'cash', paidDate: today, reference: 'PV-1' }, boss)).status).toBe(200);
    const ev = (await t.published('expense.claim_paid')).map((e) => e.data).find((d) => d.claimId === cl.id);
    expect(ev).toMatchObject({ no: cl.no, total: 1570, paidDate: today, payMethod: 'cash', department: 'ขาย', lines: [
      { categoryCode: 'FUEL', categoryName: 'ค่าน้ำมัน', amount: 1000, vat: 70, description: 'เติมน้ำมัน' },
      { categoryCode: 'ENTERTAIN', categoryName: 'ค่ารับรอง', amount: 500, vat: 0, description: 'เลี้ยงรับรอง' },
    ] });
    expect(ev.advanceAmount).toBeUndefined();
    expect(() => parseEvent('expense.claim_paid', ev)).not.toThrow();
  });
});
