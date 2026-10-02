/** Wave 5: installments due for invoicing → contracts.installment_due (Sales drafts the service order). */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { parseEvent } from '@erp/contracts';
import { definition } from '../src/service.ts';
import { addDays, addMonths, todayBkk } from '../src/schedule.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const T = todayBkk();

function tenant() {
  const id = randomUUID();
  const token = t.token(['*'], id, { userId: randomUUID(), userName: 'ฝ่ายบัญชี' });
  const api = (m: string, url: string, body?: unknown, tok = token) => t.api(m, url, body, { token: tok });
  return { id, api };
}
const dueEvents = async (contractId: string) => (await t.published('contracts.installment_due')).map((e) => e.data).filter((d) => d.contractId === contractId);

async function activeContract(x: ReturnType<typeof tenant>, over: Record<string, unknown> = {}) {
  const c = (await x.api('POST', '/contracts', {
    customerId: randomUUID(), customerCode: 'CUS-01', customerName: 'บริษัท ลูกค้าเอ็มเอ จำกัด', title: 'MA เครือข่าย', startDate: T,
    endDate: addDays(addMonths(T, 12), -1), value: 120000, billingPlan: 'monthly', pmEveryMonths: 0, items: [], ...over,
  })).body;
  expect((await x.api('POST', `/contracts/${c.id}/activate`)).status).toBe(200);
  return c;
}

describe('POST /billing/due/notify', () => {
  it('sends each due installment once, with the billing period', async () => {
    const x = tenant();
    const c = await activeContract(x);
    const r = await x.api('POST', '/billing/due/notify', {});
    expect(r.status).toBe(200);
    expect(r.body.notified).toBe(1); // this month's installment only
    let evs = await dueEvents(c.id);
    expect(evs).toHaveLength(1);
    expect(() => parseEvent('contracts.installment_due', evs[0])).not.toThrow();
    expect(evs[0]).toMatchObject({ contractNo: c.no, title: 'MA เครือข่าย', customerCode: 'CUS-01', customerName: 'บริษัท ลูกค้าเอ็มเอ จำกัด', seq: 1, count: 12,
      dueDate: T, amount: 10000, billingPlan: 'monthly', periodFrom: T, periodTo: addDays(addMonths(T, 1), -1) });
    // daily-callable: nothing new; a look-ahead of 40 days takes the next one
    expect((await x.api('POST', '/billing/due/notify', {})).body.notified).toBe(0);
    expect((await x.api('POST', '/billing/due/notify', { days: 40 })).body.notified).toBeGreaterThanOrEqual(1);
    evs = await dueEvents(c.id);
    expect(evs.map((e) => e.seq).sort((a, b) => a - b).slice(0, 2)).toEqual([1, 2]);
    expect(new Set(evs.map((e) => e.installmentId)).size).toBe(evs.length);
  });

  it('skips invoiced installments and draft/cancelled contracts; one-time has no period', async () => {
    const x = tenant();
    const c = await activeContract(x, { billingPlan: 'one_time', value: 30000 });
    const inst = (await x.api('GET', `/billing?scope=all&contractId=${c.id}`)).body[0];
    await x.api('POST', `/installments/${inst.id}/bill`, { invoiceNo: 'INV-2569-0009' });
    expect((await x.api('POST', '/billing/due/notify', {})).body.notified).toBe(0);
    await x.api('POST', `/installments/${inst.id}/unbill`);
    expect((await x.api('POST', '/billing/due/notify', { contractId: c.id })).body.notified).toBe(1);
    expect((await dueEvents(c.id))[0]).toMatchObject({ seq: 1, count: 1, amount: 30000, billingPlan: 'one_time', periodFrom: null, periodTo: null });
    const draft = (await x.api('POST', '/contracts', { customerName: 'ร่าง', title: 'ร่าง', startDate: T, endDate: addMonths(T, 12), value: 1000, billingPlan: 'monthly', items: [] })).body;
    expect((await x.api('POST', '/billing/due/notify', { days: 366 })).body.installments.some((s: string) => s.startsWith(draft.no))).toBe(false);
  });

  it('needs contracts.billing.write and stays inside the tenant', async () => {
    const x = tenant();
    const c = await activeContract(x);
    expect((await x.api('POST', '/billing/due/notify', {}, t.token(['contracts.billing.read'], x.id))).status).toBe(403);
    const y = tenant();
    expect((await y.api('POST', '/billing/due/notify', { days: 366 })).body.notified).toBe(0);
    expect(await dueEvents(c.id)).toHaveLength(0);
  });
});
