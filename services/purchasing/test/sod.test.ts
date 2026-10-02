import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

/** Wave 8, round-2 blocker #1: segregation of duties and approval limits on purchase orders (secure defaults ON). */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น' };
const person = (name: string, perms: string[]) => {
  const userId = randomUUID();
  return { userId, token: t.token(perms, t.tenantId, { userId, userName: name }) };
};
let buyer: ReturnType<typeof person>, manager: ReturnType<typeof person>, md: ReturnType<typeof person>, store: ReturnType<typeof person>;
beforeAll(() => {
  buyer = person('วิไลวรรณ จัดซื้อ', ['purchasing.po.read', 'purchasing.po.write', 'purchasing.po.approve', 'purchasing.po.receive']);
  manager = person('หัวหน้าจัดซื้อ', ['purchasing.po.read', 'purchasing.po.approve', 'purchasing.po.receive']);
  md = person('สมศักดิ์ MD', ['purchasing.po.read', 'purchasing.po.approve-high']);
  store = person('สมชาย คลังดี', ['purchasing.po.read', 'purchasing.po.receive']);
});
const createPo = async (by: { token: string }, unitPrice: number, qty = 100) =>
  (await t.api('POST', '/purchase-orders', { supplierName: 'Siam Steel', lines: [{ ...steel, qty, unitPrice }] }, { token: by.token })).body;

describe('purchase order approval controls', () => {
  it('defaults: creator cannot approve, 50,000 baht (incl. VAT) tier', async () => {
    const s = await t.api('GET', '/settings', undefined, { token: store.token });
    expect(s.status).toBe(200);
    expect(s.body).toMatchObject({
      creatorCannotApprove: true, standardApprovalLimit: 50000,
      approvalTiers: [{ upTo: 50000, perm: 'purchasing.po.approve' }, { upTo: null, perm: 'purchasing.po.approve-high' }],
    });
    expect(s.body.tiersText).toContain('เกิน 50,000.00 บาท');
  });

  it('the creator of a PO cannot approve it (Thai 403), another approver can', async () => {
    const po = await createPo(buyer, 30); // 3,210 incl. VAT
    expect(po.created_by_name).toBe('วิไลวรรณ จัดซื้อ');
    const own = await t.api('POST', `/purchase-orders/${po.id}/approve`, undefined, { token: buyer.token });
    expect(own.status).toBe(403);
    expect(own.body.error.message).toContain('อนุมัติเองไม่ได้');
    // even an all-powerful admin who raised the PO
    const admin = person('Admin', ['*']);
    const adminPo = await createPo(admin, 30);
    expect((await t.api('POST', `/purchase-orders/${adminPo.id}/approve`, undefined, { token: admin.token })).status).toBe(403);
    const ok = await t.api('POST', `/purchase-orders/${po.id}/approve`, undefined, { token: manager.token });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: 'approved', approved_by: manager.userId, approved_by_name: 'หัวหน้าจัดซื้อ' });
  });

  it('above the standard limit needs purchasing.po.approve-high; a high approver may approve small POs too', async () => {
    const big = await createPo(buyer, 500); // 50,000 + VAT = 53,500 > 50,000
    const res = await t.api('POST', `/purchase-orders/${big.id}/approve`, undefined, { token: manager.token });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('เกินวงเงินอนุมัติ');
    expect((await t.api('POST', `/purchase-orders/${big.id}/approve`, undefined, { token: md.token })).body.status).toBe('approved');
    const small = await createPo(buyer, 10);
    expect((await t.api('POST', `/purchase-orders/${small.id}/approve`, undefined, { token: md.token })).body.status).toBe('approved');
    // exactly on the limit is still the normal tier: 46,728.97 + VAT ≈ 50,000
    const edge = await createPo(buyer, 467.2897);
    expect(Number(edge.gross)).toBeLessThanOrEqual(50000);
    expect((await t.api('POST', `/purchase-orders/${edge.id}/approve`, undefined, { token: manager.token })).status).toBe(200);
  });

  it('without any approve permission → 403', async () => {
    const po = await createPo(buyer, 5);
    expect((await t.api('POST', `/purchase-orders/${po.id}/approve`, undefined, { token: store.token })).status).toBe(403);
  });

  it('receiving by the approver is allowed but logged; by someone else it is not flagged', async () => {
    const po = await createPo(buyer, 20);
    await t.api('POST', `/purchase-orders/${po.id}/approve`, undefined, { token: manager.token });
    const part = await t.api('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 40 }] }, { token: store.token });
    expect(part.status).toBe(200);
    expect(part.body.received_by_approver).toBe(false);
    const rest = await t.api('POST', `/purchase-orders/${po.id}/receive`, {}, { token: manager.token });
    expect(rest.status).toBe(200);
    expect(rest.body.received_by_approver).toBe(true);
    expect(rest.body.receipts.map((r: any) => [r.received_by_name, r.by_approver])).toEqual([['สมชาย คลังดี', false], ['หัวหน้าจัดซื้อ', true]]);
    expect(rest.body.receipts[1].sod_note).toContain('ผู้อนุมัติรับของเอง');
    const flagged = (await t.api('GET', '/receipts?byApprover=true', undefined, { token: store.token })).body;
    expect(flagged).toEqual([expect.objectContaining({ po_no: po.no, received_by_name: 'หัวหน้าจัดซื้อ', approved_by_name: 'หัวหน้าจัดซื้อ', by_approver: true, items: 'RM-STEEL ×60' })]);
    expect((await t.api('GET', `/receipts?poId=${po.id}`)).body).toHaveLength(2);
  });

  it('settings: permission, validation, form shortcut and per-tenant scope', async () => {
    expect((await t.api('PUT', '/settings', { creatorCannotApprove: false }, { token: manager.token })).status).toBe(403);
    expect((await t.api('PUT', '/settings', {})).status).toBe(400);
    expect((await t.api('PUT', '/settings', { approvalTiers: [{ upTo: 10000, perm: 'purchasing.po.approve' }] })).status).toBe(400); // last tier must be open
    expect((await t.api('PUT', '/settings', { approvalTiers: [{ upTo: 9000, perm: 'purchasing.po.approve' }, { upTo: 5000, perm: 'purchasing.po.approve' }, { upTo: null, perm: 'purchasing.po.approve-high' }] })).status).toBe(400);
    expect((await t.api('PUT', '/settings', { approvalTiers: [{ upTo: null, perm: 'purchasing.po.write' }] })).status).toBe(400); // only approve perms
    const s = await t.api('PUT', '/settings', { standardApprovalLimit: 100000 });
    expect(s.body).toMatchObject({ creatorCannotApprove: true, standardApprovalLimit: 100000, approvalTiers: [{ upTo: 100000 }, { upTo: null }] });
    const big = await createPo(buyer, 500); // 53,500 is now within the normal limit
    expect((await t.api('POST', `/purchase-orders/${big.id}/approve`, undefined, { token: manager.token })).status).toBe(200);
    // another company still has the secure defaults
    const other = await t.api('GET', '/settings', undefined, { token: t.token(['*'], t.otherTenantId) });
    expect(other.body).toMatchObject({ creatorCannotApprove: true, standardApprovalLimit: 50000 });
    // a one-person purchasing office may switch the creator rule off; 0 = no limit split
    expect((await t.api('PUT', '/settings', { creatorCannotApprove: false, standardApprovalLimit: 0 })).body)
      .toMatchObject({ creatorCannotApprove: false, standardApprovalLimit: 0, approvalTiers: [{ upTo: null, perm: 'purchasing.po.approve' }] });
    const own = await createPo(buyer, 900);
    expect((await t.api('POST', `/purchase-orders/${own.id}/approve`, undefined, { token: buyer.token })).status).toBe(200);
  });

  it('receipt log is tenant-isolated', async () => {
    expect((await t.api('GET', '/receipts', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toEqual([]);
    expect((await t.api('GET', '/receipts')).body.length).toBeGreaterThan(0);
  });
});
