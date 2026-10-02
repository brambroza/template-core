/** Wave 8 (accountant C8): the supplier's tax invoice is keyed in at goods receipt and travels to accounting's purchase VAT register. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); await t.api('PUT', '/settings', { creatorCannotApprove: false }); });
afterAll(async () => { await t?.close(); });

const steel = { itemId: randomUUID(), itemCode: 'RM-STEEL-S', itemName: 'เหล็กแผ่น' };

describe('supplier tax invoice at goods receipt (C8)', () => {
  it('stores it on the receipt and carries it in purchasing.goods_received; it stays optional', async () => {
    const po = (await t.api('POST', '/purchase-orders', { supplierName: 'บริษัท เหล็กสยาม จำกัด', lines: [{ ...steel, qty: 10, unitPrice: 100 }] })).body;
    await t.api('POST', `/purchase-orders/${po.id}/approve`);
    // invalid tax ID (checksum) → 400 with a field error
    const bad = await t.api('POST', `/purchase-orders/${po.id}/receive`, { lines: [{ lineId: po.lines[0].id, qty: 1 }], supplierTaxId: '0105537000016' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fieldErrors.supplierTaxId).toBeDefined();
    const ok = await t.api('POST', `/purchase-orders/${po.id}/receive`, {
      lines: [{ lineId: po.lines[0].id, qty: 4 }], supplierInvoiceNo: 'IV6810-0042', supplierInvoiceDate: '2026-09-28', supplierTaxId: '0105537000015', supplierBranch: '00000',
    });
    expect(ok.status).toBe(200);
    expect(ok.body.receipts[0]).toMatchObject({ supplier_invoice_no: 'IV6810-0042', supplier_invoice_date: '2026-09-28', supplier_tax_id: '0105537000015', supplier_branch: '00000' });
    const events = (await t.published('purchasing.goods_received')).map((e) => e.data).filter((d) => d.poId === po.id);
    expect(events[0]).toMatchObject({ supplierInvoiceNo: 'IV6810-0042', supplierInvoiceDate: '2026-09-28', supplierTaxId: '0105537000015', supplierBranch: '00000', net: 400, vat: 28 });
    expect(() => parseEvent('purchasing.goods_received', events[0])).not.toThrow();
    // the rest arrives without the invoice (form fields left empty) — nothing extra on the event
    const rest = await t.api('POST', `/purchase-orders/${po.id}/receive`, { supplierInvoiceNo: '', supplierTaxId: '' });
    expect(rest.status).toBe(200);
    const last = (await t.published('purchasing.goods_received')).map((e) => e.data).filter((d) => d.poId === po.id).at(-1);
    expect(last.supplierInvoiceNo).toBeUndefined();
    expect(last.lines[0].qty).toBe(6);
    // tenant isolation: another company cannot see the PO or its receipts
    expect((await t.api('GET', `/purchase-orders/${po.id}`, undefined, { token: t.token(['*'], t.otherTenantId) })).status).toBe(404);
  });
});
