import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const partnerId = randomUUID();
const confirmed = (extra: Record<string, unknown> = {}) => ({
  estimateId: randomUUID(), no: 'EST-2569-0007', jobName: 'โบรชัวร์สินค้า A4', customerName: 'บริษัท ชลบุรีพลาสติก จำกัด',
  partnerId, customerTaxId: '0105536000313', customerBranch: '00000', customerAddress: 'ชลบุรี',
  description: 'โบรชัวร์สินค้า A4 · ขนาด 8.27 × 11.69 นิ้ว · พิมพ์ 4/4 สี · กระดาษ อาร์ตมัน 120 แกรม · เคลือบ PVC ด้าน',
  qty: 5000, unitPrice: 5.09, price: 25450,
  ...extra,
});

describe('crm ← estimating.estimate_confirmed', () => {
  it('drafts a quotation with the estimated quantity and unit price', async () => {
    const e = confirmed();
    expect((await t.deliver('estimating.estimate_confirmed', e)).body.status).toBe('handled');
    const list = (await t.api('GET', '/quotations?q=ชลบุรีพลาสติก')).body;
    expect(list).toHaveLength(1);
    const q = (await t.api('GET', `/quotations/${list[0].id}`)).body;
    // 5,000 × 5.09 = 25,450 → VAT 1,781.50 → 27,231.50
    expect(q).toMatchObject({
      status: 'draft', estimate_id: e.estimateId, partner_id: partnerId, customer_name: 'บริษัท ชลบุรีพลาสติก จำกัด', customer_tax_id: '0105536000313',
      customer_branch: '00000', customer_address: 'ชลบุรี', vat_mode: 'exclusive', subtotal: 25450, discount: 0, net: 25450, vat: 1781.5, gross: 27231.5,
      revision: 0, created_by: null,
    });
    expect(q.no).toMatch(/^QT-25\d\d-0001$/);
    expect(q.note).toBe('สร้างจากใบประเมินราคา EST-2569-0007 (โบรชัวร์สินค้า A4)');
    expect(q.lines).toMatchObject([{ line_no: 1, item_id: null, description: e.description, qty: 5000, unit_price: 5.09, discount_pct: 0, amount: 25450 }]);
    // an ordinary draft from here on: sales can send it and the customer can accept it
    expect((await t.api('POST', `/quotations/${q.id}/send`)).body.status).toBe('sent');
    expect((await t.api('POST', `/quotations/${q.id}/accept`)).body.status).toBe('accepted');
  });

  it('is idempotent by estimate id (redelivery with a new event id creates nothing)', async () => {
    const e = confirmed({ no: 'EST-2569-0008', customerName: 'หจก. รุ่งเรืองตู้ไฟฟ้า' });
    await t.deliver('estimating.estimate_confirmed', e);
    expect((await t.deliver('estimating.estimate_confirmed', e)).body.status).toBe('handled');
    expect((await t.api('GET', '/quotations?q=รุ่งเรือง')).body).toHaveLength(1);
    const id = randomUUID();
    await t.deliver('estimating.estimate_confirmed', confirmed({ customerName: 'ร้าน ช.ช่างเหล็ก' }), { id });
    expect((await t.deliver('estimating.estimate_confirmed', confirmed({ customerName: 'ร้าน ช.ช่างเหล็ก' }), { id })).body.status).toBe('duplicate');
    expect((await t.api('GET', '/quotations?q=ช.ช่างเหล็ก')).body).toHaveLength(1);
  });

  it('a revision of the drafted quotation does not claim the estimate again', async () => {
    const e = confirmed({ no: 'EST-2569-0009', customerName: 'บริษัท กรีนเทค อินดัสทรี จำกัด' });
    await t.deliver('estimating.estimate_confirmed', e);
    const q = (await t.api('GET', '/quotations?q=กรีนเทค')).body[0];
    await t.api('POST', `/quotations/${q.id}/send`);
    const rev = await t.api('POST', `/quotations/${q.id}/revise`);
    expect(rev.status).toBe(201);
    expect(rev.body).toMatchObject({ estimate_id: null, revision: 1, gross: 27231.5 });
  });

  it('works without a customer record and stays inside the tenant', async () => {
    const e = confirmed({ no: 'EST-2569-0010', customerName: 'คุณสมหญิง (ลูกค้าหน้าร้าน)', partnerId: null, customerTaxId: null, customerBranch: null, customerAddress: null, qty: 300, unitPrice: 12.5, price: 3750 });
    await t.deliver('estimating.estimate_confirmed', e, { tenantId: t.otherTenantId });
    expect((await t.api('GET', '/quotations?q=สมหญิง')).body).toHaveLength(0);
    const theirs = (await t.api('GET', '/quotations?q=สมหญิง', undefined, { token: t.token(['*'], t.otherTenantId) })).body;
    expect(theirs).toMatchObject([{ customer_name: 'คุณสมหญิง (ลูกค้าหน้าร้าน)', partner_id: null, net: 3750, gross: 4012.5 }]);
  });
});
