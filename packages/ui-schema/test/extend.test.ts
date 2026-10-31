import { describe, expect, it } from 'vitest';
import { defineUi, defineUiExtension, extendUi, type DetailScreen, type FormScreen, type ListScreen } from '../src/index.ts';

const vendor = defineUi({
  module: 'purchasing', label: 'จัดซื้อ', glyph: 'ซ',
  menu: [{ label: 'ใบสั่งซื้อ', screen: 'poList' }],
  screens: {
    poList: { kind: 'list', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders', columns: [{ key: 'no', label: 'เลขที่' }, { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'currency', label: 'สกุลเงิน' }] },
    poNew: { kind: 'form', title: 'สร้าง', method: 'POST', endpoint: '/purchase-orders', submitLabel: 'บันทึก', fields: [{ name: 'supplierId', label: 'ผู้ขาย', type: 'text' }, { name: 'note', label: 'หมายเหตุ', type: 'text' }] },
    poDetail: { kind: 'detail', title: 'ใบสั่งซื้อ', endpoint: '/purchase-orders/:id', heading: 'no', fields: [{ key: 'no', label: 'เลขที่' }], actions: [{ id: 'approve', label: 'อนุมัติ', method: 'POST', endpoint: '/purchase-orders/:id/approve' }] },
  },
  commands: [{ id: 'po', label: 'PO', example: 'PO', keywords: ['po'], screen: 'poNew' }],
});

describe('extendUi (customer ext/ui.ts)', () => {
  it('returns the vendor ui untouched without an extension', () => {
    expect(extendUi(vendor, null)).toBe(vendor);
  });

  it('adds columns after a named column, fields, actions, screens and menu items; hides vendor parts', () => {
    const ui = extendUi(vendor, defineUiExtension({
      module: 'purchasing',
      menu: [{ label: 'งบประมาณ', screen: 'xBudgets' }],
      patch: {
        poList: { columns: [{ key: 'x_budget_code', label: 'รหัสงบ' }], after: 'no' },
        poNew: { fields: [{ name: 'xBudgetCode', label: 'รหัสงบ', type: 'text' }], after: 'supplierId' },
        poDetail: { fields: [{ key: 'x_budget_code', label: 'รหัสงบ' }], actions: [{ id: 'x-budget', label: 'ตั้งรหัสงบ', method: 'POST', endpoint: '/x/purchase-orders/:id/budget' }] },
      },
      hide: { poList: ['currency'] },
      screens: { xBudgets: { kind: 'list', title: 'งบประมาณ', endpoint: '/x/budgets', columns: [{ key: 'code', label: 'รหัส' }] } },
    }));
    expect((ui.screens.poList as ListScreen).columns.map((c) => c.key)).toEqual(['no', 'x_budget_code', 'supplier_name']);
    expect((ui.screens.poNew as FormScreen).fields.map((f) => f.name)).toEqual(['supplierId', 'xBudgetCode', 'note']);
    expect((ui.screens.poDetail as DetailScreen).actions?.map((a) => a.id)).toEqual(['approve', 'x-budget']);
    expect(ui.menu.map((m) => m.screen)).toEqual(['poList', 'xBudgets']);
    expect(ui.screens.xBudgets.kind).toBe('list');
    // the vendor object is not mutated (the same import is shared by every renderer)
    expect((vendor.screens.poList as ListScreen).columns).toHaveLength(3);
  });

  it('can turn a vendor list into a kanban and let AI fill a vendor form', () => {
    const ui = extendUi(vendor, defineUiExtension({
      module: 'purchasing',
      patch: {
        poList: { display: 'board', board: { field: 'status', lanes: [{ value: 'draft', label: 'ร่าง' }, { value: 'approved', label: 'อนุมัติ' }] } },
        poNew: { aiFill: { kind: 'document', label: 'สร้างจากใบเสนอราคา' } },
      },
    }));
    expect((ui.screens.poList as ListScreen).display).toBe('board');
    expect((ui.screens.poNew as FormScreen).aiFill?.label).toBe('สร้างจากใบเสนอราคา');
    expect(() => extendUi(vendor, { module: 'purchasing', patch: { poDetail: { aiFill: { kind: 'document', label: 'x' } } } })).toThrow(/form screens only/);
    expect(() => extendUi(vendor, { module: 'purchasing', patch: { poNew: { display: 'board' } } })).toThrow(/list screens only/);
  });

  it('fails loudly when the vendor ui no longer has what the extension points at', () => {
    expect(() => extendUi(vendor, { module: 'sales' })).toThrow(/expected "purchasing"/);
    expect(() => extendUi(vendor, { module: 'purchasing', patch: { poGone: { columns: [] } } })).toThrow(/no such screen/);
    expect(() => extendUi(vendor, { module: 'purchasing', patch: { poList: { columns: [{ key: 'a', label: 'a' }], after: 'renamed' } } })).toThrow(/after: renamed/);
    expect(() => extendUi(vendor, { module: 'purchasing', hide: { poList: ['nope'] } })).toThrow(/nothing named "nope"/);
    expect(() => extendUi(vendor, { module: 'purchasing', screens: { poList: vendor.screens.poList } })).toThrow(/already exists/);
    expect(() => extendUi(vendor, { module: 'purchasing', commands: [{ id: 'po', label: 'x', example: 'x', keywords: [], screen: 'poNew' }] })).toThrow(/command "po"/);
    expect(() => extendUi(vendor, { module: 'purchasing', patch: { poNew: { actions: [] } } })).toThrow(/form screen takes only "fields"/);
  });
});
