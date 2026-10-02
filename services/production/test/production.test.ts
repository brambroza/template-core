import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const item = (code: string) => ({ itemId: randomUUID(), itemCode: code });
const steel = item('RM-STEEL');
const bolt = item('SP-BOLT');
const paint = item('RM-PAINT');
const plate = item('SA-PLATE');
const bracket = item('FG-BRACKET');

describe('production', () => {
  it('explodes a multi-level BOM with scrap and sums shared leaves', async () => {
    // plate (sub-assembly): 2 kg steel per plate, 0.1 L paint
    expect((await t.api('PUT', '/boms', { ...plate, lines: [{ ...steel, qty: 2 }, { ...paint, qty: 0.1 }] })).status).toBe(200);
    // bracket: 1 plate + 4 bolts + 0.5 kg steel with 20% scrap
    await t.api('PUT', '/boms', { ...bracket, lines: [{ ...plate, qty: 1 }, { ...bolt, qty: 4 }, { ...steel, qty: 0.5, scrapPct: 20 }] });
    const r = await t.api('GET', `/boms/${bracket.itemId}/explode?qty=10`);
    expect(r.body.map((x: any) => [x.itemCode, x.qty])).toEqual([['RM-PAINT', 1], ['RM-STEEL', 26.25], ['SP-BOLT', 40]]);
  });

  it('rejects circular BOMs', async () => {
    const res = await t.api('PUT', '/boms', { ...steel, lines: [{ ...bracket, qty: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/BOM.*วนกลับ/);
    // the failed edit rolled back: steel still has no BOM
    expect((await t.api('GET', `/boms/${steel.itemId}`)).status).toBe(404);
  });

  it('plans, releases and completes an order in steps, publishing consumption', async () => {
    expect((await t.api('POST', '/orders', { ...bolt, qty: 1 })).status).toBe(409); // no BOM
    const o = (await t.api('POST', '/orders', { ...bracket, qty: 10, warehouseCode: 'FG' })).body;
    expect(o.no).toMatch(/^MO-\d{4}-0001$/);
    const detail = await t.api('GET', `/orders/${o.id}`);
    expect(detail.body.requirements).toHaveLength(3);
    expect((await t.api('POST', `/orders/${o.id}/complete`)).status).toBe(409); // not released
    await t.api('POST', `/orders/${o.id}/release`);
    expect((await t.api('POST', `/orders/${o.id}/complete`, { qty: 4 })).body).toMatchObject({ status: 'released', completed_qty: 4 });
    expect((await t.api('POST', `/orders/${o.id}/complete`)).body).toMatchObject({ status: 'completed', completed_qty: 10 });
    const events = await t.published('production.completed');
    expect(events.map((e) => e.data.qty)).toEqual([4, 6]);
    expect(events[1].data.components.map((x: any) => [x.itemCode, x.qty])).toEqual([['SA-PLATE', 6], ['SP-BOLT', 24], ['RM-STEEL', 3.75]]);
    expect(events[1].data).toMatchObject({ warehouseCode: 'FG', item: { itemCode: 'FG-BRACKET' } });
  });
});
