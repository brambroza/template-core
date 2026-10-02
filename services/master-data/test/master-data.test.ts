import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

describe('master-data', () => {
  it('creates, lists, filters and updates items and publishes upserts', async () => {
    const steel = await t.api('POST', '/items', { code: 'RM-STEEL', name: 'เหล็กแผ่น 2mm', type: 'raw', uom: 'kg' });
    expect(steel.status).toBe(201);
    await t.api('POST', '/items', { code: 'FG-BRACKET', name: 'ขายึด', type: 'finished', stdPrice: 45 });
    expect((await t.api('GET', '/items?type=raw')).body.map((i: any) => i.code)).toEqual(['RM-STEEL']);
    expect((await t.api('GET', '/items?q=ขา')).body.map((i: any) => i.code)).toEqual(['FG-BRACKET']);
    const upd = await t.api('PATCH', `/items/${steel.body.id}`, { name: 'เหล็กแผ่น 3mm' });
    expect(upd.body.name).toBe('เหล็กแผ่น 3mm');
    const events = await t.published('master.item_upserted');
    expect(events).toHaveLength(3);
    expect(events[2].data).toMatchObject({ itemId: steel.body.id, code: 'RM-STEEL', name: 'เหล็กแผ่น 3mm' });
  });

  it('rejects duplicate codes, bad types and invalid tax IDs', async () => {
    expect((await t.api('POST', '/items', { code: 'RM-STEEL', name: 'dup', type: 'raw' })).status).toBe(409);
    expect((await t.api('POST', '/items', { code: 'X', name: 'x', type: 'weird' })).status).toBe(400);
    expect((await t.api('POST', '/partners', { code: 'C1', name: 'ACME', kind: 'customer', taxId: '0105536000315' })).status).toBe(400);
    const ok = await t.api('POST', '/partners', { code: 'C1', name: 'ACME', kind: 'customer', taxId: '0105536000313' });
    expect(ok.status).toBe(201);
    expect(ok.body.branch).toBe('00000');
    expect((await t.published('master.partner_upserted'))[0].data.taxId).toBe('0105536000313');
  });

  it('enforces permissions and tenant isolation', async () => {
    const readOnly = t.token(['master.item.read']);
    expect((await t.api('GET', '/items', undefined, { token: readOnly })).status).toBe(200);
    expect((await t.api('POST', '/items', { code: 'Y', name: 'y', type: 'raw' }, { token: readOnly })).status).toBe(403);
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/items', undefined, { token: other })).body).toEqual([]);
    expect((await t.api('POST', '/items', { code: 'RM-STEEL', name: 'same code, other company', type: 'raw' }, { token: other })).status).toBe(201);
  });
});
