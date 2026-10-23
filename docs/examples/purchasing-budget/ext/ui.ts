import { defineUiExtension } from '@erp/ui-schema';

/** Screens for the budget extension: merged into purchasing's vendor screens by `pnpm erp ui-sync`. */
export default defineUiExtension({
  module: 'purchasing',
  menu: [{ label: 'งบประมาณจัดซื้อ', screen: 'xBudgetList' }],
  patch: {
    poList: { columns: [{ key: 'x_budget_code', label: 'รหัสงบ' }], after: 'supplier_name' },
    poDetail: {
      fields: [{ key: 'x_budget_code', label: 'รหัสงบประมาณ' }], after: 'supplier_name',
      actions: [{
        id: 'x-budget', label: 'ระบุรหัสงบ', method: 'POST', endpoint: '/x/purchase-orders/:id/budget', perm: 'purchasing.x_budget.write',
        when: { field: 'status', in: ['draft'] },
        fields: [{ name: 'code', label: 'รหัสงบ', type: 'lookup', required: true, lookup: { path: '/x/budgets', label: ['code', 'name'], assign: { code: 'code' } } }],
      }],
    },
  },
  screens: {
    xBudgetList: {
      kind: 'list', title: 'งบประมาณจัดซื้อ', endpoint: '/x/budgets', perm: 'purchasing.po.read', create: 'xBudgetNew', createLabel: 'เพิ่มงบ',
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่องบ' }, { key: 'amount', label: 'วงเงิน', format: 'money' },
        { key: 'used', label: 'ใช้ไป', format: 'money' }, { key: 'remaining', label: 'คงเหลือ', format: 'money' },
      ],
      empty: 'ยังไม่มีงบประมาณ',
    },
    xBudgetNew: {
      kind: 'form', title: 'เพิ่ม / แก้งบประมาณ', method: 'POST', endpoint: '/x/budgets', perm: 'purchasing.x_budget.write', submitLabel: 'บันทึก',
      fields: [
        { name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่องบ', type: 'text', required: true },
        { name: 'amount', label: 'วงเงิน (บาท)', type: 'number', required: true },
      ],
      after: { screen: 'xBudgetList' },
    },
  },
});
