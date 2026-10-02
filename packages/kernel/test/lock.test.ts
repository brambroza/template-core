import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, guardLockDate, setClock, TODAY_SQL, lockThroughPeriod, parse, periodLastDate, readLock, setLockDate, unlockPeriod, z, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, type TestService } from '../src/testing.ts';

const def: ServiceDefinition = {
  manifest: {
    id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '0.0.1', tier: 'feature', description: 'fixture',
    requires: [], enhancedBy: [], publishes: [], subscribes: [], permissions: [],
  },
  migrationsDir: fileURLToPath(new URL('./fixture/migrations', import.meta.url)),
  routes(app, k) {
    app.post('/doc', async (req) => {
      const a = auth(req);
      const b = parse(z.object({ date: z.string(), lockOverrideReason: z.string().optional() }), req.body);
      return k.db.tx(a.tenantId, async (c) => (await guardLockDate(c, a, { module: 'notes', date: b.date, what: 'โน้ต', overrideReason: b.lockOverrideReason })).overridden);
    });
    app.get('/tz', async (req) => k.db.tx(auth(req).tenantId, async (c) => (await c.query(`select current_setting('TimeZone') as tz, ${TODAY_SQL}::text as today`)).rows[0]));
    app.post('/lock/:op', async (req) => {
      const a = auth(req);
      const { op } = req.params as { op: string };
      const b = req.body as { value: string | null };
      return k.db.tx(a.tenantId, async (c) => {
        if (op === 'set') return setLockDate(c, b.value, 'คุณบัญชี');
        if (op === 'close') return lockThroughPeriod(c, b.value!);
        if (op === 'reopen') return unlockPeriod(c, b.value!);
        return readLock(c);
      });
    });
  },
};

let t: TestService;
beforeAll(async () => { t = await bootTestService(def); });
afterAll(async () => { await t?.close(); });

describe('lock date', () => {
  it('periodLastDate', () => {
    expect(periodLastDate('2026-09')).toBe('2026-09-30');
    expect(periodLastDate('2028-02')).toBe('2028-02-29');
    expect(() => periodLastDate('2026-13')).toThrow();
  });

  it('no lock → anything goes; a closed period refuses documents on/before its last day (Thai 409)', async () => {
    expect((await t.api('POST', '/doc', { date: '2020-01-01' })).body).toBe(false);
    expect((await t.api('POST', '/lock/close', { value: '2026-09' })).body).toMatchObject({ lockDate: '2026-09-30', lockDateTh: '30 กันยายน 2569', source: 'accounting', period: '2026-09' });
    const r = await t.api('POST', '/doc', { date: '2026-09-30' }, { token: t.token(['notes.*']) });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toContain('30 กันยายน 2569 ปิดแล้ว');
    expect((await t.api('POST', '/doc', { date: '2026-10-01' }, { token: t.token(['notes.*']) })).body).toBe(false);
  });

  it('override needs <module>.lock.override and a reason', async () => {
    const boss = t.token(['notes.lock.override']);
    expect((await t.api('POST', '/doc', { date: '2026-09-20' }, { token: boss })).body.error.message).toContain('lockOverrideReason');
    expect((await t.api('POST', '/doc', { date: '2026-09-20', lockOverrideReason: 'ลูกค้าขอแก้ใบกำกับเดือนก่อน' }, { token: boss })).body).toBe(true);
    expect((await t.api('POST', '/doc', { date: '2026-09-20', lockOverrideReason: 'ลูกค้าขอแก้' }, { token: t.token(['notes.doc.write']) })).status).toBe(409);
  });

  it('closing an older period never moves the lock back; reopening steps back only an accounting lock', async () => {
    expect((await t.api('POST', '/lock/close', { value: '2026-08' })).body.lockDate).toBe('2026-09-30');
    expect((await t.api('POST', '/lock/reopen', { value: '2026-09' })).body).toMatchObject({ lockDate: '2026-08-31', period: '2026-08' });
    expect((await t.api('POST', '/lock/reopen', { value: '2026-10' })).body.lockDate).toBe('2026-08-31'); // not covered → unchanged
    expect((await t.api('POST', '/lock/set', { value: '2026-09-15' })).body).toMatchObject({ lockDate: '2026-09-15', source: 'manual', updatedByName: 'คุณบัญชี' });
    expect((await t.api('POST', '/lock/reopen', { value: '2026-09' })).body.lockDate).toBe('2026-09-15'); // manual lock stays
    expect((await t.api('POST', '/lock/set', { value: null })).body.lockDate).toBeNull();
  });

  it('tenant transactions run in Asia/Bangkok, so SQL current_date is the Thai day', async () => {
    setClock('2026-10-02T19:00:00Z'); // 02:00 on 3 Oct in Bangkok
    try {
      expect((await t.api('GET', '/tz')).body).toEqual({ tz: 'Asia/Bangkok', today: '2026-10-03' }); // TODAY_SQL follows the kernel clock
    } finally { setClock(null); }
  });

  it('is per tenant', async () => {
    await t.api('POST', '/lock/close', { value: '2026-09' });
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('POST', '/lock/read', {}, { token: other })).body.lockDate).toBeNull();
    expect((await t.api('POST', '/doc', { date: '2026-09-01' }, { token: other })).body).toBe(false);
  });
});
