/** Wave 8 (round-2 #4): attendance and HR dates use the kernel business clock in Asia/Bangkok — a night-shift scan at 02:05 belongs to the Thai day. */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

describe('HR dates at 02:05 Bangkok', () => {
  it('a self check-in is recorded on the Thai day and a scan in the future is refused against the same clock', async () => {
    const tid = randomUUID();
    const admin = { token: t.token(['*'], tid) };
    const userId = randomUUID();
    const emp = (await t.api('POST', '/employees', { code: 'EMP-N01', firstName: 'กะดึก', startDate: '2026-01-01', userId }, admin)).body;
    setClock('2026-10-02T19:05:00Z');
    const me = { token: t.token(['hr.attendance.self'], tid, { userId, userName: 'กะดึก' }) };
    const r = await t.api('POST', '/attendance/check-in', {}, me);
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ work_date: '2026-10-03' });
    expect(r.body.message).toContain('02:05');
    const again = await t.api('POST', '/attendance/check-in', {}, me);
    expect(again.status).toBe(409);
    expect(again.body.error.message).toContain('วันนี้');
    // an admin back-dating a scan "today" at 03:00 is in the future at 02:05
    expect((await t.api('POST', `/employees/${emp.id}/check-out`, { date: '2026-10-03', time: '03:00' }, admin)).status).toBe(400);
  });

  it('resigning without a date uses the Thai day', async () => {
    const tid = randomUUID();
    const admin = { token: t.token(['*'], tid) };
    const emp = (await t.api('POST', '/employees', { code: 'EMP-N02', firstName: 'ลาออก', startDate: '2026-01-01' }, admin)).body;
    setClock('2026-10-31T18:00:00Z'); // 01:00 on 1 Nov
    const r = await t.api('POST', `/employees/${emp.id}/resign`, {}, admin);
    expect(r.status).toBe(200);
    expect(r.body.resigned_on).toBe('2026-11-01');
  });
});
