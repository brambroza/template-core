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

describe('multi-level BOM (indented tree, totals, where-used)', () => {
  // cabinet (FG) ← door (sub-assembly) ← door panel (sub-assembly) ← sheet steel; plus hinges and screws at several levels
  const sheet = item('RM-SHEET');
  const screw = item('SP-SCREW');
  const hinge = item('SP-HINGE');
  const panel = { ...item('SA-PANEL'), itemName: 'แผ่นบานประตู' };
  const door = { ...item('SA-DOOR'), itemName: 'บานประตู' };
  const cabinet = { ...item('FG-CABINET'), itemName: 'ตู้เหล็ก' };

  it('shows every level depth first with quantities for one recipe', async () => {
    await t.api('PUT', '/boms', { ...panel, lines: [{ ...sheet, qty: 1.5, scrapPct: 25 }] });
    await t.api('PUT', '/boms', { ...door, lines: [{ ...panel, qty: 1 }, { ...hinge, qty: 2 }, { ...screw, qty: 8 }] });
    await t.api('PUT', '/boms', { ...cabinet, outputQty: 2, lines: [{ ...door, qty: 4 }, { ...sheet, qty: 3 }, { ...screw, qty: 20 }] });

    const r = await t.api('GET', `/boms/${cabinet.itemId}`);
    expect(r.status).toBe(200);
    expect(r.body.levels).toBe(3);
    expect(r.body.lines).toHaveLength(3); // the direct lines are unchanged (edit form)
    // 2 cabinets per recipe: 4 doors; each door 1 panel; each panel 1.5 sheet with 25% scrap = 2
    expect(r.body.tree.map((x: any) => [x.level, x.item_code, x.qty, x.has_bom])).toEqual([
      [1, 'SA-DOOR', 4, true],
      [2, 'SA-PANEL', 4, true],
      [3, 'RM-SHEET', 8, false],
      [2, 'SP-HINGE', 8, false],
      [2, 'SP-SCREW', 32, false],
      [1, 'RM-SHEET', 3, false],
      [1, 'SP-SCREW', 20, false],
    ]);
    expect(r.body.tree[2]).toMatchObject({ parent_code: 'SA-PANEL', qty_per: 1.5, scrap_pct: 25 });
    // bought materials across all levels, the same item summed
    expect(r.body.requirements.map((x: any) => [x.item_code, x.qty])).toEqual([['RM-SHEET', 11], ['SP-HINGE', 8], ['SP-SCREW', 52]]);
    // the totals agree with the explosion used for production orders
    const ex = await t.api('GET', `/boms/${cabinet.itemId}/explode?qty=2`);
    expect(ex.body.map((x: any) => [x.itemCode, x.qty])).toEqual([['RM-SHEET', 11], ['SP-HINGE', 8], ['SP-SCREW', 52]]);
  });

  it('scales the tree to any quantity', async () => {
    const r = await t.api('GET', `/boms/${cabinet.itemId}/tree?qty=10`);
    expect(r.body.find((x: any) => x.level === 3).qty).toBe(40); // 10 cabinets → 20 doors → 20 panels → 40 sheets
  });

  it('answers where-used up through every level', async () => {
    const r = await t.api('GET', `/boms/${panel.itemId}/where-used`);
    expect(r.body.map((x: any) => [x.level, x.item_code, x.via])).toEqual([[1, 'SA-DOOR', ''], [2, 'FG-CABINET', 'SA-DOOR']]);
    // an item without its own BOM (bought) works too
    const screws = await t.api('GET', `/boms/${screw.itemId}/where-used`);
    expect(screws.body.map((x: any) => x.item_code).sort()).toEqual(['FG-CABINET', 'SA-DOOR']);
    expect((await t.api('GET', `/boms/${panel.itemId}`)).body.used_in.map((x: any) => x.item_code)).toEqual(['SA-DOOR', 'FG-CABINET']);
  });

  it('marks sub-assemblies and depth in the BOM list', async () => {
    const list = (await t.api('GET', '/boms')).body as any[];
    const by = (code: string) => list.find((x) => x.item_code === code);
    expect(by('FG-CABINET')).toMatchObject({ role: 'top', levels: 3, components: 3 });
    expect(by('SA-DOOR')).toMatchObject({ role: 'sub', role_label: 'ชิ้นส่วนประกอบย่อย', levels: 2 });
    expect(by('SA-PANEL')).toMatchObject({ role: 'sub', levels: 1 });
    expect((await t.api('GET', '/boms?q=บาน')).body.map((x: any) => x.item_code)).toEqual(['SA-DOOR', 'SA-PANEL']);
  });

  it('refuses a cycle two levels down', async () => {
    const res = await t.api('PUT', '/boms', { ...panel, lines: [{ ...cabinet, qty: 1 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/SA-PANEL → FG-CABINET → SA-DOOR → SA-PANEL/);
    expect((await t.api('GET', `/boms/${panel.itemId}`)).body.lines[0].item_code).toBe('RM-SHEET'); // rolled back
  });

  it('needs the read permission', async () => {
    const tok = t.token(['production.order.read']);
    for (const p of [`/boms/${cabinet.itemId}`, `/boms/${cabinet.itemId}/tree`, `/boms/${cabinet.itemId}/where-used`]) {
      expect((await t.api('GET', p, undefined, { token: tok })).status).toBe(403);
    }
  });

  it('keeps BOMs of other companies out', async () => {
    const other = t.token(['production.*'], t.otherTenantId);
    expect((await t.api('GET', `/boms/${cabinet.itemId}/tree`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('GET', `/boms/${panel.itemId}/where-used`, undefined, { token: other })).body).toEqual([]);
  });
});
