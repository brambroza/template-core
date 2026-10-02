import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';
import { STANDARD_CHART, DEFAULT_RULES } from '../src/chart.ts';
import { todayTh } from '../src/ledger.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const today = todayTh();
const thisMonth = today.slice(0, 7);

/** a fresh tenant with its own admin token, so scenarios don't see each other's postings */
function tenant() {
  const id = randomUUID();
  const token = t.token(['*'], id, { userId: randomUUID(), userName: 'คุณบัญชี ทดสอบ' });
  const api = (m: string, url: string, body?: unknown) => t.api(m, url, body, { token });
  const deliver = (type: string, data: unknown, eventId?: string) => t.deliver(type, data, { tenantId: id, id: eventId });
  const ids = new Map<string, string>();
  const acc = async (code: string) => {
    if (!ids.has(code)) {
      const r = await api('GET', `/accounts?q=${code}`);
      const row = r.body.find((a: any) => a.code === code);
      if (!row) throw new Error(`no account ${code}`);
      ids.set(code, row.id);
    }
    return ids.get(code)!;
  };
  const jv = async (lines: [string, number, number][], extra: Record<string, unknown> = {}) =>
    api('POST', '/journals', { description: 'ทดสอบ', lines: await Promise.all(lines.map(async ([code, debit, credit]) => ({ accountId: await acc(code), debit, credit }))), ...extra });
  const journals = async (source?: string) => (await api('GET', `/journals${source ? `?source=${source}` : ''}`)).body as any[];
  const detail = async (id: string) => (await api('GET', `/journals/${id}`)).body;
  const lineOf = (d: any, code: string) => d.lines.find((l: any) => l.account_code === code);
  return { id, token, api, deliver, acc, jv, journals, detail, lineOf };
}

const invoice = (over: Record<string, unknown> = {}) => ({
  invoiceId: randomUUID(), invoiceNo: 'INV-2569-0001', orderId: randomUUID(), net: 1000, vat: 70, gross: 1070,
  customerId: randomUUID(), customerName: 'บริษัท ลูกค้าดี จำกัด', dueDate: '2026-12-31', ...over,
});

describe('chart of accounts', () => {
  it('seeds the standard Thai chart lazily and setup is idempotent', async () => {
    const x = tenant();
    const list = (await x.api('GET', '/accounts')).body;
    expect(list).toHaveLength(STANDARD_CHART.length);
    expect(list.find((a: any) => a.code === '11600').name).toBe('ภาษีเงินได้ถูกหัก ณ ที่จ่าย');
    expect(list.find((a: any) => a.code === '21700').role).toBe('deposit_received');
    expect(list.find((a: any) => a.code === '11300').parent_code).toBe('11000');
    const again = await x.api('POST', '/accounts/setup');
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ accounts: 0, rules: 0, total: STANDARD_CHART.length });
    expect((await x.api('GET', '/posting-rules')).body).toHaveLength(DEFAULT_RULES.length);
    expect((await x.api('GET', '/posting-rules')).body.every((r: any) => r.ok)).toBe(true);
    const postable = (await x.api('GET', '/accounts?postable=true')).body;
    expect(postable.some((a: any) => a.is_group)).toBe(false);
    expect((await x.api('GET', '/accounts?groups=true')).body.every((a: any) => a.is_group)).toBe(true);
  });

  it('creates, edits and deletes accounts with Thai rules', async () => {
    const x = tenant();
    const group = (await x.api('GET', '/accounts?q=11000')).body.find((a: any) => a.code === '11000');
    const created = await x.api('POST', '/accounts', { code: '11210', name: 'เงินฝากธนาคารกสิกรไทย', type: 'asset', parentId: group.id, role: 'bank' });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ category: 'current_asset', role: 'bank', type_label: 'สินทรัพย์' });
    expect((await x.api('POST', '/accounts', { code: '11210', name: 'ซ้ำ', type: 'asset' })).status).toBe(409);
    // parent must be a group of the same type
    expect((await x.api('POST', '/accounts', { code: '11220', name: 'x', type: 'asset', parentId: await x.acc('11100') })).status).toBe(400);
    expect((await x.api('POST', '/accounts', { code: '11230', name: 'x', type: 'liability', parentId: group.id })).status).toBe(400);
    expect((await x.api('POST', '/accounts', { code: '11240', name: 'x', type: 'asset', category: 'revenue' })).status).toBe(400);

    const edited = await x.api('PUT', `/accounts/${created.body.id}`, { name: 'เงินฝาก KBank ออมทรัพย์' });
    expect(edited.body.name).toBe('เงินฝาก KBank ออมทรัพย์');

    // used accounts cannot be deleted or re-coded
    expect((await x.jv([['11210', 500, 0], ['31000', 0, 500]], { post: true })).status).toBe(201);
    const del = await x.api('DELETE', `/accounts/${created.body.id}`);
    expect(del.status).toBe(409);
    expect(del.body.error.message).toContain('ลบไม่ได้');
    expect((await x.api('PUT', `/accounts/${created.body.id}`, { code: '11299' })).status).toBe(409);
    expect((await x.api('GET', `/accounts/${created.body.id}`)).body).toMatchObject({ used: true, balance: 500, lines: 1 });

    // unused → deleted; used in a posting rule / has children → 409
    const spare = (await x.api('POST', '/accounts', { code: '52450', name: 'ค่าบริการ cloud', type: 'expense' })).body;
    expect((await x.api('DELETE', `/accounts/${spare.id}`)).status).toBe(200);
    expect((await x.api('DELETE', `/accounts/${await x.acc('41000')}`)).status).toBe(409);
    expect((await x.api('DELETE', `/accounts/${group.id}`)).status).toBe(409);
    expect((await x.api('PUT', `/accounts/${await x.acc('11300')}`, { active: false })).status).toBe(409);
  });
});

describe('journal vouchers', () => {
  it('must balance (400 with a Thai message)', async () => {
    const x = tenant();
    const bad = await x.jv([['52200', 1000, 0], ['11200', 0, 900]]);
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toContain('ไม่สมดุล');
    expect(bad.body.error.details).toMatchObject({ debit: 1000, credit: 900, difference: 100 });
    expect((await x.jv([['52200', 100, 100], ['11200', 0, 0]])).status).toBe(400);
    expect((await x.jv([['52200', 100, 0]])).status).toBe(400);
    expect((await x.jv([['52000', 100, 0], ['11200', 0, 100]])).body.error.message).toContain('บัญชีคุม');
    expect((await x.api('POST', '/journals', { description: 'x', lines: [{ accountId: randomUUID(), debit: 1 }, { accountId: randomUUID(), credit: 1 }] })).status).toBe(400);
  });

  it('draft → edit → post; posted entries are locked (409)', async () => {
    const x = tenant();
    const r = await x.jv([['52200', 15000, 0], ['11200', 0, 15000]], { description: 'ค่าเช่าโรงงาน ต.ค.', ref: 'RENT-10' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'draft', status_label: 'ร่าง', total_debit: 15000, source_type: 'manual', created_by_name: 'คุณบัญชี ทดสอบ' });
    expect(r.body.no).toMatch(/^JV-\d{4}-0001$/);
    const id = r.body.id;

    const lines = await x.api('PUT', `/journals/${id}/lines`, { lines: [
      { accountId: await x.acc('52200'), debit: 14000 }, { accountId: await x.acc('11500'), debit: 980, taxBase: 14000 }, { accountId: await x.acc('11200'), credit: 14980 },
    ] });
    expect(lines.body.total_credit).toBe(14980);
    expect((await x.api('PUT', `/journals/${id}`, { description: 'ค่าเช่าโรงงาน ตุลาคม' })).body.description).toBe('ค่าเช่าโรงงาน ตุลาคม');

    const posted = await x.api('POST', `/journals/${id}/post`);
    expect(posted.body).toMatchObject({ status: 'posted', posted_by_name: 'คุณบัญชี ทดสอบ' });
    expect((await x.api('POST', `/journals/${id}/post`)).status).toBe(409);
    expect((await x.api('POST', `/journals/${id}/cancel`)).status).toBe(409);
    expect((await x.api('PUT', `/journals/${id}`, { description: 'x' })).status).toBe(409);
    expect((await x.api('PUT', `/journals/${id}/lines`, { lines: [] })).status).toBe(400);

    const d2 = await x.jv([['52300', 10, 0], ['11100', 0, 10]]);
    expect((await x.api('POST', `/journals/${d2.body.id}/cancel`)).body.status).toBe('cancelled');
    expect((await x.api('POST', `/journals/${d2.body.id}/post`)).status).toBe(409);

    expect((await x.api('GET', '/journals?q=ตุลาคม')).body.map((j: any) => j.id)).toEqual([id]);
    expect((await x.api('GET', `/journals?accountId=${await x.acc('11500')}`)).body).toHaveLength(1);
    expect((await x.api('GET', '/journals?status=cancelled')).body).toHaveLength(1);
  });

  it('reverses a posted entry with a reversing JV', async () => {
    const x = tenant();
    const orig = (await x.jv([['52600', 2000, 0], ['11100', 0, 2000]], { post: true, entryDate: today })).body;
    const rev = await x.api('POST', `/journals/${orig.id}/reverse`, { reason: 'บันทึกผิดบัญชี' });
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({ status: 'posted', source_type: 'reversal', reversal_of_no: orig.no });
    expect(x.lineOf(rev.body, '52600')).toMatchObject({ debit: 0, credit: 2000 });
    expect(x.lineOf(rev.body, '11100')).toMatchObject({ debit: 2000, credit: 0 });
    expect((await x.detail(orig.id))).toMatchObject({ status: 'reversed', reversed_by_no: rev.body.no });
    expect((await x.api('POST', `/journals/${orig.id}/reverse`)).status).toBe(409);
    const tb = (await x.api('GET', '/reports/trial-balance')).body;
    expect(tb.rows.find((r: any) => r.code === '52600')).toMatchObject({ debit: 0, credit: 0, debit_total: 2000, credit_total: 2000 });
    expect((await x.api('POST', `/journals/${orig.id}/reverse`, { entryDate: '2000-01-01' })).status).toBe(409);
  });

  it('fiscal periods: close blocks posting (409), reopen allows it again', async () => {
    const x = tenant();
    const draft = (await x.jv([['52200', 100, 0], ['11200', 0, 100]], { entryDate: '2025-01-15' })).body;
    const blocked = await x.api('POST', '/periods/2025-01/close');
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.message).toContain('ร่าง');
    await x.api('POST', `/journals/${draft.id}/post`);
    const posted = (await x.jv([['52200', 50, 0], ['11200', 0, 50]], { entryDate: '2025-01-20', post: true })).body;
    expect((await x.api('POST', '/periods/2025-01/close', { note: 'ปิดงบเดือน ม.ค.' })).body).toMatchObject({ status: 'closed', message: 'ปิดงวด มกราคม 2568 แล้ว' });
    expect((await x.api('POST', '/periods/2025-01/close')).status).toBe(409);

    const into = await x.jv([['52200', 10, 0], ['11200', 0, 10]], { entryDate: '2025-01-31', post: true });
    expect(into.status).toBe(409);
    expect(into.body.error.message).toContain('ปิดแล้ว');
    // a draft may still be keyed in, but not posted
    const late = (await x.jv([['52200', 10, 0], ['11200', 0, 10]], { entryDate: '2025-01-31' })).body;
    expect((await x.api('POST', `/journals/${late.id}/post`)).status).toBe(409);
    // reversing INTO the closed period is blocked; reversing dated today is fine
    expect((await x.api('POST', `/journals/${posted.id}/reverse`, { entryDate: '2025-01-31' })).status).toBe(409);

    const periods = (await x.api('GET', '/periods?year=2025')).body;
    expect(periods).toHaveLength(12);
    expect(periods[0]).toMatchObject({ period: '2025-01', status: 'closed', entries: 2, drafts: 1, closed_by_name: 'คุณบัญชี ทดสอบ', period_th: 'มกราคม 2568' });
    expect(periods[1].status).toBe('open');

    expect((await x.api('POST', '/periods/2025-01/reopen', { note: 'ปรับปรุงรายการ' })).body.status).toBe('open');
    expect((await x.api('POST', '/periods/2025-01/reopen')).status).toBe(409);
    expect((await x.api('POST', `/journals/${late.id}/post`)).body.status).toBe('posted');
    expect((await x.api('POST', '/periods/2025-13/close')).status).toBe(400);
  });
});

describe('auto-posting from events', () => {
  it('sales.invoiced → Dr ลูกหนี้ / Cr รายได้ + ภาษีขาย, once per invoice', async () => {
    const x = tenant();
    const inv = invoice();
    expect((await x.deliver('sales.invoiced', inv)).status).toBe(200);
    const js = await x.journals('sales.invoiced');
    expect(js).toHaveLength(1);
    const d = await x.detail(js[0].id);
    expect(d).toMatchObject({ status: 'posted', ref: 'INV-2569-0001', entry_date: today, total_debit: 1070, source_label: 'ขาย — ออกใบกำกับภาษี' });
    expect(x.lineOf(d, '11300')).toMatchObject({ debit: 1070, partner_name: 'บริษัท ลูกค้าดี จำกัด' });
    expect(x.lineOf(d, '41000')).toMatchObject({ credit: 1000 });
    expect(x.lineOf(d, '21200')).toMatchObject({ credit: 70, tax_base: 1000 });

    // same event again (kernel inbox) and the same invoice under a new event id: still one journal
    const id = randomUUID();
    await x.deliver('sales.invoiced', invoice(), id);
    await x.deliver('sales.invoiced', invoice(), id);
    await x.deliver('sales.invoiced', inv);
    expect(await x.journals('sales.invoiced')).toHaveLength(2);
    expect((await x.api('GET', '/posting-errors')).body).toHaveLength(0);
  });

  it('sales.payment_received: receipt with WHT, deposit, and deposit applied', async () => {
    const x = tenant();
    await x.deliver('sales.payment_received', {
      receiptId: randomUUID(), receiptNo: 'RC-2569-0001', kind: 'payment', customerId: null, customerName: 'ลูกค้า ก', method: 'transfer',
      total: 1070, whtAmount: 30, depositApplied: 0, received: 1040, invoices: [{ invoiceId: randomUUID(), invoiceNo: 'INV-2569-0001', amount: 1070, outstanding: 0 }],
    });
    await x.deliver('sales.payment_received', {
      receiptId: randomUUID(), receiptNo: 'RC-2569-0002', kind: 'deposit', customerId: null, customerName: 'ลูกค้า ข', method: 'cash',
      total: 5000, whtAmount: 0, depositApplied: 0, received: 5000, invoices: [],
    });
    await x.deliver('sales.payment_received', {
      receiptId: randomUUID(), receiptNo: 'RC-2569-0003', kind: 'payment', customerId: null, customerName: 'ลูกค้า ข', method: 'cheque',
      total: 10700, whtAmount: 300, depositApplied: 5000, received: 5400, invoices: [{ invoiceId: randomUUID(), invoiceNo: 'INV-2569-0002', amount: 10700, outstanding: 0 }],
    });
    const js = (await x.journals('sales.payment_received')).sort((a, b) => a.ref.localeCompare(b.ref));
    expect(js.map((j) => j.ref)).toEqual(['RC-2569-0001', 'RC-2569-0002', 'RC-2569-0003']);
    const [p1, dep, p2] = await Promise.all(js.map((j) => x.detail(j.id)));
    expect(x.lineOf(p1, '11200')).toMatchObject({ debit: 1040 });
    expect(x.lineOf(p1, '11600')).toMatchObject({ debit: 30 });
    expect(x.lineOf(p1, '11300')).toMatchObject({ credit: 1070, description: 'ตัดหนี้ INV-2569-0001' });
    expect(x.lineOf(dep, '11100')).toMatchObject({ debit: 5000 });
    expect(x.lineOf(dep, '21700')).toMatchObject({ credit: 5000 });
    expect(x.lineOf(p2, '21700')).toMatchObject({ debit: 5000 });
    expect(x.lineOf(p2, '11300')).toMatchObject({ credit: 10700 });

    const wht = (await x.api('GET', `/reports/wht-received?year=${today.slice(0, 4)}`)).body;
    expect(wht).toMatchObject({ total: 330, balance: 330 });
    expect(wht.lines.map((l: any) => l.ref).sort()).toEqual(['RC-2569-0001', 'RC-2569-0003']);
    expect(wht.customers[0]).toMatchObject({ partner_name: 'ลูกค้า ข', amount: 300 });
  });

  it('purchasing.goods_received / goods_returned → stock vs AP at PO price (no VAT info)', async () => {
    const x = tenant();
    const supplierId = randomUUID();
    const item = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น' };
    const gr = { poId: randomUUID(), poNo: 'PO-2569-0007', supplierId, supplierName: 'หจก. เหล็กไทย', warehouseCode: 'MAIN', lines: [{ ...item, qty: 10, unitPrice: 50.5 }, { ...item, itemCode: 'RM-BOLT', qty: 3, unitPrice: 10 }] };
    await x.deliver('purchasing.goods_received', gr);
    await x.deliver('purchasing.goods_received', { ...gr, lines: [{ ...item, qty: 2, unitPrice: 50.5 }] }); // second partial receipt
    const js = await x.journals('purchasing.goods_received');
    expect(js).toHaveLength(2);
    const d = await x.detail(js.find((j) => j.total_debit === 535).id);
    expect(x.lineOf(d, '11400')).toMatchObject({ debit: 535 });
    expect(x.lineOf(d, '21100')).toMatchObject({ credit: 535, partner_name: 'หจก. เหล็กไทย', partner_id: supplierId });
    expect(d.note).toContain('ภาษีมูลค่าเพิ่ม');

    await x.deliver('purchasing.goods_returned', { returnId: randomUUID(), returnNo: 'RT-2569-0001', poId: gr.poId, poNo: gr.poNo, supplierId, supplierName: gr.supplierName, warehouseCode: 'QC-HOLD',
      lines: [{ ...item, qty: 1, unitPrice: 50.5, reason: 'สนิม' }] });
    const ret = await x.detail((await x.journals('purchasing.goods_returned'))[0].id);
    expect(x.lineOf(ret, '21100')).toMatchObject({ debit: 50.5 });
    expect(x.lineOf(ret, '11400')).toMatchObject({ credit: 50.5 });
    const summary = (await x.api('GET', '/summary')).body;
    expect(summary.apBalance).toBe(535 + 101 - 50.5);
  });

  it('expense.claim_paid → Dr ค่าใช้จ่าย / Cr เงินฝาก', async () => {
    const x = tenant();
    await x.deliver('expense.claim_paid', { claimId: randomUUID(), no: 'EXP-2569-0003', claimantName: 'สมชาย ขยัน', total: 856, claimantId: randomUUID() });
    const d = await x.detail((await x.journals('expense.claim_paid'))[0].id);
    expect(x.lineOf(d, '53900')).toMatchObject({ debit: 856, partner_name: 'สมชาย ขยัน' });
    expect(x.lineOf(d, '11200')).toMatchObject({ credit: 856 });
    // a zero-total claim posts nothing and records no error
    await x.deliver('expense.claim_paid', { claimId: randomUUID(), no: 'EXP-2569-0004', claimantName: null, total: 0 });
    expect(await x.journals('expense.claim_paid')).toHaveLength(1);
    expect((await x.api('GET', '/posting-errors')).body).toHaveLength(0);
  });

  it('missing mapping → posting error (event still acknowledged); fix rule + retry posts it', async () => {
    const x = tenant();
    const rules = (await x.api('GET', '/posting-rules')).body;
    const vat = rules.find((r: any) => r.event_type === 'sales.invoiced' && r.leg === 'vat');
    expect((await x.api('PUT', `/posting-rules/${vat.id}`, { accountId: null })).body.account_label).toBe('— ยังไม่ได้เลือก —');
    expect((await x.api('PUT', `/posting-rules/${vat.id}`, { accountId: await x.acc('21000') })).status).toBe(400); // group account

    const res = await x.deliver('sales.invoiced', invoice({ invoiceNo: 'INV-2569-0099' }));
    expect(res.status).toBe(200);
    expect(await x.journals()).toHaveLength(0);
    const errs = (await x.api('GET', '/posting-errors')).body;
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({ source_no: 'INV-2569-0099', status: 'open', event_label: 'ขาย — ออกใบกำกับภาษี' });
    expect(errs[0].reason).toContain('ภาษีขาย');

    const failed = await x.api('POST', `/posting-errors/${errs[0].id}/retry`);
    expect(failed.body).toMatchObject({ ok: false, status: 'open' });
    expect((await x.api('GET', '/posting-errors')).body[0].attempts).toBe(2);

    await x.api('PUT', `/posting-rules/${vat.id}`, { accountId: await x.acc('21200') });
    const ok = await x.api('POST', `/posting-errors/${errs[0].id}/retry`);
    expect(ok.body).toMatchObject({ ok: true, status: 'resolved' });
    expect(await x.journals('sales.invoiced')).toHaveLength(1);
    expect((await x.api('GET', '/posting-errors')).body).toHaveLength(0);
    expect((await x.api('GET', '/posting-errors?status=resolved')).body[0].journal_no).toMatch(/^JV-/);
    expect((await x.api('POST', `/posting-errors/${errs[0].id}/retry`)).status).toBe(409);
  });

  it('event into a closed period → posting error; reopen + retry; dismiss', async () => {
    const x = tenant();
    expect((await x.api('POST', `/periods/${thisMonth}/close`)).status).toBe(200);
    await x.deliver('expense.claim_paid', { claimId: randomUUID(), no: 'EXP-2569-0010', claimantName: 'ก', total: 100 });
    await x.deliver('expense.claim_paid', { claimId: randomUUID(), no: 'EXP-2569-0011', claimantName: 'ข', total: 200 });
    const errs = (await x.api('GET', '/posting-errors')).body;
    expect(errs).toHaveLength(2);
    expect(errs[0].reason).toContain('ปิดแล้ว');
    await x.api('POST', `/periods/${thisMonth}/reopen`);
    const e10 = errs.find((e: any) => e.source_no === 'EXP-2569-0010');
    const e11 = errs.find((e: any) => e.source_no === 'EXP-2569-0011');
    expect((await x.api('POST', `/posting-errors/${e10.id}/retry`)).body.ok).toBe(true);
    expect((await x.api('POST', `/posting-errors/${e11.id}/dismiss`)).body.status).toBe('dismissed');
    expect((await x.api('POST', `/posting-errors/${e11.id}/dismiss`)).status).toBe(409);
    expect(await x.journals('expense.claim_paid')).toHaveLength(1);
  });
});

describe('reports', () => {
  it('trial balance sums to zero; P&L, balance sheet, VAT, ledger and summary agree', async () => {
    const x = tenant();
    await x.jv([['11200', 100000, 0], ['31000', 0, 100000]], { post: true, description: 'ทุนจดทะเบียน', entryDate: `${today.slice(0, 4)}-01-02` });
    await x.deliver('sales.invoiced', invoice({ net: 20000, vat: 1400, gross: 21400 }));
    await x.deliver('purchasing.goods_received', { poId: randomUUID(), poNo: 'PO-1', supplierId: null, supplierName: 'ผู้ขาย', warehouseCode: 'MAIN',
      lines: [{ itemId: randomUUID(), itemCode: 'A', qty: 100, unitPrice: 80 }] });
    // purchase tax invoice keyed by hand: ภาษีซื้อ with its base
    await x.api('POST', '/journals', { description: 'ใบกำกับภาษีซื้อ PO-1', ref: 'TAX-778', post: true, lines: [
      { accountId: await x.acc('11500'), debit: 560, taxBase: 8000, partnerName: 'ผู้ขาย' }, { accountId: await x.acc('21100'), credit: 560 }] });
    await x.jv([['51100', 6000, 0], ['11400', 0, 6000]], { post: true, description: 'ต้นทุนขาย' });
    await x.deliver('expense.claim_paid', { claimId: randomUUID(), no: 'EXP-1', claimantName: 'ก', total: 1500 });
    await x.jv([['52100', 99, 0], ['11200', 0, 99]]); // draft: never counts

    const tb = (await x.api('GET', '/reports/trial-balance')).body;
    expect(tb.totals.difference).toBe(0);
    expect(tb.totals.balanced).toBe(true);
    expect(tb.totals.debit).toBeGreaterThan(0);
    expect(tb.table.at(-1)).toMatchObject({ name: 'รวม', debit: tb.totals.debit, credit: tb.totals.credit });
    expect(tb.rows.find((r: any) => r.code === '52100')).toBeUndefined();
    expect((await x.api('GET', '/reports/trial-balance?all=true')).body.rows.length).toBeGreaterThan(tb.rows.length);
    expect((await x.api('GET', '/reports/trial-balance?asOf=2000-01-01')).body.rows).toHaveLength(0);

    const pl = (await x.api('GET', '/reports/profit-loss')).body;
    expect(pl.totals.revenue.month).toBe(20000);
    expect(pl.totals.costOfSales.month).toBe(6000);
    expect(pl.totals.grossProfit.month).toBe(14000);
    expect(pl.totals.expenses.month).toBe(1500);
    expect(pl.totals.netProfit).toEqual({ month: 12500, ytd: 12500 });
    expect(pl.rows.at(-1)).toMatchObject({ kind: 'result', name: 'กำไร (ขาดทุน) สุทธิ', month: 12500 });

    const bs = (await x.api('GET', '/reports/balance-sheet')).body;
    expect(bs.totals.difference).toBe(0);
    expect(bs.totals.balanced).toBe(true);
    expect(bs.totals.netProfitYear).toBe(12500);
    expect(bs.totals.equity).toBe(112500);

    const vat = (await x.api('GET', '/reports/vat')).body;
    const m = vat.rows.find((r: any) => r.month === thisMonth);
    expect(m).toMatchObject({ output_vat: 1400, output_base: 20000, input_vat: 560, input_base: 8000, net: 840, result: 'ชำระเพิ่ม' });
    expect(vat.rows).toHaveLength(12);
    expect(vat.table.at(-1).net).toBe(840);
    const out = (await x.api('GET', '/reports/vat/lines?kind=output')).body;
    expect(out).toMatchObject({ title: 'รายงานภาษีขาย', totals: { base: 20000, vat: 1400, count: 1 } });
    expect(out.rows[0]).toMatchObject({ ref: 'INV-2569-0001', partner_name: 'บริษัท ลูกค้าดี จำกัด' });
    expect((await x.api('GET', '/reports/vat/lines?kind=input')).body.rows[0]).toMatchObject({ ref: 'TAX-778', tax_base: 8000, vat: 560 });

    const bank = await x.acc('11200');
    const gl = (await x.api('GET', `/reports/ledger?accountId=${bank}&from=${thisMonth}-01&to=${today}`)).body;
    const openingExpected = today.slice(0, 7) === `${today.slice(0, 4)}-01` ? 0 : 100000;
    expect(gl.opening).toBe(openingExpected);
    expect(gl.closing).toBe(100000 - 1500);
    expect(gl.rows[0]).toMatchObject({ kind: 'opening', description: 'ยอดยกมา' });
    expect(gl.rows.at(-1)).toMatchObject({ kind: 'closing', balance: 98500 });
    const all = (await x.api('GET', `/reports/ledger?from=${today.slice(0, 4)}-01-01`)).body;
    expect(all.totalDebit).toBe(all.totalCredit);
    expect((await x.api('GET', '/reports/ledger?from=2026-02-01&to=2026-01-01')).status).toBe(400);

    const s = (await x.api('GET', '/summary')).body;
    expect(s).toMatchObject({ revenueMonth: 20000, expenseMonth: 7500, netMonth: 12500, arBalance: 21400, apBalance: 8560, cashBalance: 98500, vatPayable: 840, drafts: 1, postingErrors: 0 });
    expect(s.months).toHaveLength(6);
    expect(s.months.at(-1)).toMatchObject({ month: thisMonth, revenue: 20000, expense: 7500, net: 12500 });
    expect(s.rows[0].link).toMatch(/^\/m\/accounting\/jvDetail\//);
  });
});

describe('security', () => {
  it('enforces permissions', async () => {
    const reader = t.token(['accounting.journal.read']);
    const writer = t.token(['accounting.journal.read', 'accounting.journal.write']);
    expect((await t.api('POST', '/journals', { description: 'x', lines: [] }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/accounts', { code: '9', name: 'x', type: 'asset' }, { token: writer })).status).toBe(403);
    expect((await t.api('GET', '/reports/trial-balance', undefined, { token: reader })).status).toBe(403);
    expect((await t.api('GET', '/summary', undefined, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/periods/2025-05/close', undefined, { token: writer })).status).toBe(403);
    const acc = (await t.api('GET', '/accounts?q=11100', undefined, { token: reader })).body[0];
    const bank = (await t.api('GET', '/accounts?q=11200', undefined, { token: reader })).body[0];
    const body = { description: 'x', lines: [{ accountId: acc.id, debit: 1 }, { accountId: bank.id, credit: 1 }] };
    expect((await t.api('POST', '/journals', { ...body, post: true }, { token: writer })).status).toBe(403);
    const draft = await t.api('POST', '/journals', body, { token: writer });
    expect(draft.status).toBe(201);
    expect((await t.api('POST', `/journals/${draft.body.id}/post`, undefined, { token: writer })).status).toBe(403);
    expect((await t.api('GET', '/journals')).status).toBe(200);
    expect((await t.api('GET', '/journals', undefined, { token: 'nope' })).status).toBe(401);
  });

  it('isolates tenants (chart, journals, rules, errors, periods)', async () => {
    const a = tenant();
    const b = tenant();
    await a.jv([['11100', 10, 0], ['31000', 0, 10]], { post: true });
    await a.deliver('sales.invoiced', invoice());
    await a.api('POST', '/periods/2024-03/close');
    expect(await a.journals()).toHaveLength(2);
    expect(await b.journals()).toHaveLength(0);
    expect((await b.api('GET', '/periods?year=2024')).body[2].status).toBe('open');
    const aAcc = await a.acc('11100');
    expect(await b.acc('11100')).not.toBe(aAcc);
    expect((await b.api('GET', `/accounts/${aAcc}`)).status).toBe(404);
    expect((await b.api('GET', `/journals/${(await a.journals())[0].id}`)).status).toBe(404);
    expect((await b.api('GET', '/reports/trial-balance')).body.rows).toHaveLength(0);
    // b cannot post to a's account
    expect((await b.api('POST', '/journals', { description: 'x', lines: [{ accountId: aAcc, debit: 1 }, { accountId: await b.acc('31000'), credit: 1 }] })).status).toBe(400);
    const ruleA = (await a.api('GET', '/posting-rules')).body[0];
    expect((await b.api('PUT', `/posting-rules/${ruleA.id}`, { accountId: null })).status).toBe(404);
    expect((await t.api('GET', '/journals', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toHaveLength(0);
  });
});

describe('QA regressions (bugs-0.4)', () => {
  it('ACC-01: a receipt is posted on its own date (cash, WHT, AR land in the receipt month), not on the day it was keyed', async () => {
    const x = tenant();
    const inv = invoice({ invoiceNo: 'INV-2569-0101', net: 100000, vat: 7000, gross: 107000, issueDate: '2024-05-05' });
    await x.deliver('sales.invoiced', inv);
    await x.deliver('sales.payment_received', {
      receiptId: randomUUID(), receiptNo: 'RC-2567-0101', receiptDate: '2024-05-31', kind: 'payment', customerId: inv.customerId, customerName: inv.customerName,
      method: 'transfer', total: 107000, whtAmount: 3000, depositApplied: 0, received: 104000,
      invoices: [{ invoiceId: inv.invoiceId, invoiceNo: inv.invoiceNo, amount: 107000, outstanding: 0 }],
    });
    const [rc] = await x.journals('sales.payment_received');
    expect(rc.entry_date).toBe('2024-05-31');
    // as of the receipt date the customer owes nothing and the 50 ทวิ to chase belongs to May
    const tb = (await x.api('GET', '/reports/trial-balance?asOf=2024-05-31')).body;
    expect(tb.totals.difference).toBe(0);
    expect(tb.rows.find((r: any) => r.code === '11300')).toMatchObject({ debit: 0, credit: 0, debit_total: 107000, credit_total: 107000 });
    expect(tb.rows.find((r: any) => r.code === '11600')).toMatchObject({ debit: 3000 });
    const wht = (await x.api('GET', '/reports/wht-received?year=2024')).body;
    expect(wht.months).toEqual([expect.objectContaining({ month: '2024-05', amount: 3000 })]);
    // a receipt dated in a closed month is refused into posting errors (not silently moved to today's month)
    await x.api('POST', '/periods/2024-06/close');
    await x.deliver('sales.payment_received', {
      receiptId: randomUUID(), receiptNo: 'RC-2567-0102', receiptDate: '2024-06-10', kind: 'deposit', customerId: null, customerName: 'ลูกค้า ค',
      method: 'cash', total: 500, whtAmount: 0, depositApplied: 0, received: 500, invoices: [],
    });
    expect((await x.api('GET', '/posting-errors')).body).toEqual([expect.objectContaining({ source_no: 'RC-2567-0102' })]);
  });
});
