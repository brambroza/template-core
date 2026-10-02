/** Wave 8: Thai business dates (round-2 #4) and the lock date that follows Accounting's period close (C5). */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

const item = { itemId: randomUUID(), itemCode: 'RM-01', itemName: 'วัตถุดิบ' };

/** a fresh tenant whose single user may create and approve (segregation of duties is tested in sod.test.ts) */
async function tenant(perms = ['*']) {
  const id = randomUUID();
  const token = t.token(perms, id, { userId: randomUUID(), userName: 'คุณจัดซื้อ' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  await api('PUT', '/settings', { creatorCannotApprove: false });
  const approvedPo = async (extra: Record<string, unknown> = {}) => {
    const po = (await api('POST', '/purchase-orders', { supplierName: 'ผู้ขาย ก', lines: [{ ...item, qty: 10, unitPrice: 100 }], ...extra })).body;
    expect((await api('POST', `/purchase-orders/${po.id}/approve`)).status).toBe(200);
    return po;
  };
  return { id, token, api, approvedPo };
}

describe('round-2 #4 — PO / receipt / return dates at 02:00 Bangkok', () => {
  it('default to the Thai day (UTC is still yesterday) and travel with the events', async () => {
    setClock('2026-10-02T19:00:00Z');
    const x = await tenant();
    const po = await x.approvedPo();
    expect(po.order_date).toBe('2026-10-03');
    await x.api('POST', `/purchase-orders/${po.id}/receive`);
    const gr = (await t.published('purchasing.goods_received')).find((e) => e.data.poId === po.id)!.data;
    expect(gr.receivedDate).toBe('2026-10-03');
    const rt = (await x.api('POST', `/purchase-orders/${po.id}/returns`, { lines: [{ itemId: item.itemId, qty: 1 }] })).body;
    expect(rt.return_date).toBe('2026-10-03');
    expect((await t.published('purchasing.goods_returned')).find((e) => e.data.returnId === rt.id)!.data.returnDate).toBe('2026-10-03');
  });

  it('a receipt may be dated in the past but not in the future', async () => {
    const x = await tenant();
    const po = await x.approvedPo({ orderDate: '2026-09-01' });
    expect((await x.api('POST', `/purchase-orders/${po.id}/receive`, { receivedDate: '2099-01-01' })).status).toBe(400);
    expect((await x.api('POST', `/purchase-orders/${po.id}/receive`, { receivedDate: '2026-09-05' })).status).toBe(200);
    expect((await t.published('purchasing.goods_received')).find((e) => e.data.poId === po.id)!.data.receivedDate).toBe('2026-09-05');
  });
});

describe('C5 — lock date', () => {
  it('a closed accounting period refuses receipts and returns dated into it; override needs perm + reason; reopen unlocks', async () => {
    const x = await tenant(['purchasing.po.read', 'purchasing.po.write', 'purchasing.po.approve', 'purchasing.po.approve-high', 'purchasing.settings.write', 'purchasing.po.receive', 'purchasing.po.return']);
    const po = await x.approvedPo({ orderDate: '2026-09-01' });
    await t.deliver('accounting.period_closed', { period: '2026-09', lastDate: '2026-09-30', closedByName: 'คุณบัญชี' }, { tenantId: x.id });
    expect((await x.api('GET', '/lock')).body).toMatchObject({ lockDate: '2026-09-30', source: 'accounting' });
    const r = await x.api('POST', `/purchase-orders/${po.id}/receive`, { receivedDate: '2026-09-28' });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('30 กันยายน 2569 ปิดแล้ว');
    const boss = t.token(['purchasing.*'], x.id, { userName: 'ผู้จัดการ' });
    expect((await x.api('POST', `/purchase-orders/${po.id}/receive`, { receivedDate: '2026-09-28' }, boss)).status).toBe(409); // no reason
    expect((await x.api('POST', `/purchase-orders/${po.id}/receive`, { receivedDate: '2026-09-28', lines: [{ lineId: po.lines[0].id, qty: 5 }], lockOverrideReason: 'ของเข้าวันที่ 28 ก.ย. ลืมบันทึก' }, boss)).status).toBe(200);
    expect((await x.api('POST', `/purchase-orders/${po.id}/receive`, { receivedDate: '2026-10-01', lines: [{ lineId: po.lines[0].id, qty: 2 }] })).status).toBe(200);
    expect((await x.api('POST', `/purchase-orders/${po.id}/returns`, { returnDate: '2026-09-30', lines: [{ itemId: item.itemId, qty: 1 }] })).status).toBe(409);
    await t.deliver('accounting.period_reopened', { period: '2026-09', firstDate: '2026-09-01' }, { tenantId: x.id });
    expect((await x.api('POST', `/purchase-orders/${po.id}/returns`, { returnDate: '2026-09-30', lines: [{ itemId: item.itemId, qty: 1 }] })).status).toBe(201);
    // other tenants are not locked
    expect((await t.api('GET', '/lock', undefined, { token: t.token(['*'], randomUUID()) })).body.lockDate).toBeNull();
  });

  it('manual lock needs purchasing.lock.write', async () => {
    const x = await tenant();
    expect((await x.api('POST', '/lock', { lockDate: '2026-08-31' }, t.token(['purchasing.po.write'], x.id))).status).toBe(403);
    expect((await x.api('POST', '/lock', { lockDate: '2099-08-31' })).status).toBe(400);
    expect((await x.api('POST', '/lock', { lockDate: '2026-08-31' })).body).toMatchObject({ lockDate: '2026-08-31', source: 'manual', updatedByName: 'คุณจัดซื้อ' });
  });
});
