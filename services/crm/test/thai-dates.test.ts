/** Wave 8 (round-2 #4): quotation dates are the Thai calendar day — at 02:00 Bangkok the database's UTC current_date is yesterday. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

const quote = { customerName: 'บริษัท ลูกค้ากลางคืน จำกัด', lines: [{ description: 'งานติดตั้ง', qty: 1, unitPrice: 1000 }] };

describe('quotation dates at 02:00 Bangkok', () => {
  it('issue date = Thai today, valid until = +30 days; a revision is re-issued today', async () => {
    setClock('2026-10-02T19:00:00Z');
    const q = (await t.api('POST', '/quotations', quote)).body;
    expect(q).toMatchObject({ issue_date: '2026-10-03', valid_until: '2026-11-02' });
    await t.api('POST', `/quotations/${q.id}/send`);
    await t.api('POST', `/quotations/${q.id}/reject`, { reason: 'ราคาสูง' });
    setClock('2026-10-09T18:30:00Z'); // 01:30 on 10 Oct
    const rev = (await t.api('POST', `/quotations/${q.id}/revise`)).body;
    expect(rev).toMatchObject({ issue_date: '2026-10-10', valid_until: '2026-11-09' });
  });

  it('validity is judged on the Thai day: valid until 2 Oct is past at 02:00 on 3 Oct', async () => {
    const q = (await t.api('POST', '/quotations', { ...quote, issueDate: '2026-09-25', validUntil: '2026-10-02' })).body;
    await t.api('POST', `/quotations/${q.id}/send`);
    setClock('2026-10-02T19:00:00Z');
    expect((await t.api('GET', '/quotations?status=sent')).body.find((x: any) => x.id === q.id).past_validity).toBe(true);
    expect((await t.api('POST', `/quotations/${q.id}/accept`)).status).toBe(409);
    expect((await t.api('POST', '/quotations/expire-due')).body.expired.map((x: any) => x.id)).toContain(q.id);
  });
});
