import { defineUi, type Field } from '@erp/ui-schema';

const item = (label: string): Field => ({
  name: 'itemId', label, type: 'lookup', required: true,
  lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } },
});

const bomHeader: Field[] = [item('สินค้าที่ผลิต'), { name: 'outputQty', label: 'ผลิตได้ต่อสูตร', type: 'number', default: 1 }];
// a component that has its own BOM is a sub-assembly: the detail screen shows its levels underneath (no limit on depth)
const bomLines = {
  name: 'lines', label: 'ส่วนประกอบ (ชิ้นส่วนย่อยที่มีสูตรของตัวเองจะแตกระดับให้อัตโนมัติ)', min: 1,
  fields: [item('ส่วนประกอบ'), { name: 'qty', label: 'ใช้ต่อสูตร', type: 'number', required: true, step: 0.000001 }, { name: 'scrapPct', label: 'เผื่อเสีย %', type: 'number', default: 0 }] as Field[],
};

export default defineUi({
  module: 'production',
  label: 'วางแผนการผลิต',
  glyph: 'ผ',
  icon: 'factory',
  statusLabels: { completed: 'ผลิตเสร็จ' },
  menu: [{ label: 'ใบสั่งผลิต', screen: 'moList' }, { label: 'สูตรการผลิต (BOM)', screen: 'bomList' }],
  commands: [
    { id: 'mo', label: 'สั่งผลิต', example: 'ผลิต FG-BRACKET 500', keywords: ['ผลิต', 'สั่งผลิต', 'mo'], screen: 'moNew', perm: 'production.order.write',
      arg: { lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } } }, restField: 'qty' },
  ],
  search: [
    { id: 'mos', title: 'ใบสั่งผลิต', endpoint: '/orders', label: ['no', 'item_code', 'item_name'], screen: 'moDetail', perm: 'production.order.read' },
  ],
  screens: {
    moList: {
      kind: 'list', title: 'ใบสั่งผลิต', endpoint: '/orders', perm: 'production.order.read', mobile: true,
      filters: [{ name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'planned', label: 'วางแผน' }, { value: 'released', label: 'ปล่อยงาน' }, { value: 'completed', label: 'ผลิตเสร็จ' }, { value: 'cancelled', label: 'ยกเลิก' }] }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'item_code', label: 'สินค้า' }, { key: 'qty', label: 'สั่งผลิต', format: 'qty' },
        { key: 'completed_qty', label: 'ผลิตแล้ว', format: 'qty' }, { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' }, { key: 'status', label: 'สถานะ', format: 'status' },
      ],
      create: 'moNew', createLabel: 'สร้างใบสั่งผลิต', rowLink: { screen: 'moDetail' }, empty: 'ยังไม่มีใบสั่งผลิต ต้องมีสูตรการผลิตของสินค้าก่อน',
      display: 'board',
      board: {
        field: 'status',
        lanes: [{ value: 'planned', label: 'วางแผน' }, { value: 'released', label: 'ปล่อยงาน' }, { value: 'completed', label: 'ผลิตเสร็จ' }, { value: 'cancelled', label: 'ยกเลิก' }],
        moves: { released: ['release'], completed: ['complete'], cancelled: ['cancel'] },
        sum: { key: 'qty', label: 'รวม', format: 'qty', unit: 'หน่วย' },
        collapsed: ['cancelled'],
      },
    },
    moNew: {
      kind: 'form', title: 'สร้างใบสั่งผลิต', method: 'POST', endpoint: '/orders', perm: 'production.order.write',
      fields: [
        item('สินค้าที่จะผลิต'),
        { name: 'qty', label: 'จำนวน', type: 'number', required: true },
        { name: 'warehouseCode', label: 'คลังวัตถุดิบและสินค้า', type: 'text', default: 'MAIN', required: true },
        { name: 'dueDate', label: 'กำหนดเสร็จ', type: 'date' },
      ],
      submitLabel: 'สร้างใบสั่งผลิต', after: { screen: 'moDetail', idFrom: 'id' },
    },
    moDetail: {
      kind: 'detail', title: 'ใบสั่งผลิต', endpoint: '/orders/:id', perm: 'production.order.read', heading: 'no', mobile: true,
      flow: { field: 'status', steps: [{ value: 'planned', label: 'วางแผน' }, { value: 'released', label: 'ปล่อยงาน' }, { value: 'completed', label: 'ผลิตเสร็จ' }], exits: [{ value: 'cancelled', label: 'ยกเลิก' }] },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'item_code', label: 'สินค้า' }, { key: 'item_name', label: 'ชื่อ' },
        { key: 'qty', label: 'สั่งผลิต', format: 'qty' }, { key: 'completed_qty', label: 'ผลิตแล้ว', format: 'qty' },
        { key: 'warehouse_code', label: 'คลัง' }, { key: 'due_date', label: 'กำหนดเสร็จ', format: 'date' },
      ],
      lines: [{ path: 'requirements', label: 'วัตถุดิบที่ต้องใช้ (ส่วนที่ยังไม่ผลิต)', columns: [{ key: 'itemCode', label: 'รหัส' }, { key: 'itemName', label: 'ชื่อ' }, { key: 'qty', label: 'จำนวน', format: 'qty' }] }],
      actions: [
        { id: 'release', label: 'ปล่อยงานเข้าไลน์', method: 'POST', endpoint: '/orders/:id/release', perm: 'production.order.write', when: { field: 'status', in: ['planned'] }, tone: 'primary', mobile: true },
        { id: 'complete', label: 'รายงานผลผลิต', method: 'POST', endpoint: '/orders/:id/complete', perm: 'production.order.write', when: { field: 'status', in: ['released'] }, tone: 'primary', mobile: true,
          fields: [{ name: 'qty', label: 'จำนวนที่ผลิตได้', type: 'number', help: 'เว้นว่าง = ผลิตครบส่วนที่เหลือ' }] },
        { id: 'cancel', label: 'ยกเลิกใบสั่งผลิต', method: 'POST', endpoint: '/orders/:id/cancel', perm: 'production.order.write', when: { field: 'status', in: ['planned', 'released'] }, confirm: 'ยกเลิกแล้วแก้กลับไม่ได้', tone: 'danger' },
      ],
    },
    bomList: {
      kind: 'list', title: 'สูตรการผลิต (BOM)', endpoint: '/boms', perm: 'production.bom.read',
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อสินค้า', type: 'text' }],
      columns: [
        { key: 'item_code', label: 'สินค้า' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'role_label', label: 'ประเภท' },
        { key: 'levels', label: 'จำนวนระดับ', format: 'qty' }, { key: 'components', label: 'ส่วนประกอบตรง', format: 'qty' },
        { key: 'output_qty', label: 'ผลิตได้ต่อสูตร', format: 'qty' }, { key: 'updated_at', label: 'แก้ไขล่าสุด', format: 'datetime', phone: false },
      ],
      create: 'bomEdit', createLabel: 'สร้างสูตร', rowLink: { screen: 'bomDetail', idFrom: 'item_id' }, empty: 'ยังไม่มีสูตรการผลิต',
    },
    bomDetail: {
      kind: 'detail', title: 'สูตรการผลิต', endpoint: '/boms/:itemId', perm: 'production.bom.read', heading: 'item_code', edit: 'bomChange', printable: true,
      fields: [{ key: 'item_name', label: 'สินค้า' }, { key: 'output_qty', label: 'ผลิตได้ต่อสูตร', format: 'qty' }, { key: 'levels', label: 'จำนวนระดับ', format: 'qty' }],
      lines: [
        {
          path: 'tree', label: 'โครงสร้างสินค้า (ทุกระดับ)',
          tree: {
            level: 'level',
            link: { screen: 'bomDetail', idFrom: 'item_id', when: 'has_bom' },
            add: { screen: 'bomEdit', label: 'สร้างสูตรย่อย', unless: 'has_bom', perm: 'production.bom.write',
              prefill: { itemId: 'item_id', itemCode: 'item_code', itemName: 'item_name' }, labels: { itemId: ['item_code', 'item_name'] } },
          },
          columns: [
            { key: 'item_code', label: 'รหัส', indent: true }, { key: 'item_name', label: 'ชื่อ' }, { key: 'source_label', label: 'ที่มา' },
            { key: 'qty_per', label: 'ใช้ต่อสูตรแม่', format: 'qty' }, { key: 'scrap_pct', label: 'เผื่อเสีย', format: 'percent' },
            { key: 'qty', label: 'ใช้รวมต่อ 1 สูตร', format: 'qty' },
          ],
        },
        { path: 'requirements', label: 'วัตถุดิบรวมทุกระดับ (ต่อ 1 สูตร)', columns: [{ key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'qty', label: 'จำนวนรวม', format: 'qty' }] },
        {
          path: 'used_in', label: 'ใช้เป็นส่วนประกอบใน', print: false,
          tree: { level: 'level', link: { screen: 'bomDetail', idFrom: 'item_id' } },
          columns: [{ key: 'item_code', label: 'สินค้า', indent: true }, { key: 'item_name', label: 'ชื่อ' }, { key: 'qty_per', label: 'ใช้ต่อสูตร', format: 'qty' }],
        },
      ],
    },
    bomEdit: {
      kind: 'form', title: 'สร้างสูตรการผลิต', method: 'PUT', endpoint: '/boms', perm: 'production.bom.write',
      fields: bomHeader,
      lines: bomLines,
      submitLabel: 'บันทึกสูตร', after: { screen: 'bomDetail', idFrom: 'item_id' },
    },
    bomChange: {
      kind: 'form', title: 'แก้ไขสูตรการผลิต', method: 'PUT', endpoint: '/boms', load: '/boms/:itemId', perm: 'production.bom.write',
      fields: bomHeader,
      lines: bomLines,
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'bomDetail', idFrom: 'item_id' },
    },
  },
  widgets: [
    { id: 'mo-kpi', kind: 'kpi', title: 'การผลิต', endpoint: '/summary', perm: 'production.order.read', size: 'sm', href: 'moList',
      items: [{ key: 'released', label: 'กำลังผลิต', format: 'qty' }, { key: 'late', label: 'เลยกำหนด', format: 'qty', tone: 'stop' }, { key: 'outputMonth', label: 'ผลผลิตเดือนนี้', format: 'qty', tone: 'ok' }] },
    { id: 'mo-pipeline', kind: 'pipeline', title: 'สายการผลิต', endpoint: '/summary', perm: 'production.order.read', size: 'lg', href: 'moList',
      rows: 'rows', field: 'status', title2: 'no', subtitle: 'item_code', link: { screen: 'moDetail' },
      stages: [{ value: 'planned', label: 'วางแผน' }, { value: 'released', label: 'กำลังผลิต' }, { value: 'completed', label: 'ผลิตเสร็จ' }] },
  ],
});
