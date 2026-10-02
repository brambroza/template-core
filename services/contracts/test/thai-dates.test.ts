/** Wave 8 (round-2 #4): contract business dates follow the kernel clock in Asia/Bangkok (02:00 Thai time is still "yesterday" in UTC). */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';
import { todayBkk } from '../src/schedule.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

describe('contracts at 02:00 Bangkok', () => {
  it('billing an installment without a date records the Thai day; days_left counts from the Thai day', async () => {
    setClock('2026-10-31T19:00:00Z'); // 02:00 on 1 Nov in Bangkok; UTC is still 31 Oct
    expect(todayBkk()).toBe('2026-11-01');
    const token = t.token(['*'], randomUUID(), { userName: 'ฝ่ายบัญชี' });
    const api = (m: string, url: string, body?: unknown) => t.api(m, url, body, { token });
    const c = (await api('POST', '/contracts', {
      customerId: randomUUID(), customerCode: 'CUS-01', customerName: 'ลูกค้ากลางคืน', title: 'MA', startDate: '2026-11-01', endDate: '2026-11-30',
      value: 12000, billingPlan: 'one_time', pmEveryMonths: 0, items: [],
    })).body;
    expect((await api('POST', `/contracts/${c.id}/activate`)).status).toBe(200); // starts "today" in Thailand — not "in the future"
    const detail = (await api('GET', `/contracts/${c.id}`)).body;
    expect(detail.days_left).toBe(29);
    const inst = detail.installments[0];
    const billed = (await api('POST', `/installments/${inst.id}/bill`, { invoiceNo: 'INV-2569-0100' })).body;
    expect(billed.invoiced_on).toBe('2026-11-01');
  });
});
