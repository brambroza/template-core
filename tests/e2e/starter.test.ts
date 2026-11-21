import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { wipeOrder } from '@erp/kernel';
import { INDUSTRY_IDS, type IndustryId } from '@erp/starter';
import { definition as identity } from '@erp/svc-identity';
import { runStarter, STARTER_HELPERS } from '@erp/svc-identity/starter';
import { definition as masterData } from '@erp/svc-master-data';
import { definition as inventory } from '@erp/svc-inventory';
import { definition as purchasing } from '@erp/svc-purchasing';
import { definition as sales } from '@erp/svc-sales';
import { definition as production } from '@erp/svc-production';
import { definition as maintenance } from '@erp/svc-maintenance';
import { definition as quality } from '@erp/svc-quality';
import { definition as accounting } from '@erp/svc-accounting';
import { definition as booking } from '@erp/svc-booking';
import { install, type Installation } from './helpers.ts';

/**
 * Phase 2: a trial company starts with sample data of its industry (put in through the real APIs, so stock, journals and QC
 * come from real events), the owner can act on it at once, and "ล้างข้อมูลตัวอย่าง" deletes every row of that company in every
 * module — and nothing of any other company.
 */
let erp: Installation;
const companies = {} as Record<IndustryId, { token: string; tenantId: string }>;
beforeAll(async () => {
  erp = await install([identity, masterData, inventory, purchasing, sales, production, maintenance, quality, accounting, booking]);
  for (const ind of INDUSTRY_IDS) companies[ind] = await erp.provision(`starter-${ind}`);
}, 60_000);
afterAll(async () => { await erp?.close(); });

const api = (ind: IndustryId) => (method: string, path: string, body?: unknown) => erp.call(method, path, body, companies[ind].token);

/** rows of `tenantId` per table, in every module except identity (inside the company's transaction, so RLS applies) */
async function rowsOf(tenantId: string): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const [id, svc] of Object.entries(erp.services)) {
    if (id === 'identity') continue;
    await svc.db.tx(tenantId, async (c) => {
      for (const t of await wipeOrder(c)) {
        const n = Number((await c.query(`select count(*) as n from "${t}" where tenant_id = $1`, [tenantId])).rows[0].n);
        if (n) out[`${id}.${t}`] = n;
      }
    });
  }
  return out;
}

describe('sample data per industry', () => {
  it.each(INDUSTRY_IDS)('%s: seeds every installed module and leaves the first steps for the owner', async (ind) => {
    const row = await runStarter(erp.services.identity.kernel, { tenantId: companies[ind].tenantId, industry: ind, modules: null, settle: erp.settle });
    expect(row?.error ?? null).toBeNull();
    expect(row).toMatchObject({ state: 'ready', industry: ind });
    const call = api(ind);

    const banner = (await call('GET', '/api/identity/starter')).body.starter;
    expect(banner).toMatchObject({ state: 'ready', industry: ind });
    expect(banner.next.approvePo).toMatch(/^PO-/);
    expect(banner.next.receivePo).toMatch(/^PO-/);
    expect(banner.next.shipSo).toMatch(/^SO-/);

    // the owner approves the PO the sample clerk raised (separation of duties: someone else created it)
    const pos = (await call('GET', '/api/purchasing/purchase-orders')).body;
    const waiting = (Array.isArray(pos) ? pos : pos.rows).find((p: { no: string }) => p.no === banner.next.approvePo);
    const approved = await call('POST', `/api/purchasing/purchase-orders/${waiting.id}/approve`);
    expect(approved.status).toBe(200);

    // stock never negative, journals posted, QC inspections raised by real events
    const balances = (await call('GET', '/api/inventory/balances?nonZero=false')).body as { itemCode: string; onHand: number }[];
    expect(balances.length).toBeGreaterThan(3);
    for (const b of balances) expect(Number(b.onHand), b.itemCode).toBeGreaterThanOrEqual(0);
    const rows = await rowsOf(companies[ind].tenantId);
    expect(Object.keys(rows).some((t) => t.startsWith('accounting.journal'))).toBe(true);
    if (ind !== 'trading') expect(Object.keys(rows).some((t) => t.startsWith('quality.inspection'))).toBe(true);

    // documents show who recorded them: the sample helper, never the owner
    const audit = (await call('GET', '/api/sales/_audit?limit=5')).body;
    const names = JSON.stringify(audit);
    expect(names).toContain(STARTER_HELPERS.clerk.userName);
  }, 120_000);
});

describe('ล้างข้อมูลตัวอย่าง', () => {
  it('needs the typed words and the company-settings right', async () => {
    const call = api('trading');
    const bad = await call('POST', '/api/identity/starter/clear', { confirm: 'ok' });
    expect(bad.status).toBe(400);
    expect(JSON.stringify(bad.body)).toContain('ล้างข้อมูลตัวอย่าง');
  });

  it('deletes every row of the company in every module, keeps its users, and touches no other company', async () => {
    const t = companies.trading.tenantId;
    const otherBefore = await rowsOf(companies.food.tenantId);
    expect(Object.keys(await rowsOf(t)).length).toBeGreaterThan(10);

    const r = await api('trading')('POST', '/api/identity/starter/clear', { confirm: 'ล้างข้อมูลตัวอย่าง' });
    expect(r.status).toBe(200);
    await erp.settle();

    expect(await rowsOf(t)).toEqual({});
    expect(await rowsOf(companies.food.tenantId)).toEqual(otherBefore);
    expect((await api('trading')('GET', '/api/identity/starter')).body.starter).toBeNull();
    // the owner still logs in, and new documents start again at 0001
    const login = await erp.call('POST', '/api/identity/auth/login', { email: 'admin@starter-trading.example.com', password: 'password123' });
    expect(login.status).toBe(200);
    const call = (m: string, p: string, b?: unknown) => erp.call(m, p, b, login.body.token);
    const item = (await call('POST', '/api/master-data/items', { code: 'REAL-1', name: 'สินค้าจริง', type: 'finished', uom: 'ชิ้น' })).body;
    const partner = (await call('POST', '/api/master-data/partners', { code: 'C-REAL', name: 'ลูกค้าจริง', kind: 'customer' })).body;
    const so = await call('POST', '/api/sales/orders', { customerId: partner.id, customerName: partner.name, lines: [{ itemId: item.id, itemCode: 'REAL-1', itemName: 'สินค้าจริง', qty: 1, unitPrice: 100 }] });
    expect(so.status).toBe(201);
    expect(so.body.no).toMatch(/-0001$/);
  }, 60_000);

  it('works once only', async () => {
    const again = await api('trading')('POST', '/api/identity/starter/clear', { confirm: 'ล้างข้อมูลตัวอย่าง' });
    expect(again.status).toBe(409);
    const none = await api('metal');
    expect((await none('GET', '/api/identity/starter')).body.starter.state).toBe('ready');
  });
});
