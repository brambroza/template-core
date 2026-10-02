/** Wave 8 (accountant C4): withholding tax is on the service part of an invoice, not on the whole invoice. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const cust = { customerId: randomUUID(), customerName: 'บริษัท คูลแอร์ แมนูแฟคเจอริ่ง จำกัด', customerTaxId: '0105556123453', customerBranch: '00000' };
const bracket = { itemId: randomUUID(), itemCode: 'BRK-100', itemName: 'Compressor bracket' };

async function invoice(lines: unknown[], token?: string) {
  const o = (await t.api('POST', '/orders', { ...cust, creditDays: 30, lines }, { token })).body;
  await t.api('POST', `/orders/${o.id}/confirm`, undefined, { token });
  const inv = await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-01' }, { token });
  expect(inv.status).toBe(201);
  return inv.body;
}

describe('WHT base on receipts (C4)', () => {
  it('goods 5,000 + service 10,000 (+VAT): 3% is withheld on 10,000 = 300, not on 15,000', async () => {
    const inv = await invoice([{ ...bracket, qty: 50, unitPrice: 100 }, { description: 'ค่าบริการติดตั้ง', qty: 1, unitPrice: 10_000 }]);
    expect(inv).toMatchObject({ net: 15_000, vat: 1_050, gross: 16_050 });
    // C7: the invoice event carries the buyer's tax ID / branch for the sales VAT register
    const ev = (await t.published('sales.invoiced')).map((e) => e.data).find((d) => d.invoiceId === inv.id);
    expect(ev).toMatchObject({ customerTaxId: '0105556123453', customerBranch: '00000' });
    const r = await t.api('POST', '/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 16_050 }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ total: 16_050, wht_amount: 300, received: 15_750 });
    expect(r.body.lines[0].wht_base).toBe(10_000);
    const pay = (await t.published('sales.payment_received')).map((e) => e.data).find((d) => d.receiptId === r.body.id);
    expect(pay).toMatchObject({ whtAmount: 300, whtBase: 10_000, received: 15_750 });
    expect(() => parseEvent('sales.payment_received', pay)).not.toThrow();
  });

  it('the accountant\'s INV-2569-0014: goods 4,800 + installation 10,000 → WHT 300 (not 444), bank 15,836 − 300', async () => {
    const inv = await invoice([{ ...bracket, qty: 48, unitPrice: 100 }, { description: 'ค่าบริการติดตั้ง', qty: 1, unitPrice: 10_000 }]);
    expect(inv.gross).toBe(15_836);
    const r = (await t.api('POST', '/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 15_836 }] })).body;
    expect(r).toMatchObject({ wht_amount: 300, received: 15_536 }); // was 444 on 14,800
  });

  it('pro-rates a part payment, accepts the base from the customer\'s 50 ทวิ, and refuses a base above the pre-VAT amount', async () => {
    const inv = await invoice([{ ...bracket, qty: 50, unitPrice: 100 }, { description: 'ค่าบริการ', qty: 1, unitPrice: 10_000 }]);
    // half the invoice paid → half the service base
    const half = (await t.api('POST', '/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 8_025 }] })).body;
    expect(half.lines[0].wht_base).toBe(5_000);
    expect(half.wht_amount).toBe(150);
    // the customer's 50 ทวิ says 6,000 (typed on the form; empty string = default)
    const typed = (await t.api('POST', '/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 4_000, whtBase: 3_000 }] })).body;
    expect(typed).toMatchObject({ wht_amount: 90 });
    const tooBig = await t.api('POST', '/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 1_070, whtBase: 1_500 }] });
    expect(tooBig.status).toBe(400);
    expect(tooBig.body.error.details.fieldErrors.lines[0]).toContain('เกินยอดก่อน VAT');
    const blank = (await t.api('POST', '/receipts', { method: 'transfer', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 1_070, whtBase: '' }] })).body;
    expect(blank.lines[0].wht_base).toBe(666.67); // 1,000 × 10,000 / 15,000
  });

  it('an invoice with no service line keeps the pre-VAT total as the base (customer withholds on everything)', async () => {
    const inv = await invoice([{ description: 'ค่าบริการ MA', qty: 1, unitPrice: 2_000 }]);
    const r = (await t.api('POST', '/receipts', { method: 'cash', whtPct: 3, lines: [{ invoiceId: inv.id, amount: 2_140 }] })).body;
    expect(r).toMatchObject({ wht_amount: 60 });
    const goods = await invoice([{ ...bracket, qty: 10, unitPrice: 100 }]);
    expect((await t.api('POST', '/receipts', { method: 'cash', whtPct: 1, lines: [{ invoiceId: goods.id, amount: 1_070 }] })).body.wht_amount).toBe(10);
    // permission
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: goods.id, amount: 1, whtBase: 1 }] }, { token: t.token(['sales.order.read']) })).status).toBe(403);
  });
});
