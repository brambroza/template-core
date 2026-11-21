import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyResolved, mapImportRows, readXlsx, xlsxTemplate, type ImportSpec } from '@erp/ui-schema';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as sales } from '@erp/svc-sales';
import { definition as purchasing } from '@erp/svc-purchasing';
import { definition as accounting } from '@erp/svc-accounting';
import salesUi from '@erp/svc-sales/ui';
import purchasingUi from '@erp/svc-purchasing/ui';
import { install, type Installation } from './helpers.ts';

/**
 * ลูกหนี้ / เจ้าหนี้ยกมา: unpaid documents of the old system imported from Excel. They are collected / paid like any document, show in
 * the aging reports, and never reach output / input VAT, e-Tax or a revenue / expense posting (the ledger's AR / AP comes from the
 * accounting opening balance); only the receipt / payment posts (cash against AR / AP).
 */
let erp: Installation;
let token: string;
beforeAll(async () => {
  erp = await install([identity, masterData, sales, purchasing, accounting]);
  ({ token } = await erp.provision('opening-ar'));
  await api('POST', '/api/accounting/accounts/setup');
  for (const [code, name, kind, taxId] of [
    ['C-001', 'บริษัท ลูกค้าเก่า จำกัด', 'customer', '0105536000313'], ['C-002', 'ร้านลูกค้าสอง', 'both', null], ['S-001', 'บริษัท ผู้ขายเก่า จำกัด', 'supplier', '0105547023450'],
  ] as const) await api('POST', '/api/master-data/partners', { code, name, kind, ...(taxId ? { taxId } : {}) });
}, 60_000);
afterAll(async () => { await erp?.close(); });

const api = (m: string, p: string, b?: unknown) => erp.call(m, p, b, token);
const specOf = (ui: typeof salesUi, screen: string) => { const s = ui.screens[screen]!; return (s.kind === 'list' ? s.import : undefined)!; };

/** what the web import dialog does with an Excel file */
async function prepare(spec: ImportSpec, table: (string | number)[][]) {
  const m = mapImportRows(spec.columns, await readXlsx(xlsxTemplate(table[0]!.map(String), table.slice(1).map((r) => r.map(String)))));
  const codes = [...new Set(m.rows.map((r) => r[spec.resolve!.column]).filter(Boolean))];
  return applyResolved(m.rows, spec.resolve!, (await api('POST', `/api/${spec.resolve!.module}${spec.resolve!.endpoint}`, { codes })).body);
}
const outbox = async (module: string, type: string) =>
  Number((await erp.services[module]!.db.pool.query(`select count(*) as n from _outbox where type = $1`, [type])).rows[0].n);

describe('ลูกหนี้ยกมา', () => {
  const spec = specOf(salesUi, 'openingInvoices');
  const header = ['รหัสลูกค้า', 'เลขที่ใบแจ้งหนี้เดิม', 'วันที่เอกสาร', 'ครบกำหนดชำระ', 'ยอดค้าง (รวม VAT)', 'หมายเหตุ'];

  it('checks every row in Thai and writes nothing while one is wrong', async () => {
    const rows = await prepare(spec, [header,
      ['C-001', 'IV6810-001', '15/10/2569', '14/11/2569', '10,700.00', ''],
      ['NOPE', 'IV-X', '15/10/2569', '', '100', ''],
      ['S-001', 'IV-Y', '15/10/2569', '', '100', ''],
      ['C-002', 'IV-Z', '31/02/2569', '', '100', ''],
      ['C-002', 'IV-W', '01/10/2569', '01/09/2569', '100', ''],
      ['C-002', 'IV6810-001', '01/10/2569', '', '0', ''],
    ]);
    const r = await api('POST', '/api/sales/opening-receivables/import', { rows });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.errors.map((e: { row: number; field: string }) => [e.row, e.field])).toEqual([[2, 'partnerCode'], [3, 'partnerCode'], [4, 'docDate'], [5, 'dueDate'], [6, 'amount']]);
    expect(r.body.errors[1].message).toContain('ไม่ได้ตั้งเป็นลูกค้า');
    expect((await api('GET', '/api/sales/opening-receivables')).body).toEqual([]);
  });

  it('imports, shows in receivables and aging, and never as revenue, VAT or a tax invoice', async () => {
    const rows = await prepare(spec, [header,
      ['C-001', 'IV6810-001', '15/10/2569', '14/11/2569', '10,700.00', 'ค่าสินค้าเดือนตุลาคม'],
      ['C-002', 'IV6810-002', '2026-11-01', '', '5000', ''],
    ]);
    const invoicedBefore = await outbox('sales', 'sales.invoiced');
    const r = await api('POST', '/api/sales/opening-receivables/import', { rows });
    expect(r.body).toMatchObject({ dryRun: false, created: 2, errors: [] });
    expect(await outbox('sales', 'sales.invoiced')).toBe(invoicedBefore);

    // soonest due first (IV6810-002 is due 1 Nov, IV6810-001 on 14 Nov)
    const list = (await api('GET', '/api/sales/opening-receivables')).body;
    expect(list.map((x: { no: string; customer_name: string; outstanding: string }) => [x.no, x.customer_name, Number(x.outstanding)]))
      .toEqual([['IV6810-002', 'ร้านลูกค้าสอง', 5000], ['IV6810-001', 'บริษัท ลูกค้าเก่า จำกัด', 10700]]);
    const all = (await api('GET', '/api/sales/invoices?status=open')).body;
    expect(all.map((x: { kind: string }) => x.kind)).toEqual(['opening', 'opening']); // the receipt form picks them like any invoice
    expect((await api('GET', '/api/sales/invoices?kind=sale')).body).toEqual([]);
    expect((await api('GET', '/api/sales/receivables')).body.totals.outstanding).toBe(15700);
    const aging = (await api('GET', '/api/sales/receivables/aging')).body;
    expect(JSON.stringify(aging)).toContain('บริษัท ลูกค้าเก่า จำกัด');
    expect((await api('GET', '/api/sales/summary')).body.revenueMonth).toBe(0);
    await erp.settle();
    const vat = (await api('GET', '/api/accounting/reports/vat/lines?month=2026-10&kind=output')).body;
    expect(JSON.stringify(vat)).not.toContain('IV6810');

    const first = list.find((x: { no: string }) => x.no === 'IV6810-001');
    const detail = (await api('GET', `/api/sales/invoices/${first.id}`)).body;
    expect(detail).toMatchObject({ kind: 'opening', kind_label: 'ลูกหนี้ยกมา (จากระบบเดิม)', customer: { code: 'C-001', name: 'บริษัท ลูกค้าเก่า จำกัด' }, opening_note: 'ค่าสินค้าเดือนตุลาคม' });
    // no credit / debit note against a document of the old system
    const note = await api('POST', `/api/sales/invoices/${first.id}/credit-notes`, { reasonCode: 'other', reasonText: 'ทดสอบ', amount: 100 });
    expect(note.status).toBe(409);
    // importing the same file again is refused row by row
    const again = await api('POST', '/api/sales/opening-receivables/import', { rows, dryRun: true });
    expect(again.body.errors.map((e: { message: string }) => e.message)).toEqual([expect.stringContaining('มีอยู่ในระบบแล้ว'), expect.stringContaining('มีอยู่ในระบบแล้ว')]);
  });

  it('is collected with a normal receipt; only the receipt posts (cash against AR)', async () => {
    const inv = (await api('GET', '/api/sales/opening-receivables')).body.find((x: { no: string }) => x.no === 'IV6810-001');
    const r = await api('POST', '/api/sales/receipts', { customerId: inv.customer_id, method: 'transfer', lines: [{ invoiceId: inv.id, amount: 4000 }] });
    expect(r.status).toBe(201);
    const after = (await api('GET', `/api/sales/invoices/${inv.id}`)).body;
    expect(after).toMatchObject({ payment_status: 'partially_paid' });
    expect(Number(after.outstanding)).toBe(6700);
    expect(after.receipts).toHaveLength(1);
    await erp.settle();
    const journals = (await api('GET', '/api/accounting/journals')).body as { source_type: string; total_debit: string }[];
    expect(journals.map((j) => j.source_type)).toEqual(['sales.payment_received']);
    expect(Number(journals[0]!.total_debit)).toBe(4000);
  });
});

describe('เจ้าหนี้ยกมา', () => {
  const spec = specOf(purchasingUi as typeof salesUi, 'openingBills');
  const header = ['รหัสผู้ขาย', 'เลขที่ใบแจ้งหนี้ของผู้ขาย', 'วันที่เอกสาร', 'ครบกำหนดชำระ', 'ยอดค้าง (รวม VAT)', 'หมายเหตุ'];

  it('imports as bills of kind opening (no bill_recorded event), refuses repeats, and is paid with a payment voucher', async () => {
    const rows = await prepare(spec, [header, ['S-001', 'INV-9001', '20/10/2569', '19/11/2569', '21,400', ''], ['C-001', 'X', '20/10/2569', '', '1', '']]);
    const bad = await api('POST', '/api/purchasing/opening-payables/import', { rows });
    expect(bad.body.errors).toEqual([expect.objectContaining({ row: 2, field: 'partnerCode', message: expect.stringContaining('ไม่ได้ตั้งเป็นผู้ขาย') })]);

    const recordedBefore = await outbox('purchasing', 'purchasing.bill_recorded');
    const ok = await api('POST', '/api/purchasing/opening-payables/import', { rows: rows.slice(0, 1) });
    expect(ok.body).toMatchObject({ dryRun: false, created: 1 });
    expect(await outbox('purchasing', 'purchasing.bill_recorded')).toBe(recordedBefore);
    const bill = (await api('GET', '/api/purchasing/opening-payables')).body[0];
    expect(bill).toMatchObject({ kind: 'opening', kind_label: 'เจ้าหนี้ยกมา (จากระบบเดิม)', supplier_invoice_no: 'INV-9001', vat_mode: 'none', status: 'open' });
    expect(Number(bill.gross)).toBe(21400);
    expect(Number(bill.vat)).toBe(0);

    const again = await api('POST', '/api/purchasing/opening-payables/import', { rows: rows.slice(0, 1), dryRun: true });
    expect(again.body.errors[0].message).toContain('ตั้งหนี้ไว้แล้ว');

    const paid = await api('POST', `/api/purchasing/bills/${bill.id}/payments`, { method: 'transfer' });
    expect(paid.status).toBe(201);
    expect((await api('GET', `/api/purchasing/bills/${bill.id}`)).body.status).toBe('paid');
    await erp.settle();
    const sources = ((await api('GET', '/api/accounting/journals')).body as { source_type: string }[]).map((j) => j.source_type).sort();
    expect(sources).toEqual(['purchasing.supplier_paid', 'sales.payment_received']);
    const input = (await api('GET', '/api/accounting/reports/vat/lines?month=2026-10&kind=input')).body;
    expect(JSON.stringify(input)).not.toContain('INV-9001');
  });
});
