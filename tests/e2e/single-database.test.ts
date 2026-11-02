import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { definition as identity } from '@erp/svc-identity';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import { definition as purchasing } from '@erp/svc-purchasing';
import { install, type Installation } from './helpers.ts';

const pg = createRequire(new URL('../../packages/kernel/package.json', import.meta.url))('pg');

/**
 * Managed Postgres with ONE database (Supabase, Neon, RDS…): each module gets its own schema and its own login role whose
 * search_path is that schema (docs/deploy-supabase.md). Same code, same migrations — and still no module can read another's tables.
 */
let erp: Installation;
let token: string;
const prev = process.env.E2E_SHARED_DB;
beforeAll(async () => {
  process.env.E2E_SHARED_DB = '1';
  erp = await install([identity, masterData, inventory, purchasing]);
  ({ token } = await erp.provision('one-db'));
});
afterAll(async () => { await erp?.close(); if (prev === undefined) delete process.env.E2E_SHARED_DB; else process.env.E2E_SHARED_DB = prev; });

const api = (method: string, path: string, body?: unknown) => erp.call(method, path, body, token);
async function asModule<T>(id: string, sql: string): Promise<T> {
  const c = new pg.Client({ connectionString: erp.databaseUrls[id] });
  await c.connect();
  try { return (await c.query(sql)).rows as T; } finally { await c.end(); }
}

describe('all modules in one database (schema + role per module)', () => {
  it('uses one database for every module', () => {
    const dbs = new Set(Object.values(erp.databaseUrls).map((u) => new URL(u).pathname));
    expect(dbs.size).toBe(1);
  });

  it('purchase order received -> stock in, events flow as usual', async () => {
    const item = (await api('POST', '/api/master-data/items', { code: 'RM-1', name: 'เหล็กแผ่น', type: 'raw' })).body;
    const line = { itemId: item.id, itemCode: 'RM-1', itemName: 'เหล็กแผ่น', qty: 40, unitPrice: 10 };
    const po = (await api('POST', '/api/purchasing/purchase-orders', { supplierName: 'Siam Steel', warehouseCode: 'MAIN', lines: [line] })).body;
    await api('PUT', '/api/purchasing/settings', { creatorCannotApprove: false });
    expect((await api('POST', `/api/purchasing/purchase-orders/${po.id}/approve`)).status).toBe(200);
    expect((await api('POST', `/api/purchasing/purchase-orders/${po.id}/receive`)).status).toBe(200);
    await erp.settle();
    const bal = (await api('GET', `/api/inventory/balances?itemId=${item.id}&warehouseCode=MAIN&nonZero=false`)).body;
    expect(bal[0].onHand).toBe(40);
  });

  it("keeps each module's tables in its own schema", async () => {
    const [{ s }] = await asModule<{ s: string }[]>('purchasing', 'select current_schema() as s');
    expect(s).toBe('purchasing');
    const tables = await asModule<{ table_name: string }[]>('purchasing', "select table_name from information_schema.tables where table_schema = 'purchasing' and table_name = 'purchase_orders'");
    expect(tables).toHaveLength(1);
  });

  it("a module cannot read another module's tables", async () => {
    await expect(asModule('purchasing', 'select * from inventory.stock_moves limit 1')).rejects.toThrow(/permission denied/);
    await expect(asModule('inventory', 'select * from identity.users limit 1')).rejects.toThrow(/permission denied/);
  });

  it('row-level security still hides other companies inside the schema', async () => {
    const rows = await asModule<unknown[]>('purchasing', 'select * from purchase_orders');
    expect(rows).toHaveLength(0); // no app.tenant_id set -> no company -> no rows
  });
});
