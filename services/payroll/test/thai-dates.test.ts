/** Wave 8 (round-2 #4): a run paid at 02:00 Bangkok is paid "today" in Thailand, not on the database's UTC day. */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

describe('payroll paid date at 02:00 Bangkok', () => {
  it('defaults paidDate to the Thai day and carries it on payroll.run_paid', async () => {
    const tid = randomUUID();
    const owner = { token: t.token(['payroll.*'], tid, { userName: 'เจ้าของ' }) };
    await t.api('POST', '/profiles', { employeeCode: 'EMP-N1', employeeName: 'กะดึก ทดสอบ', baseSalary: 15000, startDate: '2020-01-01' }, owner);
    const run = (await t.api('POST', '/runs', { period: '2026-09', payDate: '2026-09-30' }, owner)).body;
    expect((await t.api('POST', `/runs/${run.id}/calculate`, undefined, owner)).status).toBe(200);
    expect((await t.api('POST', `/runs/${run.id}/approve`, {}, owner)).status).toBe(200);
    setClock('2026-09-30T19:30:00Z'); // 02:30 on 1 Oct in Bangkok — UTC still says 30 Sep
    const paid = await t.api('POST', `/runs/${run.id}/pay`, {}, owner);
    expect(paid.status).toBe(200);
    expect((await t.published('payroll.run_paid')).find((e) => e.data.runId === run.id)!.data.paidDate).toBe('2026-10-01');
  });
});
