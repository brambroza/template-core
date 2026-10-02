import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

/** Wave 8, round-2 blocker #1: approver ≠ payer (setting separatePayer, default on) and over-limit claims need approve-over-limit. */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const today = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
const STAFF = ['expense.claim.read', 'expense.claim.write'];
const who = (name: string, perms: string[], tenantId?: string) => t.token([...STAFF, ...perms], tenantId ?? t.tenantId, { userId: randomUUID(), userName: name });
let staff: string, head: string, acc: string, acc2: string, md: string, entertain: { id: string };
beforeAll(async () => {
  staff = who('สมชาย คลังดี', []);
  head = who('หัวหน้าแผนก', ['expense.claim.approve']);
  acc = who('สุดารัตน์ บัญชี', ['expense.claim.approve', 'expense.claim.pay']);
  acc2 = who('การเงิน 2', ['expense.claim.pay']);
  md = who('สมศักดิ์ MD', ['expense.claim.approve', 'expense.claim.approve-over-limit']);
  entertain = (await t.api('POST', '/categories', { code: 'ENTERTAIN', name: 'ค่ารับรองลูกค้า', monthlyLimit: 5000 })).body;
});
const claim = async (amount: number, by = staff) =>
  (await t.api('POST', '/claims', { purpose: 'รับรองลูกค้า', submit: true, lines: [{ expenseDate: today, categoryId: entertain.id, amount }] }, { token: by })).body;

describe('expense claim controls', () => {
  it('defaults to separatePayer on; only expense.settings.write may change it, per company', async () => {
    expect((await t.api('GET', '/settings', undefined, { token: staff })).body).toEqual({ separatePayer: true });
    expect((await t.api('PUT', '/settings', { separatePayer: false }, { token: acc })).status).toBe(403);
    expect((await t.api('PUT', '/settings', {})).status).toBe(400);
  });

  it('the approver of a claim cannot record its payment; another payer can', async () => {
    const c = await claim(1000);
    expect((await t.api('POST', `/claims/${c.id}/approve`, {}, { token: acc })).body.status).toBe('approved');
    const same = await t.api('POST', `/claims/${c.id}/pay`, { method: 'transfer' }, { token: acc });
    expect(same.status).toBe(403);
    expect(same.body.error.message).toContain('บันทึกจ่ายเงินเองไม่ได้');
    const paid = await t.api('POST', `/claims/${c.id}/pay`, { method: 'transfer' }, { token: acc2 });
    expect(paid.body).toMatchObject({ status: 'paid', approved_by_name: 'สุดารัตน์ บัญชี', paid_by_name: 'การเงิน 2' });
  });

  it('nobody pays their own claim', async () => {
    const c = await claim(500, acc2);
    await t.api('POST', `/claims/${c.id}/approve`, {}, { token: head });
    const own = await t.api('POST', `/claims/${c.id}/pay`, { method: 'cash' }, { token: acc2 });
    expect(own.status).toBe(403);
    expect(own.body.error.message).toContain('ของตนเองไม่ได้');
    expect((await t.api('POST', `/claims/${c.id}/pay`, { method: 'cash' }, { token: acc })).status).toBe(200);
  });

  it('advances: approver ≠ payer too', async () => {
    const adv = (await t.api('POST', '/advances', { purpose: 'ออกบูธ', amount: 3000 }, { token: staff })).body;
    await t.api('POST', `/advances/${adv.id}/approve`, undefined, { token: acc });
    expect((await t.api('POST', `/advances/${adv.id}/pay`, { method: 'cash' }, { token: acc })).status).toBe(403);
    expect((await t.api('POST', `/advances/${adv.id}/pay`, { method: 'cash' }, { token: acc2 })).body.status).toBe('paid');
  });

  it('a claim over the monthly limit needs expense.claim.approve-over-limit', async () => {
    // staff already used 1,000 this month; 4,500 more = 5,500 > 5,000
    const c = await claim(4500);
    expect(c.over_limit).toBe(true);
    for (const tok of [head, acc]) {
      const res = await t.api('POST', `/claims/${c.id}/approve`, {}, { token: tok });
      expect(res.status).toBe(403);
      expect(res.body.error.message).toContain('เกินวงเงินรายเดือน');
    }
    expect((await t.api('GET', `/claims/${c.id}`, undefined, { token: staff })).body.status).toBe('submitted');
    const ok = await t.api('POST', `/claims/${c.id}/approve`, {}, { token: md });
    expect(ok.body).toMatchObject({ status: 'approved', approved_by_name: 'สมศักดิ์ MD' });
    expect((await t.api('POST', `/claims/${c.id}/pay`, { method: 'transfer' }, { token: acc })).status).toBe(200);
  });

  it('within the limit an ordinary approver is enough (limit re-checked at approval)', async () => {
    const other = who('มาลี', []);
    const c = await claim(4000, other);
    expect(c.over_limit).toBe(false);
    expect((await t.api('POST', `/claims/${c.id}/approve`, {}, { token: head })).status).toBe(200);
  });

  it('a company may switch separatePayer off; settings are tenant-isolated', async () => {
    expect((await t.api('PUT', '/settings', { separatePayer: false })).body).toEqual({ separatePayer: false });
    const otherTenant = randomUUID();
    expect((await t.api('GET', '/settings', undefined, { token: t.token(['*'], otherTenant) })).body).toEqual({ separatePayer: true });
    const c = await claim(100, who('ใหม่', []));
    await t.api('POST', `/claims/${c.id}/approve`, {}, { token: acc });
    expect((await t.api('POST', `/claims/${c.id}/pay`, { method: 'cash' }, { token: acc })).status).toBe(200);
    await t.api('PUT', '/settings', { separatePayer: true });
  });
});
