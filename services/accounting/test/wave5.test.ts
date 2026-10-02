/** Wave 5: richer events from expense / sales / purchasing / payroll and the expense category → account map. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';
import { DEFAULT_CATEGORY_MAP, DEFAULT_RULES } from '../src/chart.ts';
import { todayTh } from '../src/ledger.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const today = todayTh();
const monthStart = `${today.slice(0, 7)}-01`;

function tenant(perms = ['*']) {
  const id = randomUUID();
  const token = t.token(perms, id, { userId: randomUUID(), userName: 'คุณบัญชี ทดสอบ' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  /** events are validated against the contract first, so the tests also prove the payloads are legal */
  const deliver = (type: any, data: unknown) => { parseEvent(type, data); return t.deliver(type, data, { tenantId: id }); };
  const acc = async (code: string) => (await api('GET', `/accounts?q=${code}`)).body.find((a: any) => a.code === code).id as string;
  const journals = async (source: string) => (await api('GET', `/journals?source=${source}`)).body as any[];
  const detail = async (jid: string) => (await api('GET', `/journals/${jid}`)).body;
  const lines = (d: any, code: string) => d.lines.filter((l: any) => l.account_code === code);
  const lineOf = (d: any, code: string) => lines(d, code)[0];
  return { id, token, api, deliver, acc, journals, detail, lines, lineOf };
}

const claim = (over: Record<string, unknown> = {}) => ({
  claimId: randomUUID(), no: 'EXP-2569-0101', claimantName: 'สมชาย ขยัน', claimantId: randomUUID(), total: 0, paidDate: monthStart, payMethod: 'transfer', ...over,
});

const payrollPaid = (over: Record<string, unknown> = {}) => ({
  runId: randomUUID(), no: 'PR-2569-10', period: today.slice(0, 7), payDate: today, paidDate: monthStart, headcount: 3,
  totals: { gross: 61000, salary: 55000, overtime: 3000, allowances: 2000, bonus: 1000, otherIncome: 0, unpaidLeave: 0, ssoEmployee: 2250, ssoEmployer: 2250,
    pvdEmployee: 1500, pvdEmployer: 1500, wht: 1200, otherDeductions: 500, totalDeductions: 5450, net: 55550 },
  postings: [
    { category: 'salary_expense', side: 'debit', amount: 55000 }, { category: 'overtime_expense', side: 'debit', amount: 3000 },
    { category: 'allowance_expense', side: 'debit', amount: 2000 }, { category: 'bonus_expense', side: 'debit', amount: 1000 },
    { category: 'sso_employer_expense', side: 'debit', amount: 2250 }, { category: 'pvd_employer_expense', side: 'debit', amount: 1500 },
    { category: 'sso_payable', side: 'credit', amount: 4500 }, { category: 'wht_payable', side: 'credit', amount: 1200 },
    { category: 'pvd_payable', side: 'credit', amount: 3000 }, { category: 'employee_deductions', side: 'credit', amount: 500 },
    { category: 'net_pay_payable', side: 'credit', amount: 55550 },
  ],
  ...over,
});

describe('expense category → account map', () => {
  it('seeds sensible defaults and the payroll / VAT posting rules', async () => {
    const x = tenant();
    const maps = (await x.api('GET', '/category-mappings')).body;
    expect(maps).toHaveLength(DEFAULT_CATEGORY_MAP.length);
    expect(maps.find((m: any) => m.category_code === 'FUEL')).toMatchObject({ category_name: 'ค่าน้ำมัน', account_code: '52520', account_name: 'ค่าน้ำมันเชื้อเพลิง', is_default: true });
    expect(maps.find((m: any) => m.category_code === 'TRAVEL')).toMatchObject({ account_name: 'ค่าเดินทาง' });
    expect(maps.find((m: any) => m.category_code === 'ENTERTAIN')).toMatchObject({ account_name: 'ค่ารับรอง' });
    const rules = (await x.api('GET', '/posting-rules')).body;
    expect(rules).toHaveLength(DEFAULT_RULES.length);
    expect(rules.filter((r: any) => r.event_type === 'payroll.run_paid').map((r: any) => r.account_code)).toEqual(
      ['52100', '52130', '52150', '52140', '52100', '52110', '52120', '21400', '21300', '21410', '11720', '11200']);
    expect(rules.every((r: any) => r.ok)).toBe(true);
    // setup again adds nothing
    expect((await x.api('POST', '/accounts/setup')).body).toMatchObject({ accounts: 0, rules: 0, mappings: 0 });
  });

  it('CRUD with validation, and a mapped account cannot be deleted', async () => {
    const x = tenant();
    const parking = await x.api('POST', '/category-mappings', { categoryCode: 'parking', categoryName: 'ค่าจอดรถ', accountId: await x.acc('52510') });
    expect(parking.status).toBe(201);
    expect(parking.body).toMatchObject({ category_code: 'parking', account_label: '52510 ค่าเดินทาง' });
    expect((await x.api('POST', '/category-mappings', { categoryCode: 'PARKING', accountId: await x.acc('52510') })).status).toBe(409);
    expect((await x.api('POST', '/category-mappings', { categoryCode: 'X', accountId: await x.acc('52000') })).status).toBe(400); // group
    expect((await x.api('POST', '/category-mappings', { categoryCode: '', accountId: await x.acc('52510') })).status).toBe(400);
    const edited = await x.api('PUT', `/category-mappings/${parking.body.id}`, { accountId: await x.acc('53900') });
    expect(edited.body).toMatchObject({ account_code: '53900', category_name: 'ค่าจอดรถ' });
    expect((await x.api('PUT', `/category-mappings/${parking.body.id}`, { categoryCode: 'FUEL' })).status).toBe(409);
    expect((await x.api('GET', `/category-mappings/${parking.body.id}`)).body.categoryCode).toBe('parking');
    // an account used by a mapping is protected like one used by a posting rule
    const own = await x.api('POST', '/accounts', { code: '52590', name: 'ค่าจอดรถ', type: 'expense', parentId: await x.acc('52000') });
    await x.api('PUT', `/category-mappings/${parking.body.id}`, { accountId: own.body.id });
    expect((await x.api('DELETE', `/accounts/${own.body.id}`)).status).toBe(409);
    expect((await x.api('PUT', `/accounts/${own.body.id}`, { active: false })).status).toBe(409);
    expect((await x.api('DELETE', `/category-mappings/${parking.body.id}`)).body.deleted).toBe(true);
    expect((await x.api('GET', `/category-mappings/${parking.body.id}`)).status).toBe(404);
    expect((await x.api('DELETE', `/accounts/${own.body.id}`)).status).toBe(200);
  });

  it('enforces permissions and isolates tenants', async () => {
    const a = tenant();
    const reader = t.token(['accounting.journal.read'], a.id);
    const fuel = (await a.api('GET', '/category-mappings?q=FUEL')).body[0];
    expect((await a.api('GET', '/category-mappings', undefined, reader)).status).toBe(200);
    expect((await a.api('POST', '/category-mappings', { categoryCode: 'Y', accountId: fuel.account_id }, reader)).status).toBe(403);
    expect((await a.api('PUT', `/category-mappings/${fuel.id}`, { categoryName: 'x' }, reader)).status).toBe(403);
    expect((await a.api('DELETE', `/category-mappings/${fuel.id}`, undefined, reader)).status).toBe(403);
    expect((await a.api('GET', '/category-mappings', undefined, t.token(['sales.order.read'], a.id))).status).toBe(403);
    const b = tenant();
    expect((await b.api('GET', `/category-mappings/${fuel.id}`)).status).toBe(404);
    expect((await b.api('PUT', `/category-mappings/${fuel.id}`, { categoryName: 'x' })).status).toBe(404);
    expect((await b.api('DELETE', `/category-mappings/${fuel.id}`)).status).toBe(404);
    // b cannot map to a's account
    expect((await b.api('POST', '/category-mappings', { categoryCode: 'Z', accountId: fuel.account_id })).status).toBe(400);
    expect((await b.api('GET', '/category-mappings')).body.find((m: any) => m.id === fuel.id)).toBeUndefined();
  });
});

describe('expense.claim_paid with lines', () => {
  it('posts each category to its account, input VAT apart, from cash on the paid date', async () => {
    const x = tenant();
    await x.deliver('expense.claim_paid', claim({
      total: 2105, payMethod: 'cash', lines: [
        { categoryCode: 'FUEL', categoryName: 'ค่าน้ำมัน', amount: 1000, vat: 70 },
        { categoryCode: 'fuel', categoryName: 'ค่าน้ำมัน', amount: 500, vat: 35 },
        { categoryCode: 'ENT', categoryName: 'ค่ารับรอง', amount: 300, vat: 0 }, // code differs → matched by name
        { categoryCode: 'GIFT', categoryName: 'ของขวัญลูกค้า', amount: 200, vat: 0 }, // unmapped → rule `expense` (53900)
      ],
    }));
    const [j] = await x.journals('expense.claim_paid');
    const d = await x.detail(j.id);
    expect(d.entry_date).toBe(monthStart);
    expect(x.lineOf(d, '52520')).toMatchObject({ debit: 1500, partner_name: 'สมชาย ขยัน' });
    expect(x.lineOf(d, '52600')).toMatchObject({ debit: 300 });
    expect(x.lineOf(d, '53900')).toMatchObject({ debit: 200 });
    expect(x.lineOf(d, '11500')).toMatchObject({ debit: 105, tax_base: 1500 });
    expect(x.lineOf(d, '11100')).toMatchObject({ credit: 2105 });
    expect(x.lineOf(d, '11200')).toBeUndefined();
    expect(d.total_debit).toBe(2105);
    expect(d.note).toContain('GIFT ของขวัญลูกค้า');
    // input VAT shows on the ภ.พ.30 input register
    const vat = (await x.api('GET', `/reports/vat/lines?month=${today.slice(0, 7)}&kind=input`)).body;
    expect((vat.rows ?? vat).some((l: any) => Number(l.tax_base) === 1500)).toBe(true);
  });

  it('notes a cleared advance and posts the full claim from the bank', async () => {
    const x = tenant();
    await x.deliver('expense.claim_paid', claim({ no: 'EXP-2569-0102', total: 535, advanceNo: 'ADV-2569-0001', advanceAmount: 500,
      lines: [{ categoryCode: 'HOTEL', categoryName: 'ค่าที่พัก', amount: 500, vat: 35 }] }));
    const d = await x.detail((await x.journals('expense.claim_paid'))[0].id);
    expect(x.lineOf(d, '52530')).toMatchObject({ debit: 500 });
    expect(x.lineOf(d, '11500')).toMatchObject({ debit: 35 });
    expect(x.lineOf(d, '11200')).toMatchObject({ credit: 535 });
    expect(d.note).toContain('ADV-2569-0001');
  });
});

describe('sales / purchasing VAT and dates', () => {
  it('sales.invoiced posts on the tax-invoice date', async () => {
    const x = tenant();
    await x.deliver('sales.invoiced', { invoiceId: randomUUID(), invoiceNo: 'INV-2569-0201', orderId: randomUUID(), net: 1000, vat: 70, gross: 1070,
      customerName: 'ลูกค้า', issueDate: monthStart, vatMode: 'exclusive' });
    const d = await x.detail((await x.journals('sales.invoiced'))[0].id);
    expect(d.entry_date).toBe(monthStart);
    expect(x.lineOf(d, '21200')).toMatchObject({ credit: 70, tax_base: 1000 });
  });

  it('goods received / returned with VAT totals split stock from ภาษีซื้อ', async () => {
    const x = tenant();
    const item = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็ก' };
    const gr = { poId: randomUUID(), poNo: 'PO-2569-0201', supplierId: null, supplierName: 'ผู้ขาย', warehouseCode: 'MAIN',
      lines: [{ ...item, qty: 10, unitPrice: 100, vatRate: 0.07 }], vatMode: 'exclusive', net: 1000, vat: 70, gross: 1070 };
    await x.deliver('purchasing.goods_received', gr);
    const d = await x.detail((await x.journals('purchasing.goods_received'))[0].id);
    expect(x.lineOf(d, '11400')).toMatchObject({ debit: 1000 });
    expect(x.lineOf(d, '11500')).toMatchObject({ debit: 70, tax_base: 1000 });
    expect(x.lineOf(d, '21100')).toMatchObject({ credit: 1070 });
    expect(d.note).toBeNull();
    // VAT mode only (no totals): inclusive prices are split by the line rate
    await x.deliver('purchasing.goods_received', { ...gr, net: undefined, vat: undefined, gross: undefined, vatMode: 'inclusive', lines: [{ ...item, qty: 1, unitPrice: 107, vatRate: 0.07 }] });
    const inc = await x.detail((await x.journals('purchasing.goods_received')).find((j) => j.total_debit === 107).id);
    expect(x.lineOf(inc, '11400')).toMatchObject({ debit: 100 });
    expect(x.lineOf(inc, '11500')).toMatchObject({ debit: 7 });
    await x.deliver('purchasing.goods_returned', { returnId: randomUUID(), returnNo: 'RT-2569-0201', poId: gr.poId, poNo: gr.poNo, supplierId: null, supplierName: 'ผู้ขาย',
      warehouseCode: 'MAIN', lines: [{ ...item, qty: 2, unitPrice: 100 }], vatMode: 'exclusive', net: 200, vat: 14, gross: 214, returnDate: monthStart });
    const r = await x.detail((await x.journals('purchasing.goods_returned'))[0].id);
    expect(r.entry_date).toBe(monthStart);
    expect(x.lineOf(r, '21100')).toMatchObject({ debit: 214 });
    expect(x.lineOf(r, '11400')).toMatchObject({ credit: 200 });
    expect(x.lineOf(r, '11500')).toMatchObject({ credit: 14 });
  });
});

describe('payroll.run_paid', () => {
  it('posts the balanced salary journal on the paid date, once per run', async () => {
    const x = tenant();
    const ev = payrollPaid();
    await x.deliver('payroll.run_paid', ev);
    await x.deliver('payroll.run_paid', ev); // re-sent with a new event id → same run, no second journal
    const js = await x.journals('payroll.run_paid');
    expect(js).toHaveLength(1);
    const d = await x.detail(js[0].id);
    expect(d).toMatchObject({ entry_date: monthStart, status: 'posted', total_debit: 64750, total_credit: 64750, ref: 'PR-2569-10' });
    expect(d.description).toContain('3 คน');
    expect(x.lineOf(d, '52100')).toMatchObject({ debit: 55000 });
    expect(x.lineOf(d, '52130')).toMatchObject({ debit: 3000 });
    expect(x.lineOf(d, '52110')).toMatchObject({ debit: 2250 });
    expect(x.lineOf(d, '52120')).toMatchObject({ debit: 1500 });
    expect(x.lineOf(d, '21400')).toMatchObject({ credit: 4500 });
    expect(x.lineOf(d, '21300')).toMatchObject({ credit: 1200 });
    expect(x.lineOf(d, '21410')).toMatchObject({ credit: 3000 });
    expect(x.lineOf(d, '11720')).toMatchObject({ credit: 500 });
    expect(x.lineOf(d, '11200')).toMatchObject({ credit: 55550 });
    const tb = (await x.api('GET', '/reports/trial-balance')).body;
    expect(tb.totals.difference).toBe(0);
  });

  it('an unknown posting category is a posting error, not a crash', async () => {
    const x = tenant();
    const ev = payrollPaid({ postings: [{ category: 'salary_expense', side: 'debit', amount: 100 }, { category: 'mystery_payable', side: 'credit', amount: 100 }] });
    expect((await x.deliver('payroll.run_paid', ev)).status).toBe(200);
    expect(await x.journals('payroll.run_paid')).toHaveLength(0);
    const errs = (await x.api('GET', '/posting-errors')).body;
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ event_type: 'payroll.run_paid', source_no: 'PR-2569-10' });
    expect(errs[0].reason).toContain('mystery_payable');
  });
});
