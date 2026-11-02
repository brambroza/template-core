import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '@erp/svc-purchasing';

// boots purchasing WITH this extension folder (works from docs/examples/… and from services/purchasing/ext/test)
const extDir = fileURLToPath(new URL('..', import.meta.url));
let t: TestService;
beforeAll(async () => { t = await bootTestService({ ...definition, extDir }); await t.api('PUT', '/settings', { creatorCannotApprove: false }); });
afterAll(async () => { await t?.close(); });

const item = { itemId: randomUUID(), itemCode: 'RM-STEEL', itemName: 'เหล็กแผ่น' };
const po = async (unitPrice: number) => (await t.api('POST', '/purchase-orders', { supplierName: 'ผู้ขาย ก', lines: [{ ...item, qty: 1, unitPrice }] })).body;

describe('purchasing ext: budget codes', () => {
  it('approves small POs without a budget code (vendor behaviour unchanged)', async () => {
    const p = await po(1000);
    expect((await t.api('POST', `/purchase-orders/${p.id}/approve`)).body.status).toBe('approved');
  });

  it('refuses a PO above 50,000 without a budget code, then approves it with one that has room', async () => {
    await t.api('POST', '/x/budgets', { code: 'CAPEX-69', name: 'งบลงทุน 2569', amount: 200000 });
    const p = await po(60000); // gross 64,200 incl. VAT
    const refused = await t.api('POST', `/purchase-orders/${p.id}/approve`);
    expect(refused.status).toBe(400);
    expect(refused.body.error.message).toContain('ต้องระบุรหัสงบประมาณ');
    expect((await t.api('POST', `/x/purchase-orders/${p.id}/budget`, { code: 'NOPE' })).status).toBe(400);
    expect((await t.api('POST', `/x/purchase-orders/${p.id}/budget`, { code: 'CAPEX-69' })).body.x_budget_code).toBe('CAPEX-69');
    const ok = await t.api('POST', `/purchase-orders/${p.id}/approve`);
    expect(ok.status).toBe(200);
    expect(ok.body.x_budget_code).toBe('CAPEX-69');
    const [b] = (await t.api('GET', '/x/budgets')).body;
    expect(b).toMatchObject({ code: 'CAPEX-69', remaining: 200000 - 64200 });
  });

  it('refuses when the budget has no room left', async () => {
    await t.api('POST', '/x/budgets', { code: 'SMALL', name: 'งบเล็ก', amount: 60000 });
    const p = await po(60000);
    await t.api('POST', `/x/purchase-orders/${p.id}/budget`, { code: 'SMALL' });
    const res = await t.api('POST', `/purchase-orders/${p.id}/approve`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toContain('ไม่พอ');
  });

  it('checks permissions and keeps budgets per company (tenant)', async () => {
    const reader = t.token(['purchasing.po.read']);
    expect((await t.api('POST', '/x/budgets', { code: 'X', name: 'x', amount: 1 }, { token: reader })).status).toBe(403);
    expect((await t.api('GET', '/x/budgets', undefined, { token: t.token(['*'], t.otherTenantId) })).body).toEqual([]);
  });
});
