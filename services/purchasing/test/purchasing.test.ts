import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
// one test user creates and approves here; segregation of duties is covered in sod.test.ts
beforeAll(async () => { t = await bootTestService(definition); await t.api('PUT', '/settings', { creatorCannotApprove: false }); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น' };
const bolt = { itemId: randomUUID(), itemCode: 'SP-BOLT' };

describe('purchasing', () => {
  it('creates a numbered PO with Thai VAT totals', async () => {
    const res = await t.api('POST', '/purchase-orders', {
      supplierName: 'Siam Steel', orderDate: '2026-10-02', warehouseCode: 'RM',
      lines: [{ ...steel, qty: 100, unitPrice: 32.5 }, { ...bolt, qty: 500, unitPrice: 1.2 }],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ no: 'PO-2569-0001', status: 'draft', net: 3850, vat: 269.5, gross: 4119.5 });
    expect(res.body.lines.map((l: any) => l.amount)).toEqual([3250, 600]);
  });

  it('requires approval before receiving, and the approve permission', async () => {
    const po = (await t.api('POST', '/purchase-orders', { supplierName: 'S', lines: [{ ...steel, qty: 10, unitPrice: 30 }] })).body;
    expect((await t.api('POST', `/purchase-orders/${po.id}/receive`)).status).toBe(409);
    const clerk = t.token(['purchasing.po.read', 'purchasing.po.write']);
    expect((await t.api('POST', `/purchase-orders/${po.id}/approve`, undefined, { token: clerk })).status).toBe(403);
    expect((await t.api('POST', `/purchase-orders/${po.id}/approve`)).body.status).toBe('approved');
    expect((await t.api('POST', `/purchase-orders/${po.id}/approve`)).status).toBe(409);
  });

  it('receives partially then fully and publishes goods_received each time', async () => {
    const po = (await t.api('POST', '/purchase-orders', { supplierName: 'Siam Steel', warehouseCode: 'RM', lines: [{ ...steel, qty: 100, unitPrice: 33 }] })).body;
    await t.api('POST', `/purchase-orders/${po.id}/approve`);
    const part = await t.api('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 40 }] });
    expect(part.body.status).toBe('partially_received');
    expect((await t.api('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 61 }] })).status).toBe(409);
    const rest = await t.api('POST', `/purchase-orders/${po.id}/receive`);
    expect(rest.body.status).toBe('received');
    expect(rest.body.lines[0].received_qty).toBe(100);
    const events = (await t.published('purchasing.goods_received')).filter((e) => e.data.poId === po.id);
    expect(events.map((e) => e.data.lines[0].qty)).toEqual([40, 60]);
    expect(events[0].data).toMatchObject({ warehouseCode: 'RM', supplierName: 'Siam Steel', lines: [{ itemCode: 'RM-STEEL', unitPrice: 33 }] });
  });

  it('announces creation and approval, and summarises work to do', async () => {
    expect((await t.published('purchasing.po_created')).length).toBeGreaterThanOrEqual(3);
    expect((await t.published('purchasing.po_approved')).length).toBe(2);
    const sum = await t.api('GET', '/summary');
    expect(sum.body).toMatchObject({ toApprove: 1, toReceive: 1 }); // PO-0001 draft, PO-0002 approved but not received
    expect(sum.body.months).toHaveLength(6);
  });

  it('lists by status and hides other tenants', async () => {
    const received = await t.api('GET', '/purchase-orders?status=received');
    expect(received.body).toHaveLength(1);
    expect((await t.api('GET', '/purchase-orders', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toEqual([]);
  });
});
