import { defineUi, type Field, type LinesSpec } from '@erp/ui-schema';

const wh = (name: string, label: string): Field => ({
  name, label, type: 'lookup', required: true, lookup: { path: '/warehouses', label: ['code', 'name'], assign: { [name]: 'code' } },
});
const item: Field = {
  name: 'itemId', label: 'สินค้า', type: 'lookup', required: true,
  lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' }, scanField: 'code' },
};
const qty: Field = { name: 'qty', label: 'จำนวน', type: 'number', format: 'qty', required: true };
const lines = (extra: Field[] = []): LinesSpec => ({ name: 'lines', label: 'รายการ', fields: [item, qty, ...extra], min: 1 });
const ref: Field[] = [{ name: 'refId', label: 'เลขที่เอกสารอ้างอิง', type: 'text' }, { name: 'note', label: 'หมายเหตุ', type: 'textarea' }];

export default defineUi({
  module: 'inventory',
  label: 'คลังสินค้า',
  glyph: 'ค',
  icon: 'boxes',
  menu: [
    { label: 'ยอดคงเหลือ', screen: 'balances' },
    { label: 'รับเข้า', screen: 'receipt' },
    { label: 'จ่ายออก', screen: 'issue' },
    { label: 'โอนย้าย', screen: 'transfer' },
    { label: 'ปรับปรุงยอด', screen: 'adjust' },
    { label: 'จุดสั่งซื้อ', screen: 'reorder' },
    { label: 'กักกัน QC', screen: 'holds' },
    { label: 'สต็อกติดลบ/ผิดปกติ', screen: 'anomalies' },
    { label: 'คลัง', screen: 'warehouses' },
    { label: 'ตั้งค่า', screen: 'settings' },
  ],
  commands: [
    { id: 'stock', label: 'ดูสต็อกสินค้า', example: 'สต็อก RM-STEEL', keywords: ['สต็อก', 'เช็คสต็อก', 'ของเหลือ', 'stock'], screen: 'stockCard', perm: 'inventory.stock.read',
      arg: { lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } }, openId: 'id' } },
    { id: 'receive', label: 'รับของเข้าคลัง', example: 'รับของ', keywords: ['รับของ', 'รับเข้า', 'receive'], screen: 'receipt', perm: 'inventory.move.write' },
    { id: 'issue', label: 'เบิก/จ่ายของออก', example: 'เบิกของ', keywords: ['เบิกของ', 'จ่ายของ', 'เบิกวัตถุดิบ', 'issue'], screen: 'issue', perm: 'inventory.move.write' },
  ],
  screens: {
    balances: {
      kind: 'list', title: 'ยอดคงเหลือ', endpoint: '/balances', perm: 'inventory.stock.read', mobile: true,
      filters: [{ ...wh('warehouseCode', 'คลัง'), required: false }],
      columns: [
        { key: 'itemCode', label: 'รหัส' }, { key: 'itemName', label: 'ชื่อ' },
        { key: 'warehouseCode', label: 'คลัง' }, { key: 'onHand', label: 'คงเหลือ', format: 'qty' },
        { key: 'available', label: 'พร้อมใช้', format: 'qty' }, { key: 'isHold', label: 'คลังกักกัน', format: 'boolean' },
      ],
      rowLink: { screen: 'stockCard', idFrom: 'itemId' },
      empty: 'ยังไม่มีสต็อก นำเข้ายอดยกมาจาก Excel หรือบันทึกรับเข้าครั้งแรกเพื่อเริ่มต้น',
      // ยอดยกมา: stock counted on the first day, from the old Excel sheet (item codes resolved through master-data)
      import: {
        endpoint: '/opening/import', perm: 'inventory.move.write', template: 'แบบฟอร์มยอดสต็อกยกมา.csv',
        note: 'ยอดยกมา = จำนวนที่นับได้ ณ วันเริ่มใช้ระบบ ใส่ได้ครั้งเดียวต่อสินค้าต่อคลัง (แก้ภายหลังด้วย "ปรับปรุงยอด") · สินค้าและคลังต้องมีในระบบก่อน',
        columns: [
          { key: 'itemCode', label: 'รหัสสินค้า', required: true }, { key: 'warehouseCode', label: 'รหัสคลัง', required: true },
          { key: 'qty', label: 'จำนวนคงเหลือ', required: true }, { key: 'unitCost', label: 'ต้นทุนต่อหน่วย' },
        ],
        resolve: { module: 'master-data', endpoint: '/items/resolve', column: 'itemCode', into: { itemId: 'id', itemName: 'name' } },
      },
    },
    stockCard: {
      kind: 'list', title: 'สต็อกการ์ด', endpoint: '/items/:itemId/stock-card', perm: 'inventory.stock.read', mobile: true,
      columns: [
        { key: 'at', label: 'เวลา', format: 'datetime' }, { key: 'warehouseCode', label: 'คลัง' }, { key: 'kind', label: 'รายการ', format: 'label' },
        { key: 'qty', label: 'จำนวน', format: 'qty' }, { key: 'balance', label: 'คงเหลือ', format: 'qty' },
        { key: 'refType', label: 'จาก' }, { key: 'refId', label: 'เลขที่อ้างอิง' },
      ],
    },
    receipt: {
      kind: 'form', title: 'รับสินค้าเข้าคลัง', method: 'POST', endpoint: '/receipts', perm: 'inventory.move.write', mobile: true,
      fields: [wh('warehouseCode', 'เข้าคลัง'), ...ref], lines: lines([{ name: 'unitCost', label: 'ต้นทุนต่อหน่วย', type: 'number', format: 'money' }]),
      submitLabel: 'บันทึกรับเข้า', after: { screen: 'balances' },
    },
    issue: {
      kind: 'form', title: 'จ่ายสินค้าออกจากคลัง', method: 'POST', endpoint: '/issues', perm: 'inventory.move.write', mobile: true,
      fields: [wh('warehouseCode', 'จากคลัง'), ...ref], lines: lines(), submitLabel: 'บันทึกจ่ายออก', after: { screen: 'balances' },
    },
    transfer: {
      kind: 'form', title: 'โอนย้ายระหว่างคลัง', method: 'POST', endpoint: '/transfers', perm: 'inventory.move.write',
      fields: [wh('fromWarehouseCode', 'จากคลัง'), wh('toWarehouseCode', 'ไปคลัง'), { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
        { name: 'overrideHoldReason', label: 'เหตุผลบังคับนำออกจากคลังกักกัน (เฉพาะผู้ดูแลระบบ)', type: 'textarea',
        help: 'ของในคลังกักกัน QC ออกได้ทาง "ปล่อยเข้าคลัง" ในหน้ากักกัน QC หรือ "ส่งคืนผู้ขาย" เท่านั้น · ช่องนี้ใช้เมื่อผู้มีสิทธิ์บังคับจ่ายออกต้องนำออกนอกขั้นตอน — เหตุผลถูกบันทึกในสต็อกการ์ดและประวัติการกักกัน' }],
      lines: lines(), submitLabel: 'บันทึกการโอน', after: { screen: 'balances' },
    },
    adjust: {
      kind: 'form', title: 'ปรับปรุงยอดสต็อก', method: 'POST', endpoint: '/adjustments', perm: 'inventory.move.write',
      fields: [wh('warehouseCode', 'คลัง'), { name: 'note', label: 'เหตุผล', type: 'textarea', required: true },
        { name: 'overrideHoldReason', label: 'เหตุผลบังคับนำออกจากคลังกักกัน (เฉพาะผู้ดูแลระบบ)', type: 'textarea',
        help: 'ของในคลังกักกัน QC ออกได้ทาง "ปล่อยเข้าคลัง" ในหน้ากักกัน QC หรือ "ส่งคืนผู้ขาย" เท่านั้น · ช่องนี้ใช้เมื่อผู้มีสิทธิ์บังคับจ่ายออกต้องนำออกนอกขั้นตอน — เหตุผลถูกบันทึกในสต็อกการ์ดและประวัติการกักกัน' }],
      lines: { name: 'lines', label: 'รายการ', min: 1, fields: [item, { ...qty, label: 'ปรับ (+ เพิ่ม / − ลด)' }] },
      submitLabel: 'บันทึกการปรับปรุง', after: { screen: 'balances' },
    },
    reorder: {
      kind: 'list', title: 'จุดสั่งซื้อ (สต็อกขั้นต่ำ)', endpoint: '/reorder-points', perm: 'inventory.stock.read',
      columns: [{ key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'warehouse_code', label: 'คลัง' }, { key: 'min_qty', label: 'ขั้นต่ำ', format: 'qty' }],
      create: 'reorderSet', createLabel: 'ตั้งจุดสั่งซื้อ', empty: 'ยังไม่ได้ตั้งจุดสั่งซื้อ ตั้งไว้แล้วระบบจะเตือนเมื่อของใกล้หมด',
    },
    reorderSet: {
      kind: 'form', title: 'ตั้งจุดสั่งซื้อ', method: 'PUT', endpoint: '/reorder-points', perm: 'inventory.settings.write',
      fields: [item, wh('warehouseCode', 'คลัง'), { name: 'minQty', label: 'สต็อกขั้นต่ำ', type: 'number', format: 'qty', required: true }],
      submitLabel: 'บันทึกจุดสั่งซื้อ', after: { screen: 'reorder' },
    },
    holds: {
      kind: 'list', title: 'กักกัน QC (QC-HOLD)', endpoint: '/holds', perm: 'inventory.stock.read', mobile: true,
      filters: [{ name: 'status', label: 'สถานะ', type: 'select', options: [
        { value: 'pending,rejected', label: 'ยังกักอยู่' }, { value: 'pending', label: 'รอผล QC' }, { value: 'rejected', label: 'ไม่ผ่าน รอตัดสิน' },
        { value: 'released', label: 'ปล่อยแล้ว' }, { value: 'returned', label: 'ส่งคืนผู้ขายแล้ว' }, { value: 'forced_out', label: 'ถูกจ่ายออกนอกขั้นตอน' }] }],
      columns: [
        { key: 'inspection_no', label: 'ใบตรวจ QC' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' },
        { key: 'source_ref', label: 'จากเอกสาร' }, { key: 'warehouse_code', label: 'คลังเดิม' }, { key: 'qty', label: 'กักอยู่', format: 'qty' },
        { key: 'held_qty', label: 'กักทั้งหมด', format: 'qty' }, { key: 'hold_on_hand', label: 'คงเหลือในคลังกักกัน (สินค้านี้)', format: 'qty' },
        { key: 'status_th', label: 'สถานะ' }, { key: 'created_at', label: 'เมื่อ', format: 'datetime' },
      ],
      rowLink: { screen: 'holdDetail' },
      rowActions: [
        { id: 'release', label: 'ปล่อยเข้าคลัง', method: 'POST', endpoint: '/holds/:id/release', perm: 'inventory.hold.release', when: { field: 'status', in: ['pending', 'rejected'] },
          fields: [
            { name: 'qty', label: 'จำนวนที่ปล่อย (ว่าง = ทั้งหมด)', type: 'number', format: 'qty' },
            { name: 'toWarehouseCode', label: 'ปล่อยเข้าคลัง (ว่าง = คลังเดิม)', type: 'text' },
            { name: 'note', label: 'เหตุผล/ผลการตัดสิน (เช่น ใช้ตามสภาพ อนุมัติโดย MRB, คัดแยกแล้ว)', type: 'textarea', required: true },
          ] },
      ],
      empty: 'ไม่มีของในคลังกักกัน — เมื่อ QC ตรวจไม่ผ่าน ของจะถูกย้ายมาที่นี่อัตโนมัติ',
    },
    holdDetail: {
      kind: 'detail', title: 'รายการกักกัน QC', endpoint: '/holds/:id', perm: 'inventory.stock.read', heading: 'inspection_no', mobile: true,
      fields: [
        { key: 'status_th', label: 'สถานะ' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' }, { key: 'source_ref', label: 'จากเอกสาร' },
        { key: 'warehouse_code', label: 'คลังเดิม' }, { key: 'hold_warehouse_code', label: 'คลังกักกัน' }, { key: 'held_qty', label: 'กักทั้งหมด', format: 'qty' },
        { key: 'rejected_qty', label: 'QC ปฏิเสธ', format: 'qty' }, { key: 'qty', label: 'ยังกักอยู่', format: 'qty' }, { key: 'note', label: 'บันทึก' },
      ],
      lines: [{ path: 'log', label: 'ประวัติการนำออกจากคลังกักกัน', columns: [
        { key: 'created_at', label: 'เมื่อ', format: 'datetime' }, { key: 'kind_th', label: 'การดำเนินการ' }, { key: 'qty', label: 'จำนวน', format: 'qty' },
        { key: 'qty_after', label: 'กักเหลือ', format: 'qty' }, { key: 'ref_id', label: 'เอกสาร' }, { key: 'note', label: 'เหตุผล' }, { key: 'user_name', label: 'โดย' },
      ] }],
      actions: [
        { id: 'release', label: 'ปล่อยเข้าคลัง', method: 'POST', endpoint: '/holds/:id/release', perm: 'inventory.hold.release', when: { field: 'status', in: ['pending', 'rejected'] }, tone: 'primary', mobile: true,
          fields: [
            { name: 'qty', label: 'จำนวนที่ปล่อย (ว่าง = ทั้งหมด)', type: 'number', format: 'qty' },
            { name: 'toWarehouseCode', label: 'ปล่อยเข้าคลัง (ว่าง = คลังเดิม)', type: 'text' },
            { name: 'note', label: 'เหตุผล/ผลการตัดสิน (เช่น ใช้ตามสภาพ อนุมัติโดย MRB, คัดแยกแล้ว)', type: 'textarea', required: true },
          ] },
      ],
    },
    anomalies: {
      kind: 'list', title: 'สต็อกติดลบ/ผิดปกติ', endpoint: '/anomalies', perm: 'inventory.stock.read', mobile: true,
      filters: [{ name: 'open', label: 'สถานะ', type: 'select', default: 'true', options: [{ value: 'true', label: 'รอตรวจสอบ' }, { value: 'false', label: 'รับทราบแล้ว' }] }],
      columns: [
        { key: 'created_at', label: 'เมื่อ', format: 'datetime' }, { key: 'item_code', label: 'รหัส' }, { key: 'item_name', label: 'ชื่อ' },
        { key: 'warehouse_code', label: 'คลัง' }, { key: 'qty_delta', label: 'จ่าย', format: 'qty' }, { key: 'on_hand_before', label: 'ก่อนจ่าย', format: 'qty' },
        { key: 'on_hand_after', label: 'หลังจ่าย', format: 'qty' }, { key: 'on_hand_now', label: 'คงเหลือตอนนี้', format: 'qty' },
        { key: 'ref_th', label: 'จาก' }, { key: 'ref_id', label: 'เลขที่อ้างอิง' }, { key: 'acknowledged_note', label: 'บันทึกการตรวจสอบ' },
      ],
      rowLink: { screen: 'stockCard', idFrom: 'item_id' },
      rowActions: [
        { id: 'ack', label: 'รับทราบ', method: 'POST', endpoint: '/anomalies/:id/acknowledge', perm: 'inventory.settings.write', when: { field: 'acknowledged_at', in: [null] },
          fields: [{ name: 'note', label: 'ตรวจสอบแล้ว: สาเหตุ/สิ่งที่แก้ (เช่น ปรับยอดตามนับจริง, เลือกคลังผิด โอนกลับแล้ว)', type: 'textarea', required: true }] },
      ],
      empty: 'ไม่มีรายการสต็อกติดลบ',
    },
    warehouses: {
      kind: 'list', title: 'คลัง', endpoint: '/warehouses', perm: 'inventory.stock.read',
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อ' }, { key: 'is_hold', label: 'คลังกักกัน (ไม่นับพร้อมใช้)', format: 'boolean' }],
      create: 'warehouseNew', createLabel: 'เพิ่มคลัง', empty: 'ยังไม่มีคลัง เพิ่มคลังแรก เช่น MAIN',
    },
    warehouseNew: {
      kind: 'form', title: 'เพิ่มคลัง', method: 'POST', endpoint: '/warehouses', perm: 'inventory.settings.write',
      fields: [
        { name: 'code', label: 'รหัส', type: 'text', required: true }, { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'isHold', label: 'เป็นคลังกักกัน (ของในคลังนี้ไม่นับเป็นพร้อมใช้ จ่าย/โอนออกต้องมีสิทธิ์ปล่อยของ)', type: 'boolean' },
      ],
      submitLabel: 'บันทึกคลัง', after: { screen: 'warehouses' },
    },
    settings: {
      kind: 'form', title: 'ตั้งค่าคลัง', method: 'PUT', endpoint: '/settings', perm: 'inventory.settings.write', load: '/settings',
      fields: [
        { name: 'allowNegative', label: 'อนุญาตให้สต็อกติดลบเมื่อจ่ายออก', type: 'boolean',
          help: 'ปิดไว้ (แนะนำ) = จ่าย/โอนเกินยอดคงเหลือไม่ได้ · รายการที่มาจากโมดูลอื่น (ส่งของ ผลิต ซ่อม) ยังบันทึกได้ แต่จะขึ้นในรายการ "สต็อกติดลบ/ผิดปกติ"' },
        { name: 'receiveIntoHoldWhenInspected', label: 'ของรับเข้าที่ต้องตรวจ QC ให้เข้าคลังกักกัน (QC-HOLD) ก่อน', type: 'boolean',
          help: 'เมื่อ QC ตรวจเสร็จ จำนวนที่ผ่านจะถูกปล่อยกลับเข้าคลังรับเข้าอัตโนมัติ ส่วนที่ไม่ผ่านอยู่ในคลังกักกันจนกว่าจะส่งคืน/ตัดสิน' },
      ],
      submitLabel: 'บันทึกการตั้งค่า', after: { screen: 'balances' },
    },
  },
  widgets: [
    { id: 'stock-negative-kpi', kind: 'kpi', title: 'สต็อกผิดปกติ', endpoint: '/summary', perm: 'inventory.stock.read', size: 'sm', href: 'anomalies',
      items: [{ key: 'negative', label: 'สต็อกติดลบ', format: 'number', tone: 'stop' }, { key: 'onHold', label: 'รายการในคลังกักกัน QC', format: 'number', tone: 'warn' },
        { key: 'openAnomalies', label: 'รายการผิดปกติรอตรวจ', format: 'number', tone: 'warn' }] },
    { id: 'stock-negative-bars', kind: 'bars', title: 'สต็อกติดลบ (ขาดกี่หน่วย)', endpoint: '/summary', perm: 'inventory.stock.read', size: 'md', href: 'anomalies',
      rows: 'negativeRows', label: 'label', value: 'shortQty', format: 'qty' },
    { id: 'stock-kpi', kind: 'kpi', title: 'คลังสินค้า', endpoint: '/summary', perm: 'inventory.stock.read', size: 'sm', href: 'balances',
      items: [{ key: 'skus', label: 'รายการในคลัง', format: 'number' }, { key: 'lowStock', label: 'ต่ำกว่าจุดสั่งซื้อ', format: 'number', tone: 'warn' }, { key: 'movesToday', label: 'เคลื่อนไหววันนี้', format: 'number' }] },
    { id: 'stock-bars', kind: 'bars', title: 'ระดับสต็อกเทียบจุดสั่งซื้อ', endpoint: '/summary', perm: 'inventory.stock.read', size: 'md', href: 'balances',
      rows: 'rows', label: 'itemCode', value: 'onHand', threshold: 'minQty', format: 'qty' },
  ],
});
