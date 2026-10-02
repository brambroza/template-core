/** Wave 8: Thai business dates at night (round-2 #4 / accountant C10) and the lock date that follows Accounting's period close (C5). */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

async function company() {
  const id = randomUUID();
  const as = (name: string, perms: string[]) => t.token(['expense.claim.read', 'expense.claim.write', ...perms], id, { userId: randomUUID(), userName: name });
  const admin = t.token(['*'], id, { userId: randomUUID(), userName: 'แอดมิน' });
  const staff = as('สมชาย คลังดี', []);
  const approver = as('หัวหน้า', ['expense.claim.approve']);
  const payer = as('การเงิน', ['expense.claim.pay']);
  const cat = (await t.api('POST', '/categories', { code: 'TRAVEL', name: 'ค่าเดินทาง' }, { token: admin })).body;
  const approvedClaim = async (expenseDate: string) => {
    const c = (await t.api('POST', '/claims', { purpose: 'เดินทางพบลูกค้า', submit: true, lines: [{ expenseDate, categoryId: cat.id, amount: 300 }] }, { token: staff })).body;
    expect((await t.api('POST', `/claims/${c.id}/approve`, {}, { token: approver })).body.status).toBe('approved');
    return c;
  };
  return { id, as, admin, staff, approver, payer, approvedClaim };
}

describe('round-2 #4 / C10 — claim and payment dates at 02:39 Bangkok', () => {
  it('claim date, paid date and the claim_paid event are the Thai day, not the UTC day', async () => {
    const x = await company();
    setClock('2026-10-02T19:39:00Z'); // 02:39 on 3 Oct in Bangkok
    const c = await x.approvedClaim('2026-10-02');
    expect(c.claim_date).toBe('2026-10-03');
    const paid = (await t.api('POST', `/claims/${c.id}/pay`, { method: 'transfer' }, { token: x.payer })).body;
    expect(paid.paid_date).toBe('2026-10-03');
    expect((await t.published('expense.claim_paid')).find((e) => e.data.claimId === c.id)!.data.paidDate).toBe('2026-10-03');
    const adv = (await t.api('POST', '/advances', { purpose: 'ออกบูธ', amount: 1000 }, { token: x.staff })).body;
    await t.api('POST', `/advances/${adv.id}/approve`, undefined, { token: x.approver });
    expect((await t.api('POST', `/advances/${adv.id}/pay`, { method: 'cash' }, { token: x.payer })).body.paid_date).toBe('2026-10-03');
  });

  it('a payment cannot be dated in the future', async () => {
    const x = await company();
    const c = await x.approvedClaim('2026-09-01');
    expect((await t.api('POST', `/claims/${c.id}/pay`, { method: 'cash', paidDate: '2099-01-01' }, { token: x.payer })).status).toBe(400);
  });
});

describe('C5 — lock date on payments', () => {
  it('period_closed locks claim / advance payments on/before the period end; override with perm + reason; reopen unlocks', async () => {
    const x = await company();
    const c = await x.approvedClaim('2026-09-10');
    await t.deliver('accounting.period_closed', { period: '2026-09', lastDate: '2026-09-30' }, { tenantId: x.id });
    expect((await t.api('GET', '/lock', undefined, { token: x.payer })).body).toMatchObject({ lockDate: '2026-09-30', source: 'accounting' });
    const r = await t.api('POST', `/claims/${c.id}/pay`, { method: 'cash', paidDate: '2026-09-30' }, { token: x.payer });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('จ่ายเงินใบเบิก');
    const boss = x.as('ผู้จัดการการเงิน', ['expense.claim.pay', 'expense.lock.override']);
    expect((await t.api('POST', `/claims/${c.id}/pay`, { method: 'cash', paidDate: '2026-09-30' }, { token: boss })).status).toBe(409);
    expect((await t.api('POST', `/claims/${c.id}/pay`, { method: 'cash', paidDate: '2026-09-30', lockOverrideReason: 'จ่ายจริง 30 ก.ย. ตามสลิป' }, { token: boss })).body.paid_date).toBe('2026-09-30');

    const adv = (await t.api('POST', '/advances', { purpose: 'ออกบูธ', amount: 1000 }, { token: x.staff })).body;
    await t.api('POST', `/advances/${adv.id}/approve`, undefined, { token: x.approver });
    expect((await t.api('POST', `/advances/${adv.id}/pay`, { method: 'cash', paidDate: '2026-09-29' }, { token: x.payer })).status).toBe(409);
    await t.deliver('accounting.period_reopened', { period: '2026-09', firstDate: '2026-09-01' }, { tenantId: x.id });
    expect((await t.api('POST', `/advances/${adv.id}/pay`, { method: 'cash', paidDate: '2026-09-29' }, { token: x.payer })).status).toBe(200);
    // another company is not locked
    expect((await t.api('GET', '/lock', undefined, { token: t.token(['*'], randomUUID()) })).body.lockDate).toBeNull();
  });

  it('manual lock needs expense.lock.write; reading it needs pay or lock perms', async () => {
    const x = await company();
    expect((await t.api('POST', '/lock', { lockDate: '2026-08-31' }, { token: x.payer })).status).toBe(403);
    expect((await t.api('GET', '/lock', undefined, { token: x.staff })).status).toBe(403);
    expect((await t.api('POST', '/lock', { lockDate: '2026-08-31' }, { token: x.admin })).body).toMatchObject({ lockDate: '2026-08-31', source: 'manual', updatedByName: 'แอดมิน' });
  });
});
