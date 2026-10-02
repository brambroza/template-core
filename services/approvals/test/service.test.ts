import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

describe('approvals', () => {
  it('creates and lists records per tenant', async () => {
    expect((await t.api('POST', '/records', { code: 'R-1', name: 'First' })).status).toBe(201);
    expect((await t.api('GET', '/records')).body).toHaveLength(1);
    expect((await t.api('GET', '/records', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toHaveLength(0);
  });

  it('requires permissions', async () => {
    const reader = t.token(['approvals.record.read']);
    expect((await t.api('POST', '/records', { code: 'R-2', name: 'x' }, { token: reader })).status).toBe(403);
  });
});
