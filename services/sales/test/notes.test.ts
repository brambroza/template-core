import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

/**
 * wave 9: ใบลดหนี้ (มาตรา 82/10 + 86/10) and ใบเพิ่มหนี้ (มาตรา 82/9 + 86/9) against the module's own tax invoices.
 * Every amount is checked to the satang.
 */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
beforeEach(() => setClock('2026-10-20T05:00:00Z')); // 20 Oct 2026, 12:00 in Bangkok
afterEach(() => setClock(null));

const ALL = ['*'];
const tenant = () => { const id = randomUUID(); return { id, tok: t.token(ALL, id, { userName: 'คุณบัญชี' }) }; };
const cust = () => ({
  customerId: randomUUID(), customerName: `บริษัท ลูกค้าลดหนี้ ${randomUUID().slice(0, 4)} จำกัด`, customerTaxId: '0105558123451', customerBranch: '00002',
  customerAddress: '99 ถ.บางนา-ตราด แขวงบางนา เขตบางนา กรุงเทพฯ 10260', customerEmail: 'ap@customer.example',
});
const mould = { itemId: randomUUID(), itemCode: 'FG-MOULD', itemName: 'แม่พิมพ์' };

/** confirmed + invoiced order; returns the printable invoice */
async function invoiced(tok: string, order: object, issueDate = '2026-10-05') {
  const o = (await t.api('POST', '/orders', { creditDays: 30, ...order }, { token: tok })).body;
  expect((await t.api('POST', `/orders/${o.id}/confirm`, undefined, { token: tok })).status).toBe(200);
  const inv = await t.api('POST', `/orders/${o.id}/invoice`, { issueDate }, { token: tok });
  expect(inv.status).toBe(201);
  return inv.body;
}
const credit = (tok: string, invId: string, body: object) => t.api('POST', `/invoices/${invId}/credit-notes`, body, { token: tok });
const debit = (tok: string, invId: string, body: object) => t.api('POST', `/invoices/${invId}/debit-notes`, body, { token: tok });
const getInv = async (tok: string, id: string) => (await t.api('GET', `/invoices/${id}`, undefined, { token: tok })).body;

describe('credit note arithmetic — VAT-exclusive invoice', () => {
  it('returns part of a line, then credits the rest: VAT reversed equals VAT charged to the satang', async () => {
    const { tok } = tenant();
    // 10 × 123.45 = 1,234.50 (goods) + 1 × 1,000 (service) = 2,234.50; VAT 156.415 → 156.42; gross 2,390.92
    const inv = await invoiced(tok, { ...cust(), lines: [{ ...mould, qty: 10, unitPrice: 123.45 }, { description: 'ค่าติดตั้ง', qty: 1, unitPrice: 1000 }] });
    expect(inv).toMatchObject({ net: 2234.5, vat: 156.42, gross: 2390.92 });

    const cn1 = await credit(tok, inv.id, { reasonCode: 'returned', reasonText: 'ผิวงานมีรอย 3 ชิ้น', issueDate: '2026-10-10', lines: [{ lineNo: 1, qty: 3, returnToStock: true }] });
    expect(cn1.status).toBe(201);
    // 3 × 123.45 = 370.35; VAT 25.9245 → 25.92; 396.27
    expect(cn1.body).toMatchObject({
      no: 'CN-2569-0001', kind: 'credit', title: 'ใบลดหนี้', invoice_no: inv.no, original_net: 2234.5, correct_net: 1864.15,
      net: 370.35, vat: 25.92, gross: 396.27, vat_mode: 'exclusive', vat_rate: 0.07, warehouse_code: 'MAIN',
      reason: 'ได้รับคืนสินค้าที่ขาย (ชำรุด ขาดจำนวน ไม่ตรงตามตัวอย่าง คำพรรณนา หรือที่ตกลงกัน) — ผิวงานมีรอย 3 ชิ้น',
      issueDateTh: '10 ตุลาคม 2569', invoiceDateTh: '5 ตุลาคม 2569', amountText: 'สามร้อยเก้าสิบหกบาทยี่สิบเจ็ดสตางค์',
      lines: [{ line_no: 1, invoice_line_no: 1, item_code: 'FG-MOULD', description: 'แม่พิมพ์', qty: 3, unit_price: 123.45, amount: 370.35, return_to_stock: 3 }],
      invoiceOutstanding: 1994.65,
    });
    expect(cn1.body.customer).toMatchObject({ taxId: '0105558123451', branch: '00002' });
    expect(cn1.body.legalText).toContain('มาตรา 86/10');
    expect(cn1.body.legalText).toContain(inv.no);

    // the rest: 7 × 123.45 + 1,000 = 1,864.15 → 7% would be 130.49, but the exact VAT left is 156.42 − 25.92 = 130.50
    const cn2 = await credit(tok, inv.id, { reasonCode: 'cancelled', lines: [{ lineNo: 1 , qty: 7 }, { lineNo: 2 }] });
    expect(cn2.status).toBe(201);
    expect(cn2.body).toMatchObject({ no: 'CN-2569-0002', original_net: 1864.15, correct_net: 0, net: 1864.15, vat: 130.5, gross: 1994.65, warehouse_code: null });
    const after = await getInv(tok, inv.id);
    expect(after).toMatchObject({ credit_total: 2390.92, outstanding: 0, payment_status: 'credited', promptPay: null });
    expect(after.notes.map((n: any) => n.no)).toEqual(['CN-2569-0001', 'CN-2569-0002']);

    // nothing left to credit
    const over = await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 0.01 });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toContain('เกินมูลค่าคงเหลือ');
  });

  it('line discounts: crediting a whole discounted line gives back exactly its invoiced amount', async () => {
    const { tok } = tenant();
    // 3 × 99.99 less 5% = 3 × 94.9905 = 284.9715 → 284.97; VAT 19.95; 304.92
    const inv = await invoiced(tok, { ...cust(), lines: [{ ...mould, qty: 3, unitPrice: 99.99, discountPct: 5 }] });
    expect(inv).toMatchObject({ net: 284.97, vat: 19.95, gross: 304.92 });
    const one = (await credit(tok, inv.id, { reasonCode: 'short', lines: [{ lineNo: 1, qty: 1 }] })).body;
    expect(one).toMatchObject({ net: 94.99, vat: 6.65, gross: 101.64, lines: [{ unit_price: 94.9905, amount: 94.99 }] });
    const rest = (await credit(tok, inv.id, { reasonCode: 'short', lines: [{ lineNo: 1, qty: 2 }] })).body; // 189.98 → exactly what is left
    expect(rest).toMatchObject({ net: 189.98, vat: 13.3, gross: 203.28 });
    expect((await getInv(tok, inv.id)).outstanding).toBe(0);
  });
});

describe('credit note arithmetic — VAT-inclusive invoice', () => {
  it('splits VAT out of an inclusive difference; three partial credits add back to the invoice base and VAT exactly', async () => {
    const { tok } = tenant();
    const inv = await invoiced(tok, { ...cust(), vatMode: 'inclusive', lines: [{ description: 'ค่าบริการออกแบบ', qty: 1, unitPrice: 1000 }] });
    expect(inv).toMatchObject({ net: 934.58, vat: 65.42, gross: 1000 });
    // 333.33 incl. VAT → base 311.52 + VAT 21.81 (twice); 333.34 → base 311.53 would leave 0.01 of base behind — the last credit takes the exact rest
    const a = (await credit(tok, inv.id, { reasonCode: 'service', amount: 333.33 })).body;
    const b = (await credit(tok, inv.id, { reasonCode: 'service', amount: 333.33 })).body;
    const c = (await credit(tok, inv.id, { reasonCode: 'service', amount: 333.34 })).body;
    expect(a).toMatchObject({ vat_mode: 'inclusive', original_net: 934.58, net: 311.52, vat: 21.81, gross: 333.33, correct_net: 623.06, priceBasis: 'ราคาตามรายการรวมภาษีมูลค่าเพิ่มแล้ว' });
    expect(b).toMatchObject({ original_net: 623.06, net: 311.52, vat: 21.81, gross: 333.33, correct_net: 311.54 });
    expect(c).toMatchObject({ original_net: 311.54, net: 311.54, vat: 21.8, gross: 333.34, correct_net: 0 });
    expect(Math.round((a.net + b.net + c.net) * 100) / 100).toBe(934.58);
    expect(Math.round((a.vat + b.vat + c.vat) * 100) / 100).toBe(65.42);
    expect((await credit(tok, inv.id, { reasonCode: 'service', amount: 0.01 })).status).toBe(400);
  });

  it('inclusive price reduction of 107.00 → base 100.00, VAT 7.00', async () => {
    const { tok } = tenant();
    const inv = await invoiced(tok, { ...cust(), vatMode: 'inclusive', lines: [{ ...mould, qty: 2, unitPrice: 535 }] });
    const cn = (await credit(tok, inv.id, { reasonCode: 'sample', lines: [{ lineNo: 1, qty: 2, unitPrice: 53.5 }] })).body;
    expect(cn).toMatchObject({ net: 100, vat: 7, gross: 107, original_net: 1000, correct_net: 900 });
  });
});

describe('over-credit, reasons, dates', () => {
  it('cumulative credit notes may not exceed the invoice value; debit notes raise the ceiling', async () => {
    const { tok } = tenant();
    const inv = await invoiced(tok, { ...cust(), lines: [{ description: 'งานกลึง', qty: 1, unitPrice: 1000 }] });
    expect((await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 1000.01 })).status).toBe(400);
    expect((await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 600 })).status).toBe(201);
    const over = await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 400.01 });
    expect(over.status).toBe(400);
    expect(over.body.error.message).toBe(`ลดหนี้ 400.01 เกินมูลค่าคงเหลือของใบกำกับ ${inv.no} 400.00 (ก่อน VAT) — รวมใบลดหนี้ทุกใบต้องไม่เกินมูลค่าตามใบกำกับภาษี`);
    const dn = await debit(tok, inv.id, { reasonCode: 'undercharged', reasonText: 'คิดค่ากลึงผิด', amount: 50 });
    expect(dn.status).toBe(201);
    expect(dn.body).toMatchObject({ no: 'DN-2569-0001', title: 'ใบเพิ่มหนี้', original_net: 400, correct_net: 450, net: 50, vat: 3.5, gross: 53.5 });
    expect(dn.body.legalText).toContain('มาตรา 86/9');
    expect((await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 450 })).status).toBe(201);
  });

  it('refuses unknown or wrong-kind reasons, "other" without text, returns on debit notes, service returns, bad line numbers, empty notes', async () => {
    const { tok } = tenant();
    const inv = await invoiced(tok, { ...cust(), lines: [{ ...mould, qty: 2, unitPrice: 500 }, { description: 'ค่าขนส่ง', qty: 1, unitPrice: 100 }] });
    const bad = [
      credit(tok, inv.id, { reasonCode: 'nope', amount: 1 }),
      credit(tok, inv.id, { reasonCode: 'excess', amount: 1 }), // a debit-note reason
      credit(tok, inv.id, { reasonCode: 'other', amount: 1 }),
      debit(tok, inv.id, { reasonCode: 'excess', lines: [{ lineNo: 1, qty: 1, returnToStock: true }] }),
      credit(tok, inv.id, { reasonCode: 'returned', lines: [{ lineNo: 2, returnToStock: true }] }),
      credit(tok, inv.id, { reasonCode: 'returned', lines: [{ lineNo: 9 }] }),
      credit(tok, inv.id, { reasonCode: 'returned', lines: [{ lineNo: 1, qty: 1, returnToStock: 2 }] }),
      credit(tok, inv.id, { reasonCode: 'returned' }),
      credit(tok, inv.id, { reasonCode: 'returned', amount: 5, lines: [{ lineNo: 1 }] }),
      credit(tok, inv.id, { reasonCode: 'returned', lines: [{ description: 'ไม่มีราคา', qty: 1 }] }),
    ];
    for (const r of await Promise.all(bad)) expect(r.status).toBe(400);
    // a blank form row (unticked checkbox only) is ignored; "other" with text is fine
    const ok = await credit(tok, inv.id, { reasonCode: 'other', reasonText: 'ส่วนลดตามปริมาณประจำไตรมาส', amount: 10, lines: [{ returnToStock: false }] });
    expect(ok.status).toBe(201);
    expect(ok.body.reason).toBe('เหตุอื่นตามที่อธิบดีกำหนด — ส่วนลดตามปริมาณประจำไตรมาส');
    // returns are capped at what was sold, across notes
    expect((await credit(tok, inv.id, { reasonCode: 'returned', lines: [{ lineNo: 1, qty: 1, returnToStock: true }] })).status).toBe(201);
    const twice = await credit(tok, inv.id, { reasonCode: 'returned', lines: [{ lineNo: 1, qty: 2, returnToStock: true }] });
    expect(twice.status).toBe(400);
    expect(twice.body.error.message).toContain('เกินจำนวนที่ขายตามใบกำกับ 2 (รับคืนไปแล้ว 1)');
  });

  it('note date: not before the invoice, not in the future', async () => {
    const { tok } = tenant();
    const inv = await invoiced(tok, { ...cust(), lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }, '2026-10-05');
    expect((await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 1, issueDate: '2026-10-04' })).status).toBe(400);
    expect((await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 1, issueDate: '2026-10-21' })).status).toBe(400);
    const today = (await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 1 })).body;
    expect(today.issue_date).toBe('2026-10-20');
  });

  it('lock date: a note dated in a closed period is refused (override needs perm + reason); dated after it, a note may adjust an invoice of the closed month', async () => {
    const tid = randomUUID();
    const user = t.token(['sales.order.read', 'sales.order.write', 'sales.invoice.write', 'sales.note.read', 'sales.note.write'], tid);
    const boss = t.token(['sales.note.write', 'sales.note.read', 'sales.lock.override'], tid);
    const inv = await invoiced(user, { ...cust(), lines: [{ description: 'งานเดือนกันยา', qty: 1, unitPrice: 2000 }] }, '2026-09-15');
    expect((await t.deliver('accounting.period_closed', { period: '2026-09', lastDate: '2026-09-30', closedByName: 'คุณบัญชี' }, { tenantId: tid })).status).toBe(200);
    const locked = await credit(user, inv.id, { reasonCode: 'overcharged', amount: 100, issueDate: '2026-09-28' });
    expect(locked.status).toBe(409);
    expect(locked.body.error.message).toContain('ลงวันที่ใบลดหนี้');
    expect((await credit(boss, inv.id, { reasonCode: 'overcharged', amount: 100, issueDate: '2026-09-28' })).status).toBe(409); // no reason
    expect((await credit(boss, inv.id, { reasonCode: 'overcharged', amount: 100, issueDate: '2026-09-28', lockOverrideReason: 'ลูกค้าแจ้งก่อนปิดงวด' })).status).toBe(201);
    const october = await credit(user, inv.id, { reasonCode: 'overcharged', amount: 100, issueDate: '2026-10-01' });
    expect(october.status).toBe(201);
    expect(october.body).toMatchObject({ issue_date: '2026-10-01', invoice_date: '2026-09-15', original_net: 1900, correct_net: 1800 });
    expect((await debit(user, inv.id, { reasonCode: 'price', amount: 10, issueDate: '2026-09-30' })).status).toBe(409);
  });
});

describe('receivables after notes', () => {
  it('credit reduces and debit increases what the customer owes — invoice detail, receipts, receivables (as of), aging, summary', async () => {
    const { tok } = tenant();
    const c = cust();
    const inv = await invoiced(tok, { ...c, lines: [{ description: 'ค่าแม่พิมพ์', qty: 1, unitPrice: 1000 }] }); // 1,070.00, due 4 Nov
    const cn = (await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 100, issueDate: '2026-10-10' })).body; // 107.00
    expect(cn.gross).toBe(107);
    expect(await getInv(tok, inv.id)).toMatchObject({ gross: 1070, credit_total: 107, billed: 963, outstanding: 963, payment_status: 'outstanding' });
    expect((await t.api('GET', '/receivables', undefined, { token: tok })).body.totals).toMatchObject({ outstanding: 963 });
    expect((await t.api('GET', '/receivables?asOf=2026-10-09', undefined, { token: tok })).body.totals).toMatchObject({ outstanding: 1070 });
    expect((await t.api('GET', '/receivables/aging', undefined, { token: tok })).body.totals).toMatchObject({ current: 963, total: 963 });
    expect((await t.api('GET', '/summary', undefined, { token: tok })).body).toMatchObject({ outstanding: 963, revenueMonth: 963 });
    const open = (await t.api('GET', '/invoices?status=open', undefined, { token: tok })).body;
    expect(open.find((i: any) => i.id === inv.id)).toMatchObject({ outstanding: 963 });

    // a receipt can settle only what is owed after the credit note
    expect((await t.api('POST', '/receipts', { method: 'transfer', lines: [{ invoiceId: inv.id, amount: 1070 }] }, { token: tok })).status).toBe(400);
    expect((await t.api('POST', '/receipts', { method: 'transfer', receiptDate: '2026-10-12', lines: [{ invoiceId: inv.id, amount: 963 }] }, { token: tok })).status).toBe(201);
    expect((await getInv(tok, inv.id)).payment_status).toBe('paid');

    // debit note: owed again (and payable beyond the original gross)
    const dn = (await debit(tok, inv.id, { reasonCode: 'excess', amount: 200, issueDate: '2026-10-15' })).body; // 214.00
    expect(dn).toMatchObject({ original_net: 900, correct_net: 1100, net: 200, vat: 14, gross: 214 });
    expect(await getInv(tok, inv.id)).toMatchObject({ debit_total: 214, outstanding: 214, payment_status: 'partially_paid' });
    expect((await t.api('GET', '/receivables', undefined, { token: tok })).body.totals).toMatchObject({ outstanding: 214 });
    expect((await t.api('GET', '/receivables?asOf=2026-10-14', undefined, { token: tok })).body.totals).toMatchObject({ outstanding: 0 });
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 214 }] }, { token: tok })).status).toBe(201);
    expect(await getInv(tok, inv.id)).toMatchObject({ paid_amount: 1177, outstanding: 0, payment_status: 'paid' });

    // credit after full payment → the customer has a credit balance
    await credit(tok, inv.id, { reasonCode: 'damaged', amount: 50 }); // 53.50
    expect((await getInv(tok, inv.id)).outstanding).toBe(-53.5);
    const ar = (await t.api('GET', '/receivables', undefined, { token: tok })).body;
    expect(ar.totals).toMatchObject({ outstanding: 0, creditBalance: 53.5 });
    expect(ar.rows).toMatchObject([{ customer_name: c.customerName, invoices: 0, outstanding: 0, credit_balance: 53.5, net_outstanding: -53.5 }]);
    expect((await t.api('GET', '/receivables/aging', undefined, { token: tok })).body.totals).toMatchObject({ total: 0, credit_balance: 53.5 });
    expect((await t.api('POST', '/receipts', { method: 'cash', lines: [{ invoiceId: inv.id, amount: 1 }] }, { token: tok })).status).toBe(400);
    // October sales: 1,070 − 107 + 214 − 53.50
    expect((await t.api('GET', '/summary', undefined, { token: tok })).body.revenueMonth).toBe(1123.5);
  });

  it('an invoice with a VAT deposit deducted: the original value is the full value, credit can exceed the invoice balance (credit balance)', async () => {
    const { tok } = tenant();
    const c = cust();
    const o = (await t.api('POST', '/orders', { ...c, lines: [{ description: 'แม่พิมพ์', qty: 1, unitPrice: 10000 }] }, { token: tok })).body;
    await t.api('POST', `/orders/${o.id}/confirm`, undefined, { token: tok });
    await t.api('POST', '/receipts', { orderId: o.id, depositAmount: 5350, method: 'transfer', receiptDate: '2026-10-01' }, { token: tok }); // 5,000 + 350
    const inv = (await t.api('POST', `/orders/${o.id}/invoice`, { issueDate: '2026-10-05' }, { token: tok })).body;
    expect(inv).toMatchObject({ net: 5000, vat: 350, gross: 5350, deposit_gross: 5350 });
    const cn = (await credit(tok, inv.id, { reasonCode: 'returned', amount: 6000 })).body; // 6,420 > 5,350 still owed
    expect(cn).toMatchObject({ original_net: 10000, correct_net: 4000, net: 6000, vat: 420, gross: 6420 });
    expect((await getInv(tok, inv.id)).outstanding).toBe(-1070);
    expect((await credit(tok, inv.id, { reasonCode: 'returned', amount: 4000.01 })).status).toBe(400);
  });
});

describe('events', () => {
  it('sales.note_issued in the same transaction, with return lines; sales.invoiced carries lines, address and e-mail', async () => {
    const { tok } = tenant();
    const c = cust();
    const inv = await invoiced(tok, { ...c, lines: [{ ...mould, qty: 4, unitPrice: 250, discountPct: 10 }, { description: 'ค่าขนส่ง', qty: 1, unitPrice: 300 }], warehouseCode: 'FG' });
    const iev = (await t.published('sales.invoiced')).find((e) => e.data.invoiceId === inv.id)!.data;
    expect(iev).toMatchObject({
      customerAddress: c.customerAddress, customerEmail: c.customerEmail,
      lines: [
        { itemId: mould.itemId, itemCode: 'FG-MOULD', description: 'แม่พิมพ์', qty: 4, uom: null, unitPrice: 250, discount: 100, amount: 900, vatRate: 0.07 },
        { itemId: null, itemCode: null, description: 'ค่าขนส่ง', qty: 1, unitPrice: 300, discount: 0, amount: 300, vatRate: 0.07 },
      ],
    });

    const cn = (await credit(tok, inv.id, { reasonCode: 'returned', lines: [{ lineNo: 1, qty: 2, returnToStock: 1 }, { lineNo: 2 }] })).body;
    const ev = (await t.published('sales.note_issued')).find((e) => e.data.noteId === cn.id)!.data;
    // 2 × 225 = 450 + 300 = 750; VAT 52.50
    expect(ev).toMatchObject({
      noteNo: cn.no, kind: 'credit', issueDate: '2026-10-20', invoiceId: inv.id, invoiceNo: inv.no, invoiceDate: '2026-10-05',
      customerName: c.customerName, customerTaxId: '0105558123451', customerBranch: '00002',
      originalNet: 1200, correctNet: 450, net: 750, vat: 52.5, gross: 802.5, warehouseCode: 'FG',
      lines: [
        { itemId: mould.itemId, itemCode: 'FG-MOULD', description: 'แม่พิมพ์', qty: 2, unitPrice: 225, amount: 450, returnToStock: 1 },
        { itemId: null, itemCode: null, description: 'ค่าขนส่ง', qty: 1, unitPrice: 300, amount: 300 },
      ],
    });
    expect(ev.lines[1].returnToStock).toBeUndefined();
    // an explicit return warehouse wins over the order's
    const cn2 = (await credit(tok, inv.id, { reasonCode: 'returned', warehouseCode: 'RETURNS', lines: [{ lineNo: 1, qty: 1, returnToStock: true }] })).body;
    expect(cn2.warehouse_code).toBe('RETURNS');
    expect(cn2.returned).toBe('รับคืนสินค้าเข้าคลัง RETURNS');
  });

  it('a refused note publishes nothing', async () => {
    const { tok } = tenant();
    const inv = await invoiced(tok, { ...cust(), lines: [{ description: 'x', qty: 1, unitPrice: 100 }] });
    const before = (await t.published('sales.note_issued')).length;
    expect((await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 500 })).status).toBe(400);
    expect((await t.published('sales.note_issued')).length).toBe(before);
    expect((await getInv(tok, inv.id)).credit_total).toBe(0);
  });
});

describe('lists, permissions, tenants', () => {
  it('lists by kind, filters by invoice / text; detail 404s under the wrong kind', async () => {
    const { tok } = tenant();
    const inv = await invoiced(tok, { ...cust(), lines: [{ description: 'x', qty: 1, unitPrice: 1000 }] });
    const cn = (await credit(tok, inv.id, { reasonCode: 'overcharged', amount: 10 })).body;
    const dn = (await debit(tok, inv.id, { reasonCode: 'price', amount: 20 })).body;
    expect((await t.api('GET', '/credit-notes', undefined, { token: tok })).body.map((n: any) => n.no)).toEqual([cn.no]);
    expect((await t.api('GET', '/debit-notes', undefined, { token: tok })).body.map((n: any) => n.no)).toEqual([dn.no]);
    expect((await t.api('GET', `/notes?invoiceId=${inv.id}`, undefined, { token: tok })).body).toHaveLength(2);
    expect((await t.api('GET', `/notes?q=${inv.no}&kind=debit`, undefined, { token: tok })).body.map((n: any) => n.kind_label)).toEqual(['ใบเพิ่มหนี้']);
    expect((await t.api('GET', `/debit-notes/${cn.id}`, undefined, { token: tok })).status).toBe(404);
    expect((await t.api('GET', `/credit-notes/${cn.id}`, undefined, { token: tok })).body.no).toBe(cn.no);
  });

  it('needs sales.note.write to issue and sales.note.read to see notes', async () => {
    const tid = randomUUID();
    const tok = t.token(ALL, tid);
    const inv = await invoiced(tok, { ...cust(), lines: [{ description: 'x', qty: 1, unitPrice: 100 }] });
    const reader = t.token(['sales.note.read', 'sales.order.read', 'sales.invoice.write'], tid);
    expect((await credit(reader, inv.id, { reasonCode: 'overcharged', amount: 1 })).status).toBe(403);
    expect((await debit(reader, inv.id, { reasonCode: 'price', amount: 1 })).status).toBe(403);
    const cn = (await credit(t.token(['sales.note.write'], tid), inv.id, { reasonCode: 'overcharged', amount: 1 })).body;
    const noRead = t.token(['sales.order.read', 'sales.note.write'], tid);
    for (const url of ['/credit-notes', '/debit-notes', '/notes', `/credit-notes/${cn.id}`]) expect((await t.api('GET', url, undefined, { token: noRead })).status).toBe(403);
    expect((await t.api('GET', `/credit-notes/${cn.id}`, undefined, { token: reader })).status).toBe(200);
  });

  it('another tenant can neither see the notes nor issue one against the invoice', async () => {
    const a = tenant();
    const b = tenant();
    const inv = await invoiced(a.tok, { ...cust(), lines: [{ description: 'x', qty: 1, unitPrice: 100 }] });
    const cn = (await credit(a.tok, inv.id, { reasonCode: 'overcharged', amount: 1 })).body;
    expect((await t.api('GET', `/credit-notes/${cn.id}`, undefined, { token: b.tok })).status).toBe(404);
    expect((await t.api('GET', '/notes', undefined, { token: b.tok })).body).toEqual([]);
    expect((await credit(b.tok, inv.id, { reasonCode: 'overcharged', amount: 1 })).status).toBe(404);
    expect((await getInv(a.tok, inv.id)).credit_total).toBe(1.07);
    // numbering is per tenant
    const invB = await invoiced(b.tok, { ...cust(), lines: [{ description: 'y', qty: 1, unitPrice: 100 }] });
    expect((await credit(b.tok, invB.id, { reasonCode: 'overcharged', amount: 1 })).body.no).toBe('CN-2569-0001');
  });
});
