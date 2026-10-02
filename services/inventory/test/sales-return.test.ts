import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

/** wave 9: a sales credit note (ใบลดหนี้) with returned goods puts them back into stock — once, never throwing. */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const mould = { itemId: randomUUID(), itemCode: 'FG-MOULD', itemName: 'แม่พิมพ์' };

function note(tenant: string, over: Record<string, unknown> = {}) {
  return {
    noteId: randomUUID(), noteNo: `CN-2569-${Math.floor(Math.random() * 9000 + 1000)}`, kind: 'credit', issueDate: '2026-10-20',
    invoiceId: randomUUID(), invoiceNo: 'INV-2569-0007', invoiceDate: '2026-10-01',
    customerId: null, customerName: 'บริษัท ลูกค้า จำกัด', reason: 'ได้รับคืนสินค้าที่ขาย — ชำรุด',
    originalNet: 1000, correctNet: 700, net: 300, vat: 21, gross: 321, warehouseCode: 'RETURNS',
    lines: [
      { ...mould, description: 'แม่พิมพ์', qty: 3, unitPrice: 100, amount: 300, returnToStock: 3 },
      { itemId: null, itemCode: null, description: 'ค่าขนส่ง', qty: 1, unitPrice: 50, amount: 50 },
    ],
    ...over,
  };
}

const balance = async (token: string, itemId: string, wh: string) =>
  (await t.api('GET', `/balances?itemId=${itemId}&warehouseCode=${wh}&nonZero=false`, undefined, { token })).body[0]?.onHand ?? 0;

describe('sales.note_issued → goods returned into stock', () => {
  it('receives the returned qty into the note warehouse (auto-created) with the note on the stock card', async () => {
    const tid = randomUUID();
    const tok = t.token(['*'], tid);
    const e = note(tid);
    expect((await t.deliver('sales.note_issued', e, { tenantId: tid })).status).toBe(200);
    expect(await balance(tok, mould.itemId, 'RETURNS')).toBe(3);
    const card = (await t.api('GET', `/items/${mould.itemId}/stock-card?warehouseCode=RETURNS`, undefined, { token: tok })).body;
    expect(card).toMatchObject([{ kind: 'receive', qty: 3, refType: 'sales_note', refId: e.noteNo }]);
    expect(card[0].note).toContain(`ตามใบลดหนี้ ${e.noteNo}`);
  });

  it('is idempotent: the same event redelivered, or the same note under a new event id, moves stock once', async () => {
    const tid = randomUUID();
    const tok = t.token(['*'], tid);
    const e = note(tid);
    const id = randomUUID();
    await t.deliver('sales.note_issued', e, { tenantId: tid, id });
    await t.deliver('sales.note_issued', e, { tenantId: tid, id }); // kernel de-duplication by event id
    await t.deliver('sales.note_issued', e, { tenantId: tid }); // replay with another id: the stock card already has the note
    expect(await balance(tok, mould.itemId, 'RETURNS')).toBe(3);
  });

  it('ignores debit notes, notes without returns and lines without an item — and never fails the delivery', async () => {
    const tid = randomUUID();
    const tok = t.token(['*'], tid);
    expect((await t.deliver('sales.note_issued', note(tid, { kind: 'debit' }), { tenantId: tid })).status).toBe(200);
    expect((await t.deliver('sales.note_issued', note(tid, { warehouseCode: null }), { tenantId: tid })).status).toBe(200);
    const priceOnly = note(tid, { lines: [{ ...mould, description: 'ลดราคา', qty: 3, unitPrice: 10, amount: 30 }] });
    expect((await t.deliver('sales.note_issued', priceOnly, { tenantId: tid })).status).toBe(200);
    expect(await balance(tok, mould.itemId, 'RETURNS')).toBe(0);
    // partial return of a line: only the returned qty comes back
    await t.deliver('sales.note_issued', note(tid, { lines: [{ ...mould, description: 'แม่พิมพ์', qty: 3, unitPrice: 100, amount: 300, returnToStock: 1 }] }), { tenantId: tid });
    expect(await balance(tok, mould.itemId, 'RETURNS')).toBe(1);
  });

  it('keeps tenants apart', async () => {
    const a = randomUUID();
    const b = randomUUID();
    await t.deliver('sales.note_issued', note(a), { tenantId: a });
    expect(await balance(t.token(['*'], a), mould.itemId, 'RETURNS')).toBe(3);
    expect(await balance(t.token(['*'], b), mould.itemId, 'RETURNS')).toBe(0);
  });
});
