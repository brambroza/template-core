import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '@erp/kernel';
import { bootTestService, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const STAFF = ['expense.claim.read', 'expense.claim.write'];
const as = (perms: string[]) => {
  const id = randomUUID();
  return { id, token: signToken(TEST_JWT_SECRET, { tenantId: t.tenantId, userId: id, perms }) };
};
const today = new Date().toISOString().slice(0, 10);

let somchai: ReturnType<typeof as>;
let manager: ReturnType<typeof as>;
let finance: ReturnType<typeof as>;
let fuel: any;
let hotel: any;

describe('expense', () => {
  it('sets up categories with monthly limits and receipt rules', async () => {
    somchai = as(STAFF);
    manager = as([...STAFF, 'expense.claim.approve']);
    finance = as(['expense.claim.read', 'expense.claim.pay']);
    const r = await t.api('POST', '/categories', { code: 'FUEL', name: 'ค่าน้ำมัน', monthlyLimit: 3000 });
    expect(r.status).toBe(201);
    fuel = r.body;
    hotel = (await t.api('POST', '/categories', { code: 'HOTEL', name: 'ค่าที่พัก', requiresReceipt: true })).body;
    expect(hotel).toMatchObject({ requires_receipt: true, monthly_limit: null });
    expect((await t.api('POST', '/categories', { code: 'FUEL', name: 'ซ้ำ' })).status).toBe(409);
    expect((await t.api('POST', '/categories', { code: 'X', name: 'x', monthlyLimit: -1 })).status).toBe(400);
    expect((await t.api('POST', '/categories', { code: 'X', name: 'x' }, { token: somchai.token })).status).toBe(403);
    expect((await t.api('GET', '/categories?active=true&q=FUEL')).body).toHaveLength(1);
  });

  it('creates a numbered claim with VAT totals and runs it through approve and pay', async () => {
    const res = await t.api('POST', '/claims', {
      purpose: 'ไปพบลูกค้าที่ระยอง', claimantName: 'สมชาย', department: 'ขาย', claimDate: '2026-10-02',
      lines: [
        { expenseDate: today, categoryId: fuel.id, description: 'เติมน้ำมัน', amount: 1000, vat: 70 },
        { expenseDate: today, categoryId: hotel.id, description: 'โรงแรม 1 คืน', amount: 1200, receiptNo: 'RC-889' },
      ],
    }, { token: somchai.token });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ no: 'EXP-2569-0001', status: 'draft', net: 2200, vat: 70, total: 2270, over_limit: false, warnings: [], total_text: 'สองพันสองร้อยเจ็ดสิบบาทถ้วน' });
    expect(res.body.lines.map((l: any) => [l.category_code, l.total])).toEqual([['FUEL', 1070], ['HOTEL', 1200]]);
    const id = res.body.id;

    expect((await t.api('POST', `/claims/${id}/approve`, {}, { token: manager.token })).status).toBe(409); // not submitted
    expect((await t.api('POST', `/claims/${id}/submit`, undefined, { token: somchai.token })).body.status).toBe('submitted');
    expect((await t.api('POST', `/claims/${id}/submit`, undefined, { token: somchai.token })).status).toBe(409);
    expect((await t.api('POST', `/claims/${id}/approve`, {}, { token: somchai.token })).status).toBe(403);
    expect((await t.api('POST', `/claims/${id}/pay`, { method: 'cash' }, { token: finance.token })).status).toBe(409); // not approved
    expect((await t.api('POST', `/claims/${id}/approve`, {}, { token: manager.token })).body.status).toBe('approved');

    const out = await t.api('GET', '/reports/outstanding', undefined, { token: finance.token });
    expect(out.body.items.map((x: any) => x.no)).toEqual(['EXP-2569-0001']);
    expect(out.body.toPayTotal).toBe(2270);

    expect((await t.api('POST', `/claims/${id}/pay`, { method: 'bitcoin' }, { token: finance.token })).status).toBe(400);
    const paid = await t.api('POST', `/claims/${id}/pay`, { method: 'transfer', paidDate: today, reference: 'KBANK-123' }, { token: finance.token });
    expect(paid.body).toMatchObject({ status: 'paid', pay_method: 'transfer', pay_method_label: 'โอนเงิน', pay_reference: 'KBANK-123', paid_date: today });
    expect((await t.api('POST', `/claims/${id}/pay`, { method: 'cash' }, { token: finance.token })).status).toBe(409);
  });

  it('warns (never blocks) when a category goes over its monthly limit', async () => {
    const res = await t.api('POST', '/claims', {
      purpose: 'ออกต่างจังหวัดอีกรอบ', submit: true,
      lines: [{ expenseDate: today, categoryId: fuel.id, amount: 2000 }],
    }, { token: somchai.token });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe('submitted');
    expect(res.body.over_limit).toBe(true);
    expect(res.body.warnings).toEqual([expect.objectContaining({ kind: 'limit', categoryCode: 'FUEL', limit: 3000, used: 3070 })]);
    expect(res.body.warnings[0].message).toContain('เกินวงเงิน 3,000.00');
    // another employee has their own limit
    const other = await t.api('POST', '/claims', { purpose: 'x', lines: [{ expenseDate: today, categoryId: fuel.id, amount: 2500 }] }, { token: manager.token });
    expect(other.body.over_limit).toBe(false);
    // rejecting brings the claimant's usage back under the limit on that claim
    expect((await t.api('POST', `/claims/${res.body.id}/reject`, {}, { token: manager.token })).status).toBe(400); // reason required
    const rej = await t.api('POST', `/claims/${res.body.id}/reject`, { note: 'เกินระเบียบ' }, { token: manager.token });
    expect(rej.body).toMatchObject({ status: 'rejected', last_note: 'เกินระเบียบ' });
    expect((await t.api('POST', `/claims/${res.body.id}/submit`, undefined, { token: somchai.token })).status).toBe(409);
  });

  it('requires receipts before submit, and supports return → fix lines → resubmit, and cancel', async () => {
    const c = (await t.api('POST', '/claims', { purpose: 'สัมมนา', lines: [{ expenseDate: today, categoryId: hotel.id, amount: 1500 }] }, { token: somchai.token })).body;
    expect(c.warnings).toEqual([expect.objectContaining({ kind: 'receipt', lineNo: 1 })]);
    expect((await t.api('POST', `/claims/${c.id}/submit`, undefined, { token: somchai.token })).status).toBe(400);
    const fixed = await t.api('PUT', `/claims/${c.id}/lines`, { lines: [{ expenseDate: today, categoryId: hotel.id, amount: 1500, receiptNo: 'H-1' }] }, { token: somchai.token });
    expect(fixed.body).toMatchObject({ total: 1500, warnings: [] });
    await t.api('POST', `/claims/${c.id}/submit`, undefined, { token: somchai.token });
    expect((await t.api('POST', `/claims/${c.id}/return`, { note: 'แนบรูปใบเสร็จ' }, { token: manager.token })).body.status).toBe('returned');
    const edited = await t.api('PUT', `/claims/${c.id}`, { purpose: 'สัมมนา BOI', department: 'บัญชี' }, { token: somchai.token });
    expect(edited.body).toMatchObject({ purpose: 'สัมมนา BOI', department: 'บัญชี', status: 'returned' });
    expect((await t.api('PUT', `/claims/${c.id}`, { purpose: 'x' }, { token: as(STAFF).token })).status).toBe(404); // not theirs
    expect((await t.api('POST', `/claims/${c.id}/submit`, undefined, { token: somchai.token })).body.status).toBe('submitted');
    expect((await t.api('PUT', `/claims/${c.id}/lines`, { lines: [{ expenseDate: today, categoryId: hotel.id, amount: 1, receiptNo: 'x' }] }, { token: somchai.token })).status).toBe(409);
    expect((await t.api('POST', `/claims/${c.id}/cancel`, {}, { token: somchai.token })).status).toBe(409);

    const d = (await t.api('POST', '/claims', { purpose: 'ทดสอบ', lines: [{ expenseDate: today, categoryId: fuel.id, amount: 10 }] }, { token: somchai.token })).body;
    expect((await t.api('POST', `/claims/${d.id}/cancel`, {}, { token: somchai.token })).body.status).toBe('cancelled');
  });

  it('validates claims', async () => {
    expect((await t.api('POST', '/claims', { purpose: 'x', lines: [] })).status).toBe(400);
    expect((await t.api('POST', '/claims', { purpose: 'x', lines: [{ expenseDate: today, categoryId: randomUUID(), amount: 1 }] })).status).toBe(400);
    expect((await t.api('POST', '/claims', { purpose: 'x', lines: [{ expenseDate: '02/10/2026', categoryId: fuel.id, amount: 1 }] })).status).toBe(400);
    expect((await t.api('POST', '/claims', { purpose: 'x', lines: [{ expenseDate: today, categoryId: fuel.id, amount: -5 }] })).status).toBe(400);
    const old = (await t.api('POST', '/categories', { code: 'OLD', name: 'เลิกใช้', active: false })).body;
    expect((await t.api('POST', '/claims', { purpose: 'x', lines: [{ expenseDate: today, categoryId: old.id, amount: 1 }] })).status).toBe(400);
  });

  it('runs a cash advance to cleared against a claim, computing what to return', async () => {
    const adv = (await t.api('POST', '/advances', { purpose: 'ออกบูธงานแฟร์', amount: 5000, requesterName: 'สมชาย' }, { token: somchai.token })).body;
    expect(adv).toMatchObject({ no: 'ADV-2569-0001', status: 'requested', amount: 5000, amount_text: 'ห้าพันบาทถ้วน' });
    expect((await t.api('POST', `/advances/${adv.id}/pay`, { method: 'cash' }, { token: finance.token })).status).toBe(409);
    expect((await t.api('POST', `/advances/${adv.id}/approve`, undefined, { token: somchai.token })).status).toBe(403);
    expect((await t.api('POST', `/advances/${adv.id}/approve`, undefined, { token: manager.token })).body.status).toBe('approved');
    expect((await t.api('POST', `/advances/${adv.id}/pay`, { method: 'cash' }, { token: finance.token })).body.status).toBe('paid');
    expect((await t.api('GET', '/reports/outstanding', undefined, { token: finance.token })).body.advanceTotal).toBe(5000);

    const claim = (await t.api('POST', '/claims', {
      purpose: 'ค่าใช้จ่ายงานแฟร์', submit: true,
      lines: [{ expenseDate: today, categoryId: hotel.id, amount: 4000, receiptNo: 'H-9' }, { expenseDate: today, categoryId: fuel.id, amount: 500 }],
    }, { token: somchai.token })).body;
    expect((await t.api('POST', `/advances/${adv.id}/clear`, { claimId: claim.id }, { token: finance.token })).status).toBe(409); // claim not approved yet
    await t.api('POST', `/claims/${claim.id}/approve`, {}, { token: manager.token });
    const otherClaim = (await t.api('POST', '/claims', { purpose: 'y', submit: true, lines: [{ expenseDate: today, categoryId: fuel.id, amount: 5 }] }, { token: manager.token })).body;
    await t.api('POST', `/claims/${otherClaim.id}/approve`, {}, { token: manager.token });
    expect((await t.api('POST', `/advances/${adv.id}/clear`, { claimId: otherClaim.id }, { token: finance.token })).status).toBe(409); // someone else's claim

    const cleared = await t.api('POST', `/advances/${adv.id}/clear`, { claimId: claim.id }, { token: finance.token });
    expect(cleared.body).toMatchObject({ status: 'cleared', claim_no: claim.no, claim_total: 4500, settle_amount: -500, settle_text: 'พนักงานคืนเงินบริษัท 500.00 บาท' });
    const after = (await t.api('GET', `/claims/${claim.id}`, undefined, { token: somchai.token })).body;
    expect(after).toMatchObject({ advance_no: 'ADV-2569-0001', advance_amount: 5000, net_payable: -500 });
    expect((await t.api('POST', `/advances/${adv.id}/clear`, { claimId: claim.id }, { token: finance.token })).status).toBe(409);

    const adv2 = (await t.api('POST', '/advances', { purpose: 'ยกเลิก', amount: 100 }, { token: somchai.token })).body;
    expect((await t.api('POST', `/advances/${adv2.id}/cancel`, undefined, { token: somchai.token })).body.status).toBe('cancelled');
    const adv3 = (await t.api('POST', '/advances', { purpose: 'z', amount: 100 }, { token: somchai.token })).body;
    expect((await t.api('POST', `/advances/${adv3.id}/reject`, { note: 'ไม่จำเป็น' }, { token: manager.token })).body.status).toBe('rejected');
    expect((await t.api('POST', '/advances', { purpose: 'z', amount: 0 }, { token: somchai.token })).status).toBe(400);
  });

  it('shows staff only their own claims; approvers and finance see all', async () => {
    const mine = (await t.api('GET', '/my-claims', undefined, { token: somchai.token })).body;
    expect(mine.length).toBe(5);
    expect((await t.api('GET', '/claims', undefined, { token: somchai.token })).body).toHaveLength(5);
    expect((await t.api('GET', '/claims', undefined, { token: finance.token })).body).toHaveLength(7);
    expect((await t.api('GET', '/claims?status=paid&q=ระยอง', undefined, { token: finance.token })).body).toHaveLength(1);
    expect((await t.api('GET', `/claims?mine=1`, undefined, { token: manager.token })).body).toHaveLength(2);
    const stranger = as(STAFF);
    expect((await t.api('GET', '/claims', undefined, { token: stranger.token })).body).toEqual([]);
    expect((await t.api('GET', `/claims/${mine[0].id}`, undefined, { token: stranger.token })).status).toBe(404);
    expect((await t.api('GET', '/advances', undefined, { token: stranger.token })).body).toEqual([]);
  });

  it('reports spend by category, monthly trend and a dashboard summary', async () => {
    const cats = (await t.api('GET', '/reports/by-category', undefined, { token: finance.token })).body;
    const fuelRow = cats.find((c: any) => c.code === 'FUEL');
    // live this month: 1070 (paid) + 500 (approved) + 5 (approved) — draft 2500 and rejected/cancelled excluded
    expect(fuelRow).toMatchObject({ total: 1575, claims: 3, people: 2, monthly_limit: 3000 });
    expect((await t.api('GET', '/reports/by-category?month=2020-01')).body.every((c: any) => c.total === 0)).toBe(true);
    expect((await t.api('GET', '/reports/by-category?month=2020-1')).status).toBe(400);

    const sum = (await t.api('GET', '/summary', undefined, { token: finance.token })).body;
    expect(sum).toMatchObject({ toApprove: 1, toPay: 2, toPayAmount: 5 - 500, paidThisMonth: 2270, advancesOutstanding: 0 });
    expect(sum.months).toHaveLength(6);
    expect(sum.months[5].total).toBeGreaterThan(0);
    expect(sum.byCategory.map((c: any) => c.code).sort()).toEqual(['FUEL', 'HOTEL']);
    expect(sum.rows.length).toBeGreaterThan(0);
    const own = (await t.api('GET', '/summary', undefined, { token: manager.token })).body; // approvers see all
    expect(own.toApprove).toBe(1);
  });

  it('requires permissions', async () => {
    const reader = t.token(['expense.claim.read']);
    expect((await t.api('POST', '/claims', { purpose: 'x', lines: [{ expenseDate: today, categoryId: fuel.id, amount: 1 }] }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/advances', { purpose: 'x', amount: 1 }, { token: reader })).status).toBe(403);
    expect((await t.api('GET', '/summary', undefined, { token: t.token([]) })).status).toBe(403);
    const claim = (await t.api('GET', '/claims?status=approved')).body[0];
    expect((await t.api('POST', `/claims/${claim.id}/pay`, { method: 'cash' }, { token: manager.token })).status).toBe(403);
  });

  it('keeps tenants apart', async () => {
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/categories', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('GET', '/claims', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('GET', '/advances', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('POST', '/claims', { purpose: 'x', lines: [{ expenseDate: today, categoryId: fuel.id, amount: 1 }] }, { token: other })).status).toBe(400);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body).toMatchObject({ toApprove: 0, toPay: 0, rows: [] });
  });
});

describe('expense events (for Automation alerts)', () => {
  it('publishes claim_submitted (with the over-limit flag) and claim_paid through the outbox', async () => {
    const sub = (await t.published('expense.claim_submitted')).map((e) => e.data);
    expect(sub.find((d: any) => d.no === 'EXP-2569-0001')).toEqual(expect.objectContaining({ claimantName: 'สมชาย', total: 2270, overLimit: false }));
    expect(sub.find((d: any) => d.no === 'EXP-2569-0002')).toMatchObject({ total: 2000, overLimit: true });
    const paid = (await t.published('expense.claim_paid')).map((e) => e.data);
    expect(paid.find((d: any) => d.no === 'EXP-2569-0001')).toMatchObject({ claimantName: 'สมชาย', total: 2270 });
    // a draft publishes nothing; a refused submit publishes nothing
    const before = (await t.published('expense.claim_submitted')).length;
    const draft = (await t.api('POST', '/claims', { purpose: 'ร่าง', lines: [{ expenseDate: today, categoryId: hotel.id, amount: 500 }] }, { token: somchai.token })).body;
    expect((await t.api('POST', `/claims/${draft.id}/submit`, undefined, { token: somchai.token })).status).toBe(400); // receipt missing
    expect((await t.published('expense.claim_submitted')).length).toBe(before);
  });
});
