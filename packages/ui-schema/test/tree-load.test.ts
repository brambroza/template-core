import { describe, expect, it } from 'vitest';
import { brokenLinks, recordLines, recordValues, treeAddQuery, treeHasChildren, treeHidden, treeParents, type Field, type LinesSpec } from '../src/index.ts';

const rows = [
  { level: 1, code: 'SA-DOOR' },   // 0  ▾
  { level: 2, code: 'SA-PANEL' },  // 1    ▾
  { level: 3, code: 'RM-SHEET' },  // 2
  { level: 2, code: 'SP-HINGE' },  // 3
  { level: 1, code: 'RM-SHEET' },  // 4
];

describe('tree lines', () => {
  it('knows which rows have children', () => {
    expect(rows.map((_, i) => treeHasChildren(rows, 'level', i))).toEqual([true, true, false, false, false]);
    expect(treeParents(rows, 'level')).toEqual([0, 1]);
  });

  it('hides the descendants of folded rows only', () => {
    expect([...treeHidden(rows, 'level', new Set())]).toEqual([]);
    expect([...treeHidden(rows, 'level', new Set([1]))]).toEqual([2]);
    expect([...treeHidden(rows, 'level', new Set([0]))]).toEqual([1, 2, 3]);
    expect([...treeHidden(rows, 'level', new Set([4]))]).toEqual([]); // a leaf cannot fold
  });

  it('builds the prefill query of a "+ sub-BOM" link', () => {
    const q = treeAddQuery({ screen: 'bomEdit', label: 'สร้างสูตรย่อย', prefill: { itemId: 'item_id', itemCode: 'item_code', itemName: 'item_name' }, labels: { itemId: ['item_code', 'item_name'] } },
      { item_id: 'u1', item_code: 'SA-PANEL', item_name: 'แผ่นบาน' });
    expect(Object.fromEntries(new URLSearchParams(q))).toEqual({ 'f.itemId': 'u1', 'f.itemCode': 'SA-PANEL', 'f.itemName': 'แผ่นบาน', 'l.itemId': 'SA-PANEL  แผ่นบาน' });
  });
});

const item: Field = { name: 'itemId', label: 'สินค้า', type: 'lookup', lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } } };

describe('edit forms load the record', () => {
  it('fills fields by name or snake_case, lookups with their assigned values and chosen text', () => {
    const v = recordValues([item, { name: 'outputQty', label: 'ผลิตได้', type: 'number' }], { item_id: 'u1', item_code: 'FG-1', item_name: 'ตู้', output_qty: 2 });
    expect(v).toEqual({ itemId: 'u1', itemCode: 'FG-1', itemName: 'ตู้', '__label.itemId': 'FG-1  ตู้', outputQty: 2 });
  });

  it('fills the lines too', () => {
    const spec: LinesSpec = { name: 'lines', label: 'ส่วนประกอบ', fields: [item, { name: 'qty', label: 'ใช้', type: 'number' }, { name: 'scrapPct', label: 'เผื่อเสีย', type: 'number' }] };
    expect(recordLines(spec, { lines: [{ item_id: 'u2', item_code: 'RM-1', item_name: null, qty: 1.5, scrap_pct: 25 }] })).toEqual([
      { itemId: 'u2', itemCode: 'RM-1', '__label.itemId': 'RM-1', qty: 1.5, scrapPct: 25 },
    ]);
    expect(recordLines(spec, {})).toEqual([]);
  });
});

describe('form attachments', () => {
  it('need the id of the record the files belong to', () => {
    const ui = (after?: { screen: string; idFrom?: string }) => ({
      module: 'maintenance', label: 'ซ่อม', glyph: 'ซ', menu: [],
      screens: {
        woNew: { kind: 'form' as const, title: 'แจ้งซ่อม', method: 'POST' as const, endpoint: '/work-orders', fields: [], submitLabel: 'แจ้งซ่อม', attach: { entity: 'work-order' }, after },
        woDetail: { kind: 'detail' as const, title: 'งานซ่อม', endpoint: '/work-orders/:id', heading: 'no', fields: [] },
      },
    });
    expect(brokenLinks(ui({ screen: 'woDetail', idFrom: 'id' }))).toEqual([]);
    expect(brokenLinks(ui({ screen: 'woDetail' }))).toEqual(['maintenance: woNew.attach needs after.idFrom (the id of the record the files belong to)']);
  });
});
