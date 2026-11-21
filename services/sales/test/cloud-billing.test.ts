/** identity.subscription_paid (GO Along back office) → a draft service order in the operator company for the tax invoice. */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const paid = (over: Record<string, unknown> = {}) => ({
  paymentId: randomUUID(), tenantCode: 'siamparts', companyName: 'บริษัท สยามพาร์ท จำกัด', taxId: '0105536000313', branch: 'สำนักงานใหญ่',
  address: '1 ถนนบางนา-ตราด กรุงเทพฯ', email: 'acc@siamparts.co.th', plan: 'factory', planName: 'Factory', months: 3, amount: 10470,
  paidOn: '2026-11-20', periodFrom: '2026-11-20', periodTo: '2027-02-19', ref: 'KBANK-123', ...over,
});

describe('sales ← identity.subscription_paid', () => {
  it('drafts one order per payment with the buyer tax details and the exact amount', async () => {
    const tenantId = randomUUID();
    const token = t.token(['*'], tenantId);
    const e = paid();
    parseEvent('identity.subscription_paid', e);
    expect((await t.deliver('identity.subscription_paid', e, { tenantId })).body.status).toBe('handled');
    await t.deliver('identity.subscription_paid', e, { tenantId }); // re-sent with a new event id: still one order
    const list = (await t.api('GET', '/orders?q=CLOUD', undefined, { token })).body;
    expect(list).toHaveLength(1);
    const o = (await t.api('GET', `/orders/${list[0].id}`, undefined, { token })).body;
    expect(o).toMatchObject({
      status: 'draft', customer_name: 'บริษัท สยามพาร์ท จำกัด', customer_tax_id: '0105536000313', customer_branch: 'สำนักงานใหญ่',
      customer_address: '1 ถนนบางนา-ตราด กรุงเทพฯ', customer_email: 'acc@siamparts.co.th', vat_mode: 'exclusive', net: 10470, vat: 732.9, gross: 11202.9,
    });
    expect(o.lines[0].description).toContain('Factory OS Cloud แพ็กเกจ Factory 3 เดือน');
    expect(o.note).toContain('KBANK-123');
    expect((await t.api('POST', `/orders/${o.id}/confirm`, undefined, { token })).status).toBe(200);
  });

  it('notes a missing tax ID so staff ask the customer before invoicing', async () => {
    const tenantId = randomUUID();
    await t.deliver('identity.subscription_paid', paid({ taxId: null, branch: null, tenantCode: 'notax' }), { tenantId });
    const list = (await t.api('GET', '/orders?q=notax', undefined, { token: t.token(['*'], tenantId) })).body;
    const o = (await t.api('GET', `/orders/${list[0].id}`, undefined, { token: t.token(['*'], tenantId) })).body;
    expect(o.note).toContain('ยังไม่ได้กรอกเลขผู้เสียภาษี');
  });
});
