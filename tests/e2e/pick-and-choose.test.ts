import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as sales } from '@erp/svc-sales';
import { definition as maintenance } from '@erp/svc-maintenance';
import { createGateway } from '@erp/gateway';
import { install, type Installation } from './helpers.ts';

/** A customer who bought only Sales + Maintenance (no Inventory): everything still works on its own. */
let erp: Installation;
let token: string;
beforeAll(async () => {
  erp = await install([identity, masterData, sales, maintenance]);
  ({ token } = await erp.provision('small-co'));
});
afterAll(async () => { await erp?.close(); });

describe('partial installation (Core + Sales + Maintenance)', () => {
  it('exposes only purchased modules', async () => {
    const cat = await erp.call('GET', '/api/_catalog');
    expect(cat.body.modules.map((m: any) => m.id).sort()).toEqual(['identity', 'maintenance', 'master-data', 'sales']);
    const missing = await erp.call('GET', '/api/inventory/balances', undefined, token);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe('module_not_installed');
  });

  it('sells and delivers without inventory; events with no subscriber are simply recorded', async () => {
    const item = (await erp.call('POST', '/api/master-data/items', { code: 'FG-1', name: 'สินค้า', type: 'finished' }, token)).body;
    const so = (await erp.call('POST', '/api/sales/orders', { customerName: 'ลูกค้า', lines: [{ itemId: item.id, itemCode: 'FG-1', qty: 2, unitPrice: 100 }] }, token)).body;
    await erp.call('POST', `/api/sales/orders/${so.id}/confirm`, undefined, token);
    expect((await erp.call('POST', `/api/sales/orders/${so.id}/deliver`, undefined, token)).body.status).toBe('delivered');
    await erp.settle(); // no failures even though nobody subscribes
    const pending = await erp.services.sales.db.pool.query('select count(*)::int as n from _outbox where sent_at is null');
    expect(pending.rows[0].n).toBe(0);
  });

  it('completes a repair with parts even though stock is not tracked', async () => {
    const m = (await erp.call('POST', '/api/maintenance/machines', { code: 'M-1', name: 'Lathe' }, token)).body;
    const wo = (await erp.call('POST', '/api/maintenance/work-orders', { machineId: m.id, title: 'เสียงดัง' }, token)).body;
    const done = await erp.call('POST', `/api/maintenance/work-orders/${wo.id}/complete`, { resolution: 'ok', parts: [{ itemId: m.id, itemCode: 'SP-X', qty: 1 }] }, token);
    expect(done.body.status).toBe('done');
    await erp.settle();
  });

  it('refuses an installation whose required modules are missing', async () => {
    const salesPort = (erp.services.sales.app.server.address() as { port: number }).port;
    const gw = createGateway({ modules: { sales: `http://127.0.0.1:${salesPort}` }, internalToken: 'x' });
    await expect(gw.discover()).rejects.toThrow(/sales requires identity, which is not installed/);
  });
});
