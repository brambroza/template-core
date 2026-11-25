import { defineUi, type Field } from '@erp/ui-schema';

const item = (label: string, assign: Record<string, string>): Field => ({
  name: 'itemId', label, type: 'lookup', required: true, lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign },
});

export default defineUi({
  module: 'costing',
  label: 'ต้นทุน',
  glyph: 'ต',
  icon: 'calculator',
  menu: [
    { label: 'ต้นทุนสินค้า', screen: 'costs' },
    { label: 'ใบคำนวณต้นทุน', screen: 'sheets' },
    { label: 'ต้นทุนจริงต่อใบสั่งผลิต', screen: 'jobs' },
  ],
  screens: {
    costs: {
      kind: 'list', title: 'ต้นทุนสินค้า', endpoint: '/item-costs', perm: 'costing.cost.read',
      columns: [
        { key: 'item_code', label: 'รหัส' }, { key: 'avg_cost', label: 'ต้นทุนเฉลี่ย', format: 'money' }, { key: 'last_cost', label: 'ซื้อล่าสุด', format: 'money' },
        { key: 'qty_basis', label: 'ปริมาณที่ใช้คำนวณ', format: 'qty' }, { key: 'source', label: 'ที่มา', format: 'label' }, { key: 'updated_at', label: 'อัปเดต', format: 'datetime' },
      ],
      create: 'costSet', createLabel: 'กำหนดต้นทุน', empty: 'ยังไม่มีต้นทุน กำหนดเองได้ หรือจะได้มาอัตโนมัติเมื่อรับของจากใบสั่งซื้อ',
    },
    costSet: {
      kind: 'form', title: 'กำหนดต้นทุนสินค้า', method: 'PUT', endpoint: '/item-costs/:itemId', perm: 'costing.cost.write',
      fields: [item('สินค้า', { itemId: 'id', itemCode: 'code' }), { name: 'cost', label: 'ต้นทุนต่อหน่วย', type: 'number', step: 0.0001, required: true }],
      submitLabel: 'บันทึกต้นทุน', after: { screen: 'costs' },
    },
    sheets: {
      kind: 'list', title: 'ใบคำนวณต้นทุน', endpoint: '/cost-sheets', perm: 'costing.cost.read',
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'item_code', label: 'สินค้า' }, { key: 'qty', label: 'จำนวน', format: 'qty' },
        { key: 'total_cost', label: 'ต้นทุนรวม', format: 'money' }, { key: 'unit_cost', label: 'ต้นทุนต่อหน่วย', format: 'money' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' },
      ],
      create: 'sheetNew', createLabel: 'คำนวณต้นทุน', rowLink: { screen: 'sheetDetail' }, empty: 'ยังไม่มีใบคำนวณต้นทุน',
    },
    sheetNew: {
      kind: 'form', title: 'คำนวณต้นทุนสินค้า', method: 'POST', endpoint: '/cost-sheets', perm: 'costing.cost.write',
      fields: [
        item('สินค้า', { itemId: 'id', itemCode: 'code', itemName: 'name' }),
        { name: 'qty', label: 'จำนวนที่คำนวณ', type: 'number', format: 'qty', default: 1 },
        { name: 'laborHours', label: 'ชั่วโมงแรงงาน', type: 'number', default: 0 },
        { name: 'laborRatePerHour', label: 'ค่าแรงต่อชั่วโมง', type: 'number', format: 'money', default: 0 },
        { name: 'overheadPct', label: 'โสหุ้ย % ของวัตถุดิบ+แรงงาน', type: 'number', default: 0 },
      ],
      lines: {
        name: 'materials', label: 'วัตถุดิบ', min: 1,
        fields: [item('วัตถุดิบ', { itemId: 'id', itemCode: 'code', itemName: 'name' }), { name: 'qty', label: 'จำนวน', type: 'number', format: 'qty', required: true }],
      },
      submitLabel: 'คำนวณและบันทึก', after: { screen: 'sheetDetail', idFrom: 'id' },
    },
    sheetDetail: {
      kind: 'detail', title: 'ใบคำนวณต้นทุน', endpoint: '/cost-sheets/:id', perm: 'costing.cost.read', heading: 'no', printable: true,
      fields: [
        { key: 'item_code', label: 'สินค้า' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'qty', label: 'จำนวน', format: 'qty' },
        { key: 'material_cost', label: 'วัตถุดิบ', format: 'money' }, { key: 'labor_cost', label: 'แรงงาน', format: 'money' },
        { key: 'overhead_cost', label: 'โสหุ้ย', format: 'money' }, { key: 'total_cost', label: 'ต้นทุนรวม', format: 'money' }, { key: 'unit_cost', label: 'ต้นทุนต่อหน่วย', format: 'money' },
      ],
      lines: [{ path: 'detail.materials', label: 'วัตถุดิบ', columns: [{ key: 'itemCode', label: 'รหัส' }, { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'unitCost', label: 'ต้นทุน/หน่วย', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' }] }],
    },
    jobs: {
      kind: 'list', title: 'ต้นทุนจริงต่อใบสั่งผลิต', endpoint: '/job-costs', perm: 'costing.cost.read',
      columns: [
        { key: 'order_no', label: 'ใบสั่งผลิต' }, { key: 'item_code', label: 'สินค้า' }, { key: 'qty', label: 'ผลิตได้', format: 'qty' },
        { key: 'material_cost', label: 'ค่าวัตถุดิบ', format: 'money' }, { key: 'unit_cost', label: 'ต่อหน่วย', format: 'money' },
        { key: 'missing_costs', label: 'ยังไม่มีต้นทุน', format: 'list' }, { key: 'created_at', label: 'บันทึกเมื่อ', format: 'datetime' },
      ],
      empty: 'จะมีข้อมูลเมื่อรายงานผลผลิตจากโมดูลวางแผนการผลิต',
    },
  },
  widgets: [
    { id: 'cost-kpi', kind: 'kpi', title: 'ต้นทุน', endpoint: '/summary', perm: 'costing.cost.read', size: 'sm', href: 'costs',
      items: [{ key: 'itemsCosted', label: 'สินค้ามีต้นทุน', format: 'number' }, { key: 'materialMonth', label: 'ค่าวัตถุดิบเดือนนี้', format: 'money' }, { key: 'jobsMissingCost', label: 'งานที่ขาดต้นทุน', format: 'number', tone: 'warn' }] },
    { id: 'cost-bars', kind: 'bars', title: 'ต้นทุนเฉลี่ยต่อหน่วยสูงสุด', endpoint: '/summary', perm: 'costing.cost.read', size: 'md', href: 'costs',
      rows: 'rows', label: 'item_code', value: 'avg_cost', format: 'money' },
  ],
});
