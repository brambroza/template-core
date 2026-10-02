/** Wave 8: output VAT on deposits (C2) and the period-close event that locks the posting modules (C5). */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';
import { todayTh } from '../src/ledger.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

function tenant() {
  const id = randomUUID();
  const token = t.token(['*'], id, { userId: randomUUID(), userName: 'คุณบัญชี ทดสอบ' });
  const api = (m: string, url: string, body?: unknown) => t.api(m, url, body, { token });
  const deliver = (type: any, data: unknown) => { parseEvent(type, data); return t.deliver(type, data, { tenantId: id }); };
  const journal = async (source: string) => {
    const j = (await api('GET', `/journals?source=${source}`)).body[0];
    return (await api('GET', `/journals/${j.id}`)).body;
  };
  const amt = (d: any, code: string, side: 'debit' | 'credit') => d.lines.filter((l: any) => l.account_code === code).reduce((s: number, l: any) => s + Number(l[side]), 0);
  return { id, api, deliver, journal, amt };
}

const customer = { customerId: randomUUID(), customerName: 'บริษัท ทดสอบมัดจำ จำกัด' };

describe('C2 — output VAT on deposits', () => {
  it('deposit 99,670.50 incl. VAT: Dr bank 99,670.50 / Cr เงินมัดจำรับ 93,150.00 + Cr ภาษีขาย 6,520.50; the final invoice reverses the deposit base and charges only the remaining VAT', async () => {
    const x = tenant();
    const depositId = randomUUID();
    expect((await x.deliver('sales.payment_received', {
      receiptId: depositId, receiptNo: 'RC-2569-0007', kind: 'deposit', ...customer, receiptDate: '2026-10-01', method: 'transfer',
      total: 99670.5, whtAmount: 0, depositApplied: 0, received: 99670.5, invoices: [], net: 93150, vat: 6520.5, taxInvoiceNo: 'DT-2569-0001',
      customerTaxId: '0105558123451', customerBranch: '00001',
    })).status).toBe(200);
    const dj = await x.journal('sales.payment_received');
    expect(dj).toMatchObject({ entry_date: '2026-10-01', status: 'posted' });
    expect(x.amt(dj, '11200', 'debit')).toBe(99670.5);
    expect(x.amt(dj, '21700', 'credit')).toBe(93150);
    expect(x.amt(dj, '21200', 'credit')).toBe(6520.5);
    expect(dj.lines.find((l: any) => l.account_code === '21200')).toMatchObject({ tax_base: 93150 });

    // final invoice: goods 310,500 + VAT 21,735; deposit deducted → this invoice: base 217,350, VAT 15,214.50, due 232,564.50
    await x.deliver('sales.invoiced', {
      invoiceId: randomUUID(), invoiceNo: 'INV-2569-0014', orderId: randomUUID(), net: 217350, vat: 15214.5, gross: 232564.5, ...customer,
      issueDate: '2026-10-03', vatMode: 'exclusive',
      depositApplied: { net: 93150, vat: 6520.5, gross: 99670.5, deposits: [{ depositId, depositNo: 'RC-2569-0007', taxInvoiceNo: 'DT-2569-0001', net: 93150, vat: 6520.5, gross: 99670.5 }] },
    });
    const ij = await x.journal('sales.invoiced');
    expect(x.amt(ij, '11300', 'debit')).toBe(232564.5);
    expect(x.amt(ij, '21700', 'debit')).toBe(93150);
    expect(x.amt(ij, '41000', 'credit')).toBe(310500);
    expect(x.amt(ij, '21200', 'credit')).toBe(15214.5);
    expect(ij.total_debit).toBe(ij.total_credit);

    // the month's output VAT = 6,520.50 + 15,214.50 = 21,735 (VAT of the whole sale), deposit liability cleared
    const vat = (await x.api('GET', '/reports/vat?year=2026')).body;
    const oct = vat.rows.find((r: any) => r.month === '2026-10');
    expect(oct).toMatchObject({ output_vat: 21735, output_base: 310500 });
    const tb = (await x.api('GET', '/reports/trial-balance?asOf=2026-10-31')).body;
    expect(tb.rows.find((r: any) => r.code === '21700')).toMatchObject({ debit_total: 93150, credit_total: 93150, debit: 0, credit: 0 });
    expect(tb.rows.find((r: any) => r.code === '21200')).toMatchObject({ credit: 21735 });
    expect(tb.totals.balanced).toBe(true);
  });

  it('a deposit without VAT (old payload or vatMode none) still credits เงินมัดจำรับ in full', async () => {
    const x = tenant();
    await x.deliver('sales.payment_received', {
      receiptId: randomUUID(), receiptNo: 'RC-2569-0001', kind: 'deposit', ...customer, receiptDate: '2026-10-01', method: 'cash',
      total: 5000, whtAmount: 0, depositApplied: 0, received: 5000, invoices: [],
    });
    const j = await x.journal('sales.payment_received');
    expect(x.amt(j, '11100', 'debit')).toBe(5000);
    expect(x.amt(j, '21700', 'credit')).toBe(5000);
    expect(x.amt(j, '21200', 'credit')).toBe(0);
  });
});

describe('C5 — period close publishes accounting.period_closed / period_reopened', () => {
  it('close → event with the last day; reopen → event with the first day', async () => {
    const x = tenant();
    expect((await x.api('POST', '/periods/2026-09/close')).status).toBe(200);
    const closed = (await t.published('accounting.period_closed')).find((e) => e.data.period === '2026-09' && e.data.closedByName === 'คุณบัญชี ทดสอบ');
    expect(closed!.data).toEqual({ period: '2026-09', lastDate: '2026-09-30', closedByName: 'คุณบัญชี ทดสอบ' });
    parseEvent('accounting.period_closed', closed!.data);
    expect((await x.api('POST', '/periods/2026-09/reopen')).status).toBe(200);
    const reopened = (await t.published('accounting.period_reopened')).at(-1)!;
    expect(reopened.data).toMatchObject({ period: '2026-09', firstDate: '2026-09-01' });
    // a refused close publishes nothing
    const before = (await t.published('accounting.period_closed')).length;
    await x.api('POST', '/periods/2026-08/close');
    expect((await x.api('POST', '/periods/2026-08/close')).status).toBe(409);
    expect((await t.published('accounting.period_closed')).length).toBe(before + 1);
  });

  it('needs accounting.period.close', async () => {
    const x = tenant();
    const tok = t.token(['accounting.journal.read'], x.id);
    expect((await t.api('POST', '/periods/2026-07/close', undefined, { token: tok })).status).toBe(403);
  });
});

describe('round-2 #4 — journal default dates at 02:00 Bangkok', () => {
  it('a manual JV without a date and an event without a document date are dated on the Thai day', async () => {
    setClock('2026-10-02T19:00:00Z');
    expect(todayTh()).toBe('2026-10-03');
    const x = tenant();
    await x.deliver('sales.payment_received', {
      receiptId: randomUUID(), receiptNo: 'RC-2569-0099', kind: 'deposit', ...customer, method: 'cash',
      total: 107, whtAmount: 0, depositApplied: 0, received: 107, invoices: [], net: 100, vat: 7, taxInvoiceNo: 'DT-2569-0099',
    });
    expect((await x.journal('sales.payment_received')).entry_date).toBe('2026-10-03');
  });
});
