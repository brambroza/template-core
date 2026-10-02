/** Wave 8 (round-2 #4): delegations are judged on the Thai day of the kernel clock, not the database's UTC day. */
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { setClock } from '@erp/kernel';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });
afterEach(() => setClock(null));

describe('delegation dates at 02:00 Bangkok', () => {
  it('a delegation ending "yesterday in UTC" has already ended in Thailand; one starting today is in force now', async () => {
    const tenantId = randomUUID();
    const boss = { id: randomUUID(), token: '' };
    boss.token = t.token(['approvals.request.read', 'approvals.request.write', 'approvals.request.approve'], tenantId, { userId: boss.id, userName: 'หัวหน้า' });
    const deputy = randomUUID();
    setClock('2026-10-02T19:00:00Z'); // 02:00 on 3 Oct in Bangkok
    const ended = await t.api('POST', '/delegations', { toUserId: deputy, toUserName: 'รองหัวหน้า', startsOn: '2026-10-01', endsOn: '2026-10-02' }, { token: boss.token });
    expect(ended.status).toBe(400);
    const ok = await t.api('POST', '/delegations', { toUserId: deputy, toUserName: 'รองหัวหน้า', startsOn: '2026-10-03', endsOn: '2026-10-03' }, { token: boss.token });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('active');
  });
});
