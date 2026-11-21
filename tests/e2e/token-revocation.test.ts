import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as sales } from '@erp/svc-sales';
import { adminEmail, install, type Installation } from './helpers.ts';

/** Security review 0.3 SEC-07: a logout / password change in identity reaches every module through the gateway's event router. */
let erp: Installation;
let tenantCode: string;
beforeAll(async () => {
  erp = await install([identity, masterData, sales]);
  tenantCode = 'revoke-co';
  await erp.provision(tenantCode);
});
afterAll(async () => { await erp?.close(); });

const login = async () => (await erp.call('POST', '/api/identity/auth/login', { email: adminEmail(tenantCode), password: 'password123' })).body.token as string;

describe('token revocation across modules (through the gateway)', () => {
  it('logout everywhere: identity refuses at once, every other module once the event is delivered; a new login works', async () => {
    const token = await login();
    expect((await erp.call('GET', '/api/sales/orders', undefined, token)).status).toBe(200);
    expect((await erp.call('POST', '/api/identity/logout', undefined, token)).status).toBe(200);
    expect((await erp.call('GET', '/api/identity/me', undefined, token)).status).toBe(401);
    await erp.settle(); // the outbox dispatcher's job (~1 s in production)
    for (const path of ['/api/sales/orders', '/api/master-data/items']) {
      const r = await erp.call('GET', path, undefined, token);
      expect(r.status).toBe(401);
      expect(r.body.error.code).toBe('session_revoked');
    }
    const fresh = await login();
    expect((await erp.call('GET', '/api/sales/orders', undefined, fresh)).status).toBe(200);
    expect((await erp.call('GET', '/api/master-data/items', undefined, fresh)).status).toBe(200);
  });

  it('password change hands the new token through the gateway (x-erp-session-token) and the old one dies everywhere', async () => {
    const token = await login();
    const res = await fetch(`${erp.url}/api/identity/me/password`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ currentPassword: 'password123', newPassword: 'password456' }),
    });
    expect(res.status).toBe(200);
    const rotated = res.headers.get('x-erp-session-token');
    expect(rotated).toBeTruthy();
    await erp.settle();
    expect((await erp.call('GET', '/api/sales/orders', undefined, token)).status).toBe(401);
    expect((await erp.call('GET', '/api/sales/orders', undefined, rotated!)).status).toBe(200);
    // put the password back for other tests
    const back = await erp.call('POST', '/api/identity/me/password', { currentPassword: 'password456', newPassword: 'password123' }, rotated!);
    expect(back.status).toBe(200);
  });
});
