import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { auth, inPlan, signToken, verifyToken, type ServiceDefinition } from '../src/index.ts';
import { bootTestService, type TestService } from '../src/testing.ts';

/** Cloud plans: the token lists the company's feature modules (`mods`); a module outside the plan answers a Thai 403. */
const def: ServiceDefinition = {
  manifest: {
    id: 'notes', name: 'Notes', nameTh: 'โน้ต', version: '0.0.1', tier: 'feature', description: 'fixture',
    requires: [], enhancedBy: [], publishes: [], subscribes: [], permissions: [],
  },
  migrationsDir: fileURLToPath(new URL('./fixture/migrations', import.meta.url)),
  routes(app) {
    app.get('/ping', async (req) => ({ tenant: auth(req).tenantId }));
  },
};

let t: TestService;
beforeAll(async () => { t = await bootTestService(def); });
afterAll(async () => { await t?.close(); });

describe('plan modules in the token', () => {
  it('round-trips the module list; tokens without it have no plan limit', () => {
    const secret = 'x'.repeat(40);
    const withPlan = verifyToken(secret, signToken(secret, { tenantId: 't', userId: 'u', perms: [], modules: ['sales', 'inventory'] }));
    expect(withPlan.modules).toEqual(['sales', 'inventory']);
    expect(verifyToken(secret, signToken(secret, { tenantId: 't', userId: 'u', perms: [] })).modules).toBeUndefined();
  });

  it('core modules are always open, feature modules only when listed', () => {
    expect(inPlan({ modules: [] }, 'identity', 'core')).toBe(true);
    expect(inPlan({ modules: ['sales'] }, 'sales', 'feature')).toBe(true);
    expect(inPlan({ modules: ['sales'] }, 'inventory', 'feature')).toBe(false);
    expect(inPlan({}, 'inventory', 'feature')).toBe(true);
  });

  it('a module refuses a company whose plan does not include it', async () => {
    expect((await t.api('GET', '/ping')).status).toBe(200);
    expect((await t.api('GET', '/ping', undefined, { token: t.token(['*'], t.tenantId, { modules: ['notes', 'sales'] }) })).status).toBe(200);
    const res = await t.api('GET', '/ping', undefined, { token: t.token(['*'], t.tenantId, { modules: ['sales'] }) });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatchObject({ code: 'module_not_in_plan', message: 'แพ็กเกจของบริษัทไม่รวม "โน้ต" — อัปเกรดแพ็กเกจเพื่อใช้งานส่วนนี้' });
  });

  it('health and manifest stay public', async () => {
    expect((await t.svc.app.inject({ method: 'GET', url: '/_health' })).statusCode).toBe(200);
  });
});
