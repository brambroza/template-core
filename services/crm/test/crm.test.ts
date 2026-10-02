import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const year = new Date().getFullYear() + 543;
const customer = { partnerId: randomUUID(), customerName: 'บริษัท สยามพาร์ท จำกัด', customerTaxId: '0105551234567', customerBranch: '00000', customerAddress: 'บางพลี สมุทรปราการ' };
const item = { itemId: randomUUID(), itemCode: 'MOLD-01', itemName: 'แม่พิมพ์ฉีด' };

describe('crm leads', () => {
  let lead: any;

  it('creates a lead with a document number and owner defaulting to the creator', async () => {
    const r = await t.api('POST', '/leads', { company: 'บริษัท สยามพาร์ท จำกัด', contactName: 'คุณเอ', phone: '081-111-2222', lineId: '@siampart', source: 'expo', interest: 'แม่พิมพ์' });
    expect(r.status).toBe(201);
    lead = r.body;
    expect(lead).toMatchObject({ no: `LD-${year}-0001`, status: 'new', source: 'expo', source_label: 'งานแสดงสินค้า', activities: [] });
    expect(lead.owner_id).toBeTruthy();
  });

  it('validates input (400)', async () => {
    expect((await t.api('POST', '/leads', { company: '' })).status).toBe(400);
    expect((await t.api('POST', '/leads', { company: 'X', source: 'tv' })).status).toBe(400);
    expect((await t.api('POST', '/leads', { company: 'X', email: 'not-an-email' })).status).toBe(400);
  });

  it('searches and filters leads', async () => {
    await t.api('POST', '/leads', { company: 'ร้านช่างเอก', source: 'line' });
    expect((await t.api('GET', '/leads?q=สยาม')).body).toHaveLength(1);
    expect((await t.api('GET', '/leads?source=line')).body).toHaveLength(1);
    expect((await t.api('GET', '/leads?open=1')).body).toHaveLength(2);
    expect((await t.api('GET', '/leads?mine=1')).body).toHaveLength(2); // owner defaults to the creator
    expect((await t.api('GET', '/leads?mine=1', undefined, { token: t.token(['*']) })).body).toHaveLength(0);
  });

  it('moves through new → contacted → qualified, logs activities, rejects invalid moves (409)', async () => {
    expect((await t.api('POST', `/leads/${lead.id}/contact`)).body.status).toBe('contacted');
    expect((await t.api('POST', `/leads/${lead.id}/contact`)).status).toBe(409);
    const withAct = await t.api('POST', `/leads/${lead.id}/activities`, { type: 'call', subject: 'โทรนัดเข้าพบ', dueAt: '2020-01-01' });
    expect(withAct.status).toBe(201);
    expect(withAct.body.activities[0]).toMatchObject({ type: 'call', type_label: 'โทร', overdue: true, related_no: lead.no });
    expect((await t.api('POST', `/leads/${lead.id}/qualify`)).body.status).toBe('qualified');
    const edited = await t.api('PUT', `/leads/${lead.id}`, { company: 'บริษัท สยามพาร์ท จำกัด (มหาชน)', source: 'expo', interest: 'แม่พิมพ์ฉีด 2 ชุด' });
    expect(edited.body.company).toContain('มหาชน');
  });

  it('converts a lead into an opportunity linked to a customer', async () => {
    const r = await t.api('POST', `/leads/${lead.id}/convert`, { partnerId: customer.partnerId, customerName: customer.customerName, value: 500000, expectedClose: '2026-12-31' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ no: `OP-${year}-0001`, stage: 'prospect', probability: 10, value: 500000, weighted_value: 50000, partner_id: customer.partnerId, lead_id: lead.id });
    expect(r.body.name).toContain('แม่พิมพ์ฉีด 2 ชุด');
    expect(r.body.activities).toHaveLength(1); // open follow-up moved with the deal
    const after = (await t.api('GET', `/leads/${lead.id}`)).body;
    expect(after).toMatchObject({ status: 'converted', opportunity_id: r.body.id });
    expect((await t.api('POST', `/leads/${lead.id}/convert`, {})).status).toBe(409);
    expect((await t.api('PUT', `/leads/${lead.id}`, { company: 'X' })).status).toBe(409);
  });

  it('loses a lead with a reason', async () => {
    const l = (await t.api('POST', '/leads', { company: 'ลีดทดสอบแพ้' })).body;
    expect((await t.api('POST', `/leads/${l.id}/lose`, {})).status).toBe(400);
    expect((await t.api('POST', `/leads/${l.id}/lose`, { reason: 'งบไม่พอ' })).body).toMatchObject({ status: 'lost', lost_reason: 'งบไม่พอ' });
    expect((await t.api('POST', `/leads/${l.id}/qualify`)).status).toBe(409);
  });
});

describe('crm opportunities and activities', () => {
  let opp: any;

  it('creates, advances and wins an opportunity', async () => {
    const r = await t.api('POST', '/opportunities', { name: 'ชิ้นงานกลึง 10,000 ชิ้น', customerName: 'บริษัท ไทยออโต้ จำกัด', value: 200000 });
    expect(r.status).toBe(201);
    opp = r.body;
    expect((await t.api('POST', `/opportunities/${opp.id}/advance`)).body).toMatchObject({ stage: 'proposal', probability: 40 });
    expect((await t.api('POST', `/opportunities/${opp.id}/advance`)).body).toMatchObject({ stage: 'negotiation', probability: 70, weighted_value: 140000 });
    expect((await t.api('POST', `/opportunities/${opp.id}/advance`)).status).toBe(409);
    const upd = await t.api('PUT', `/opportunities/${opp.id}`, { name: opp.name, customerName: 'บริษัท ไทยออโต้ จำกัด', value: 250000, probability: 90 });
    expect(upd.body).toMatchObject({ value: 250000, probability: 90, weighted_value: 225000 });
    expect((await t.api('POST', `/opportunities/${opp.id}/win`)).body).toMatchObject({ stage: 'won', probability: 100 });
    expect((await t.api('POST', `/opportunities/${opp.id}/lose`, { reason: 'x' })).status).toBe(409);
    expect((await t.api('PUT', `/opportunities/${opp.id}`, { name: 'x', customerName: 'x' })).status).toBe(409);
  });

  it('loses an opportunity with a reason', async () => {
    const o = (await t.api('POST', '/opportunities', { name: 'งานพ่นสี', customerName: 'ร้านสีทอง', value: 30000 })).body;
    expect((await t.api('POST', `/opportunities/${o.id}/lose`, { reason: 'คู่แข่งถูกกว่า' })).body).toMatchObject({ stage: 'lost', probability: 0, lost_reason: 'คู่แข่งถูกกว่า' });
  });

  it('tracks my open and overdue activities and marks them done', async () => {
    const me = randomUUID();
    const sales = t.token(['crm.lead.read', 'crm.activity.write']);
    const act = await t.api('POST', '/activities', { type: 'visit', subject: 'เยี่ยมโรงงานลูกค้า', dueAt: '2020-05-01', opportunityId: opp.id, ownerId: me, ownerName: 'สมชาย' }, { token: sales });
    expect(act.status).toBe(201);
    expect(act.body).toMatchObject({ type_label: 'เยี่ยมลูกค้า', related_no: opp.no, overdue: true, owner_name: 'สมชาย' });
    expect((await t.api('POST', '/activities', { type: 'call', subject: 'ไม่มีลิงก์' })).status).toBe(400);
    expect((await t.api('POST', '/activities', { type: 'call', subject: 'x', leadId: randomUUID() })).status).toBe(404);
    const logged = await t.api('POST', '/activities', { type: 'visit', subject: 'เยี่ยมแล้ว', opportunityId: opp.id, done: true });
    expect(logged.body).toMatchObject({ done: true, overdue: false });
    expect(logged.body.done_at).toBeTruthy();

    expect((await t.api('GET', '/activities?overdue=1')).body.map((a: any) => a.subject)).toEqual(expect.arrayContaining(['เยี่ยมโรงงานลูกค้า', 'โทรนัดเข้าพบ']));
    expect((await t.api('GET', `/activities?opportunityId=${opp.id}`)).body).toHaveLength(2);
    expect((await t.api('GET', '/activities?q=โรงงาน')).body).toHaveLength(1);
    // the creator's own list (owner defaults to the caller)
    const mineToken = t.token(['*']);
    const own = await t.api('POST', '/activities', { type: 'task', subject: 'ส่งแคตตาล็อก', opportunityId: opp.id }, { token: mineToken });
    const mine = await t.api('GET', '/activities/mine', undefined, { token: mineToken });
    expect(mine.body.map((a: any) => a.id)).toEqual([own.body.id]);

    expect((await t.api('POST', `/activities/${act.body.id}/done`, { note: 'ลูกค้าขอใบเสนอราคา' })).body).toMatchObject({ done: true, note: 'ลูกค้าขอใบเสนอราคา' });
    expect((await t.api('POST', `/activities/${act.body.id}/done`)).status).toBe(409);
  });
});

describe('crm quotations', () => {
  let opp: any;
  let quote: any;

  it('creates a quotation with discounts and Thai VAT', async () => {
    opp = (await t.api('POST', '/opportunities', { name: 'แม่พิมพ์รุ่นใหม่', customerName: customer.customerName, partnerId: customer.partnerId, value: 100000 })).body;
    const r = await t.api('POST', '/quotations', {
      ...customer, opportunityId: opp.id, issueDate: '2026-10-01', vatMode: 'exclusive', note: 'ยืนราคา 30 วัน',
      lines: [
        { ...item, qty: 2, unitPrice: 50000, discountPct: 10 },
        { description: 'ค่าออกแบบ', qty: 1, unitPrice: 10000 },
      ],
    });
    expect(r.status).toBe(201);
    quote = r.body;
    expect(quote).toMatchObject({
      no: 'QT-2569-0001', status: 'draft', valid_until: '2026-10-31', subtotal: 110000, discount: 10000, net: 100000, vat: 7000, gross: 107000,
      customer_tax_id: '0105551234567', opportunity_no: opp.no, gross_text: 'หนึ่งแสนเจ็ดพันบาทถ้วน',
    });
    expect(quote.lines.map((l: any) => l.amount)).toEqual([90000, 10000]);
  });

  it('handles VAT-inclusive prices', async () => {
    const r = await t.api('POST', '/quotations', { customerName: 'ลูกค้าเงินสด', vatMode: 'inclusive', lines: [{ description: 'บริการซ่อม', qty: 1, unitPrice: 1070 }] });
    expect(r.body).toMatchObject({ net: 1000, vat: 70, gross: 1070 });
  });

  it('validates quotations (400)', async () => {
    expect((await t.api('POST', '/quotations', { customerName: 'X', lines: [] })).status).toBe(400);
    expect((await t.api('POST', '/quotations', { customerName: 'X', lines: [{ qty: 1, unitPrice: 1 }] })).status).toBe(400); // no item, no description
    expect((await t.api('POST', '/quotations', { customerName: 'X', lines: [{ description: 'a', qty: 1, unitPrice: 1, discountPct: 120 }] })).status).toBe(400);
    expect((await t.api('POST', '/quotations', { customerName: 'X', opportunityId: randomUUID(), lines: [{ description: 'a', qty: 1, unitPrice: 1 }] })).status).toBe(404);
  });

  it('edits a draft, sends it (opportunity → proposal) and blocks edits after sending', async () => {
    const edited = await t.api('PUT', `/quotations/${quote.id}`, { ...customer, opportunityId: opp.id, lines: [{ ...item, qty: 1, unitPrice: 80000 }] });
    expect(edited.body).toMatchObject({ net: 80000, gross: 85600, lines: [{ line_no: 1, amount: 80000 }] });
    expect((await t.api('POST', `/quotations/${quote.id}/accept`)).status).toBe(409);
    expect((await t.api('POST', `/quotations/${quote.id}/send`)).body.status).toBe('sent');
    expect((await t.api('GET', `/opportunities/${opp.id}`)).body).toMatchObject({ stage: 'proposal', probability: 40, quotations: [{ no: quote.no, status: 'sent' }] });
    expect((await t.api('PUT', `/quotations/${quote.id}`, { ...customer, lines: [{ ...item, qty: 1, unitPrice: 1 }] })).status).toBe(409);
    expect((await t.api('POST', `/quotations/${quote.id}/send`)).status).toBe(409);
  });

  it('revises a rejected quotation into a new draft', async () => {
    expect((await t.api('POST', `/quotations/${quote.id}/reject`, { reason: 'แพงไป' })).body).toMatchObject({ status: 'rejected', reject_reason: 'แพงไป' });
    const rev = await t.api('POST', `/quotations/${quote.id}/revise`);
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({ no: `${quote.no}-R1`, status: 'draft', revision: 1, revision_of: quote.id, revision_of_no: quote.no, gross: 85600, lines: [{ item_code: 'MOLD-01' }] });
    expect((await t.api('POST', `/quotations/${quote.id}/revise`)).status).toBe(409);
    expect((await t.api('POST', `/quotations/${rev.body.id}/revise`)).status).toBe(409); // drafts are edited, not revised
    quote = rev.body;
  });

  it('accepting a quotation wins its opportunity at the quoted net value', async () => {
    await t.api('POST', `/quotations/${quote.id}/send`);
    const acc = await t.api('POST', `/quotations/${quote.id}/accept`);
    expect(acc.body.status).toBe('accepted');
    expect((await t.api('GET', `/opportunities/${opp.id}`)).body).toMatchObject({ stage: 'won', probability: 100, value: 80000 });
    expect((await t.api('POST', `/quotations/${quote.id}/reject`, { reason: 'x' })).status).toBe(409);
    expect((await t.api('POST', `/quotations/${quote.id}/expire`)).status).toBe(409);
  });

  it('expires sent quotations past their validity', async () => {
    const q = (await t.api('POST', '/quotations', { customerName: 'ลูกค้าเก่า', issueDate: '2026-01-01', validUntil: '2026-01-31', lines: [{ description: 'งาน', qty: 1, unitPrice: 100 }] })).body;
    await t.api('POST', `/quotations/${q.id}/send`);
    expect((await t.api('GET', '/quotations?status=sent')).body[0].past_validity).toBe(true);
    const r = await t.api('POST', '/quotations/expire-due', { asOf: '2026-02-01' });
    expect(r.body.expired.map((x: any) => x.no)).toEqual([q.no]);
    expect(r.body.message).toContain(q.no);
    expect((await t.api('POST', '/quotations/expire-due', {})).body.expired).toHaveLength(0);
    expect((await t.api('GET', `/quotations/${q.id}`)).body.status).toBe('expired');
    expect((await t.api('GET', '/quotations?q=ลูกค้าเก่า')).body).toHaveLength(1);
  });
});

describe('crm summary, permissions and tenants', () => {
  it('summarises the pipeline for the dashboard', async () => {
    const s = (await t.api('GET', '/summary')).body;
    expect(s.openLeads).toBe(1);
    expect(s.wonThisMonth).toBe(250000 + 80000);
    expect(s.winRate).toBeCloseTo(66.7, 1); // 2 won, 1 lost
    expect(s.months).toHaveLength(6);
    expect(s.months[5].total).toBe(330000);
    expect(s.pipelineValue).toBe(500000); // the converted lead's deal
    expect(s.weightedForecast).toBe(50000);
    expect(s.rows.map((r: any) => r.stage)).toEqual(['prospect']);
    expect(s.quotesSent).toBe(0);
  });

  it('enforces permissions (403)', async () => {
    const reader = t.token(['crm.lead.read', 'crm.quote.read']);
    expect((await t.api('POST', '/leads', { company: 'X' }, { token: reader })).status).toBe(403);
    expect((await t.api('POST', '/quotations', { customerName: 'X', lines: [{ description: 'a', qty: 1, unitPrice: 1 }] }, { token: reader })).status).toBe(403);
    const writer = t.token(['crm.quote.read', 'crm.quote.write']);
    const q = (await t.api('POST', '/quotations', { customerName: 'X', lines: [{ description: 'a', qty: 1, unitPrice: 1 }] }, { token: writer })).body;
    await t.api('POST', `/quotations/${q.id}/send`, undefined, { token: writer });
    expect((await t.api('POST', `/quotations/${q.id}/accept`, undefined, { token: writer })).status).toBe(403);
    expect((await t.api('GET', '/leads', undefined, { token: t.token(['crm.quote.read']) })).status).toBe(403);
    expect((await t.api('POST', '/activities', { type: 'call', subject: 'x', leadId: randomUUID() }, { token: reader })).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = t.token(['*'], t.otherTenantId);
    for (const path of ['/leads', '/opportunities', '/activities', '/quotations']) {
      expect((await t.api('GET', path, undefined, { token: other })).body).toHaveLength(0);
    }
    const anyQuote = (await t.api('GET', '/quotations')).body[0];
    expect((await t.api('GET', `/quotations/${anyQuote.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body).toMatchObject({ openLeads: 0, pipelineValue: 0, winRate: 0 });
    // numbering is per tenant
    expect((await t.api('POST', '/leads', { company: 'อีกบริษัท' }, { token: other })).body.no).toBe(`LD-${year}-0001`);
  });
});

describe('crm events (for Automation alerts)', () => {
  it('publishes lead_created and quotation_accepted through the outbox', async () => {
    const leads = (await t.published('crm.lead_created')).map((e) => e.data);
    expect(leads[0]).toMatchObject({ no: `LD-${year}-0001`, company: 'บริษัท สยามพาร์ท จำกัด', contactName: 'คุณเอ', source: 'expo' });
    const accepted = (await t.published('crm.quotation_accepted')).map((e) => e.data);
    expect(accepted).toHaveLength(1);
    const q = (await t.api('GET', `/quotations/${accepted[0].quotationId}`)).body;
    expect(q.status).toBe('accepted');
    expect(accepted[0]).toMatchObject({ quotationId: q.id, no: q.no, customerName: q.customer_name, total: q.gross });
    // wave 4: customer snapshot + lines so Sales can draft the sales order without retyping
    expect(accepted[0]).toMatchObject({
      partnerId: q.partner_id, customerTaxId: q.customer_tax_id, customerBranch: q.customer_branch, customerAddress: q.customer_address,
      vatMode: q.vat_mode, subtotal: q.subtotal, discount: q.discount, net: q.net, vat: q.vat,
    });
    expect(accepted[0].lines).toEqual(q.lines.map((l: any) => ({
      itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name, description: l.description,
      qty: l.qty, unitPrice: l.unit_price, discountPct: l.discount_pct, amount: l.amount,
    })));
    expect(accepted[0].lines.length).toBeGreaterThan(0);
    const before = leads.length;
    expect((await t.api('POST', '/leads', { company: '' })).status).toBe(400);
    expect((await t.published('crm.lead_created')).length).toBe(before);
  });
});

describe('crm — QA regressions (docs/uat/bugs-0.3.md)', () => {
  const lines = [{ description: 'เครื่องพิมพ์ฉลาก', qty: 2, unitPrice: 50000, discountPct: 10 }];

  it('CRM-01: once revised, the superseded quotation cannot be accepted as well', async () => {
    const opp = (await t.api('POST', '/opportunities', { name: 'เครื่องพิมพ์ฉลาก', customerName: 'บริษัท ทดสอบ จำกัด', value: 100000 })).body;
    const q = (await t.api('POST', '/quotations', { customerName: 'บริษัท ทดสอบ จำกัด', opportunityId: opp.id, lines })).body;
    await t.api('POST', `/quotations/${q.id}/send`);
    const rev = (await t.api('POST', `/quotations/${q.id}/revise`)).body;
    await t.api('POST', `/quotations/${rev.id}/send`);
    expect((await t.api('POST', `/quotations/${rev.id}/accept`)).body.status).toBe('accepted');
    const before = (await t.published('crm.quotation_accepted')).length;
    const old = await t.api('POST', `/quotations/${q.id}/accept`);
    expect(old.status).toBe(409);
    expect(old.body.error.message).toContain(`${q.no}-R1`);
    expect((await t.published('crm.quotation_accepted')).length).toBe(before);
  });

  it('CRM-02: a sent quotation past its validity cannot be accepted', async () => {
    const q = (await t.api('POST', '/quotations', { customerName: 'ลูกค้าช้า', issueDate: '2026-09-01', validUntil: '2026-09-15', lines })).body;
    await t.api('POST', `/quotations/${q.id}/send`);
    const r = await t.api('POST', `/quotations/${q.id}/accept`);
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('หมดอายุ');
    // the way forward: revise and send again
    const rev = (await t.api('POST', `/quotations/${q.id}/revise`)).body;
    await t.api('POST', `/quotations/${rev.id}/send`);
    expect((await t.api('POST', `/quotations/${rev.id}/accept`)).body.status).toBe('accepted');
  });

  it('CRM-03: valid-until before the issue date is refused on create and edit', async () => {
    const bad = await t.api('POST', '/quotations', { customerName: 'X', issueDate: '2026-10-02', validUntil: '2026-09-01', lines });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.fieldErrors.validUntil).toBeDefined();
    const q = (await t.api('POST', '/quotations', { customerName: 'X', issueDate: '2026-10-02', lines })).body;
    expect((await t.api('PUT', `/quotations/${q.id}`, { customerName: 'X', validUntil: '2026-10-01', lines })).status).toBe(400);
    expect((await t.api('PUT', `/quotations/${q.id}`, { customerName: 'X', validUntil: '2026-10-02', lines })).status).toBe(200);
  });
});
