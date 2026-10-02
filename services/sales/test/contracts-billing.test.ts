/** Wave 5: contracts.installment_due → draft service order; sales.invoiced carries the issue date and VAT mode. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

function tenant() {
  const id = randomUUID();
  const token = t.token(['*'], id, { userId: randomUUID(), userName: 'ฝ่ายขาย' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  const deliver = (type: any, data: unknown) => { parseEvent(type, data); return t.deliver(type, data, { tenantId: id }); };
  return { id, api, deliver };
}

const installment = (over: Record<string, unknown> = {}) => ({
  installmentId: randomUUID(), contractId: randomUUID(), contractNo: 'MA-2569-0007', title: 'MA ระบบ CCTV 32 จุด', customerId: randomUUID(), customerCode: 'CUS-CBP',
  customerName: 'บริษัท ชลบุรี พลาสติก จำกัด', seq: 3, count: 12, dueDate: '2026-12-01', amount: 10000, billingPlan: 'monthly',
  periodFrom: '2026-12-01', periodTo: '2026-12-31', ...over,
});

describe('sales ← contracts.installment_due', () => {
  it('drafts one service order per installment for billing staff to confirm and invoice', async () => {
    const x = tenant();
    const e = installment();
    expect((await x.deliver('contracts.installment_due', e)).body.status).toBe('handled');
    await x.deliver('contracts.installment_due', e); // re-sent with a new event id
    const list = (await x.api('GET', '/orders?q=MA-2569-0007')).body;
    expect(list).toHaveLength(1);
    const o = (await x.api('GET', `/orders/${list[0].id}`)).body;
    expect(o).toMatchObject({ status: 'draft', ref: 'MA-2569-0007 งวด 3/12', customer_id: e.customerId, customer_name: e.customerName, vat_mode: 'exclusive',
      net: 10000, vat: 700, gross: 10700, contract_installment_id: e.installmentId, created_by: null });
    expect(o.lines).toHaveLength(1);
    expect(o.lines[0]).toMatchObject({ item_id: null, qty: 1, unit_price: 10000, amount: 10000 });
    expect(o.lines[0].description).toContain('งวดที่ 3/12');
    expect(o.note).toContain('MA-2569-0007');
    // billing staff confirm and invoice it like any order; service-only → no delivery event
    expect((await x.api('POST', `/orders/${o.id}/confirm`)).status).toBe(200);
    expect((await x.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-12-01' })).status).toBe(201);
  });

  it('ignores a zero installment and stays inside the tenant', async () => {
    const x = tenant();
    await x.deliver('contracts.installment_due', installment({ amount: 0, contractNo: 'MA-2569-0099' }));
    expect((await x.api('GET', '/orders?q=MA-2569-0099')).body).toHaveLength(0);
    await x.deliver('contracts.installment_due', installment({ contractNo: 'MA-2569-0100' }));
    expect((await tenant().api('GET', '/orders?q=MA-2569-0100')).body).toHaveLength(0);
  });
});

describe('sales.invoiced (wave 5 fields)', () => {
  it('carries the tax-invoice date and VAT mode for accounting', async () => {
    const x = tenant();
    const so = (await x.api('POST', '/orders', { customerName: 'ลูกค้า', vatMode: 'inclusive', lines: [{ description: 'ค่าบริการ', qty: 1, unitPrice: 1070 }] })).body;
    await x.api('POST', `/orders/${so.id}/confirm`);
    const inv = (await x.api('POST', `/orders/${so.id}/invoice`, { issueDate: '2026-11-05' })).body;
    const ev = (await t.published('sales.invoiced')).map((e) => e.data).find((d) => d.invoiceId === inv.id);
    expect(ev).toMatchObject({ issueDate: '2026-11-05', vatMode: 'inclusive', net: 1000, vat: 70, gross: 1070 });
    expect(() => parseEvent('sales.invoiced', ev)).not.toThrow();
  });
});
