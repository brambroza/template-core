import { defineUi, type Action, type Field } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const assetStatuses = [
  { value: 'in_use', label: 'ใช้งานอยู่' }, { value: 'in_storage', label: 'เก็บในคลัง' }, { value: 'in_repair', label: 'ส่งซ่อม' },
  { value: 'lost', label: 'สูญหาย' }, { value: 'disposed', label: 'ตัดจำหน่ายแล้ว' },
];
const methods = [{ value: 'straight_line', label: 'เส้นตรง (รายเดือน)' }, { value: 'none', label: 'ไม่คิดค่าเสื่อม (เช่น ที่ดิน)' }];
const disposalMethods = [{ value: 'sold', label: 'ขาย' }, { value: 'scrapped', label: 'ทำลาย/ขายซาก' }, { value: 'donated', label: 'บริจาค' }];
const yesNo = [{ value: 'true', label: 'ใช่' }, { value: 'false', label: 'ไม่ใช่' }];

const assetLookup = (name: string, target = 'id'): Field => ({
  name, label: 'ทรัพย์สิน', type: 'lookup', required: true,
  lookup: { path: '/assets', query: { active: 'true' }, label: ['code', 'name'], assign: { [name]: target }, scanField: 'code' },
});
const custodian: Field = {
  name: 'custodianId', label: 'ผู้ถือครอง', type: 'lookup',
  lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { custodianId: 'id', custodianName: 'name' } },
};
const repairFields: Field[] = [
  { name: 'description', label: 'อาการ/งานซ่อม', type: 'textarea', required: true },
  { name: 'repairDate', label: 'วันที่', type: 'date' },
  { name: 'vendor', label: 'ร้าน/ช่างที่ซ่อม', type: 'text' },
  { name: 'cost', label: 'ค่าซ่อม (บาท)', type: 'number', step: 0.01 },
  { name: 'completed', label: 'ซ่อมเสร็จแล้ว (บันทึกย้อนหลัง)', type: 'boolean', help: 'ไม่ติ๊ก = ทรัพย์สินเปลี่ยนเป็น "ส่งซ่อม" จนกว่าจะปิดงานซ่อม' },
];
const completeRepair: Action = {
  id: 'complete', label: 'ซ่อมเสร็จ', method: 'POST', endpoint: '/repairs/:id/complete', perm: 'assets.repair.report', when: { field: 'status', in: ['open'] }, tone: 'primary', mobile: true,
  fields: [{ name: 'cost', label: 'ค่าซ่อม (บาท)', type: 'number', step: 0.01 }, { name: 'completedOn', label: 'วันที่ซ่อมเสร็จ', type: 'date' }, { name: 'vendor', label: 'ร้าน/ช่างที่ซ่อม', type: 'text' }],
};

const assetColumns = [
  { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ทรัพย์สิน' }, { key: 'category_name', label: 'หมวด' }, { key: 'location', label: 'ที่ตั้ง' },
  { key: 'custodian_name', label: 'ผู้ถือครอง' }, { key: 'status', label: 'สถานะ', format: 'status' as const },
  { key: 'cost', label: 'ราคาทุน', format: 'money' as const }, { key: 'book_value', label: 'มูลค่าตามบัญชี', format: 'money' as const },
];

export default defineUi({
  module: 'assets',
  label: 'ทรัพย์สิน',
  glyph: 'ท',
  icon: 'package',
  menu: [
    { label: 'ทะเบียนทรัพย์สิน', screen: 'assetList' },
    { label: 'สแกน/ค้นหา', screen: 'assetScan' },
    { label: 'งานซ่อม', screen: 'repairList' },
    { label: 'ตรวจนับ', screen: 'auditList' },
    { label: 'ค่าเสื่อมรายเดือน', screen: 'depreciationReport' },
    { label: 'ค่าเสื่อมตามหมวด', screen: 'depreciationByCategory' },
    { label: 'หมวดทรัพย์สิน', screen: 'categoryList' },
  ],
  commands: [
    { id: 'open', label: 'เปิดทรัพย์สิน', example: 'ทรัพย์สิน AS-2569-0001', keywords: ['ทรัพย์สิน', 'asset'], screen: 'assetDetail', perm: 'assets.asset.read',
      arg: { lookup: { path: '/assets', label: ['code', 'name', 'serial_no'], assign: { id: 'id' } }, openId: 'id' } },
    { id: 'audit', label: 'ตรวจนับทรัพย์สิน', example: 'ตรวจนับ', keywords: ['ตรวจนับ', 'ตรวจนับทรัพย์สิน', 'audit'], screen: 'auditList', perm: 'assets.asset.read' },
    { id: 'repair', label: 'แจ้งซ่อมทรัพย์สิน', example: 'ซ่อมทรัพย์สิน AS-2569-0001 จอไม่ติด', keywords: ['ซ่อมทรัพย์สิน', 'แจ้งซ่อมทรัพย์สิน'], screen: 'repairNew', perm: 'assets.repair.report',
      arg: { lookup: { path: '/assets', query: { active: 'true' }, label: ['code', 'name'], assign: { assetId: 'id' } } }, restField: 'description' },
    { id: 'schedule', label: 'ตารางค่าเสื่อมของทรัพย์สิน', example: 'ค่าเสื่อม AS-2569-0001', keywords: ['ค่าเสื่อม', 'ตารางค่าเสื่อม'], screen: 'assetSchedule', perm: 'assets.asset.read',
      arg: { lookup: { path: '/assets', label: ['code', 'name'], assign: { id: 'id' } }, openId: 'id' } },
  ],
  search: [
    { id: 'assets', title: 'ทรัพย์สิน', endpoint: '/assets', label: ['code', 'name', 'serial_no', 'custodian_name'], screen: 'assetDetail', perm: 'assets.asset.read' },
    { id: 'audits', title: 'รอบตรวจนับ', endpoint: '/audits', label: ['no', 'location'], screen: 'auditDetail', perm: 'assets.asset.read' },
  ],
  screens: {
    /* ---------- register ---------- */
    assetList: {
      kind: 'list', title: 'ทะเบียนทรัพย์สิน', endpoint: '/assets', perm: 'assets.asset.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหารหัส ชื่อ S/N หรือผู้ถือครอง', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: assetStatuses },
        { name: 'location', label: 'ที่ตั้ง', type: 'text' },
        { name: 'warrantyExpiring', label: 'ประกันหมดใน 30 วัน', type: 'select', options: yesNo },
      ],
      columns: assetColumns,
      create: 'assetNew', createLabel: 'ลงทะเบียนทรัพย์สิน', rowLink: { screen: 'assetDetail' }, empty: 'ยังไม่มีทรัพย์สิน',
    },
    assetScan: {
      kind: 'list', title: 'สแกน QR / ค้นหาทรัพย์สิน', endpoint: '/assets', perm: 'assets.asset.read', mobile: true,
      filters: [{ name: 'q', label: 'สแกน QR หรือพิมพ์รหัส', type: 'lookup', lookup: { path: '/assets', label: ['code', 'name'], assign: { q: 'code' }, scanField: 'code' } }],
      columns: [{ key: 'code', label: 'รหัส' }, { key: 'name', label: 'ทรัพย์สิน' }, { key: 'location', label: 'ที่ตั้ง' }, { key: 'custodian_name', label: 'ผู้ถือครอง' }, { key: 'status', label: 'สถานะ', format: 'status' }],
      rowLink: { screen: 'assetDetail' }, empty: 'สแกน QR บนทรัพย์สินเพื่อดูรายละเอียด',
    },
    assetNew: {
      kind: 'form', title: 'ลงทะเบียนทรัพย์สิน', method: 'POST', endpoint: '/assets', perm: 'assets.asset.write',
      fields: [
        { name: 'code', label: 'รหัสทรัพย์สิน', type: 'text', help: 'เว้นว่าง = ออกเลขให้อัตโนมัติ (AS-2569-0001) ใช้พิมพ์ QR' },
        { name: 'name', label: 'ชื่อทรัพย์สิน', type: 'text', required: true },
        { name: 'categoryId', label: 'หมวด', type: 'lookup', required: true, lookup: { path: '/categories', label: ['code', 'name'], assign: { categoryId: 'id' } } },
        { name: 'serialNo', label: 'Serial No.', type: 'text' },
        { name: 'brand', label: 'ยี่ห้อ', type: 'text' },
        { name: 'model', label: 'รุ่น', type: 'text' },
        { name: 'location', label: 'ที่ตั้ง', type: 'text' },
        custodian,
        { name: 'purchaseDate', label: 'วันที่ซื้อ', type: 'date', required: true },
        { name: 'cost', label: 'ราคาทุน (บาท)', type: 'number', step: 0.01, required: true },
        { name: 'salvageValue', label: 'มูลค่าซาก (บาท)', type: 'number', step: 0.01, help: 'เว้นว่าง = ตาม % ของหมวด' },
        { name: 'usefulLifeYears', label: 'อายุการใช้งาน (ปี)', type: 'number', help: 'เว้นว่าง = ตามหมวด' },
        { name: 'supplierName', label: 'ผู้ขาย', type: 'text' },
        { name: 'warrantyUntil', label: 'ประกันถึง', type: 'date' },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'บันทึกทรัพย์สิน', after: { screen: 'assetDetail', idFrom: 'id' },
    },
    assetEdit: {
      kind: 'form', title: 'แก้ไขทรัพย์สิน', method: 'PATCH', endpoint: '/assets/:id', load: '/assets/:id', perm: 'assets.asset.write',
      fields: [
        { name: 'name', label: 'ชื่อทรัพย์สิน', type: 'text', required: true },
        { name: 'serialNo', label: 'Serial No.', type: 'text' },
        { name: 'brand', label: 'ยี่ห้อ', type: 'text' },
        { name: 'model', label: 'รุ่น', type: 'text' },
        { name: 'supplierName', label: 'ผู้ขาย', type: 'text' },
        { name: 'warrantyUntil', label: 'ประกันถึง', type: 'date' },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'assetDetail', idFrom: 'id' },
    },
    assetDetail: {
      kind: 'detail', title: 'ทรัพย์สิน', endpoint: '/assets/:id', perm: 'assets.asset.read', heading: 'code', mobile: true, printable: true, edit: 'assetEdit',
      fields: [
        { key: 'code', label: 'QR', format: 'qr' }, { key: 'name', label: 'ชื่อ' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'category_name', label: 'หมวด' }, { key: 'serial_no', label: 'Serial No.' }, { key: 'brand', label: 'ยี่ห้อ' }, { key: 'model', label: 'รุ่น' },
        { key: 'location', label: 'ที่ตั้ง' }, { key: 'custodian_name', label: 'ผู้ถือครอง' },
        { key: 'purchase_date', label: 'วันที่ซื้อ', format: 'date' }, { key: 'supplier_name', label: 'ผู้ขาย' },
        { key: 'warranty_until', label: 'ประกันถึง', format: 'date' }, { key: 'warranty_active', label: 'อยู่ในประกัน', format: 'boolean' },
        { key: 'cost', label: 'ราคาทุน', format: 'money' }, { key: 'salvage_value', label: 'มูลค่าซาก', format: 'money' },
        { key: 'useful_life_years', label: 'อายุการใช้งาน (ปี)', format: 'qty' }, { key: 'monthly_depreciation', label: 'ค่าเสื่อม/เดือน', format: 'money' },
        { key: 'accumulated', label: 'ค่าเสื่อมสะสม', format: 'money' }, { key: 'book_value', label: 'มูลค่าตามบัญชี', format: 'money' },
        { key: 'months_left', label: 'เหลืออีก (เดือน)', format: 'qty' }, { key: 'repair_cost_total', label: 'ค่าซ่อมสะสม', format: 'money' },
        { key: 'disposed_on', label: 'วันที่ตัดจำหน่าย', format: 'date' }, { key: 'disposal_method', label: 'วิธีตัดจำหน่าย', format: 'label' },
        { key: 'disposal_price', label: 'ราคาขาย', format: 'money' }, { key: 'disposal_book_value', label: 'มูลค่าตามบัญชี ณ วันตัดจำหน่าย', format: 'money' },
        { key: 'disposal_gain_loss', label: 'กำไร(ขาดทุน)จากการจำหน่าย', format: 'money' }, { key: 'lost_on', label: 'แจ้งสูญหายเมื่อ', format: 'date' },
        { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [
        { path: 'assignments', label: 'ประวัติผู้ถือครอง/ย้ายที่', columns: [
          { key: 'assigned_on', label: 'วันที่', format: 'date' }, { key: 'custodian_name', label: 'ผู้ถือครอง' }, { key: 'location', label: 'ที่ตั้ง' }, { key: 'note', label: 'หมายเหตุ' },
        ] },
        { path: 'repairs', label: 'ประวัติการซ่อม', columns: [
          { key: 'repair_date', label: 'วันที่', format: 'date' }, { key: 'description', label: 'อาการ/งาน' }, { key: 'vendor', label: 'ร้าน/ช่าง' },
          { key: 'cost', label: 'ค่าซ่อม', format: 'money' }, { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'completed_on', label: 'เสร็จเมื่อ', format: 'date' },
        ] },
      ],
      actions: [
        { id: 'assign', label: 'โอน/เปลี่ยนผู้ถือครอง', method: 'POST', endpoint: '/assets/:id/assign', perm: 'assets.asset.write', when: { field: 'status', in: ['in_use', 'in_storage', 'in_repair', 'lost'] }, tone: 'primary', mobile: true,
          fields: [custodian, { name: 'location', label: 'ที่ตั้งใหม่', type: 'text' }, { name: 'assignedOn', label: 'วันที่', type: 'date' }, { name: 'note', label: 'หมายเหตุ', type: 'text', help: 'ไม่เลือกผู้ถือครอง = คืนเข้าคลัง' }] },
        { id: 'repair', label: 'แจ้งซ่อม', method: 'POST', endpoint: '/assets/:id/repairs', perm: 'assets.repair.report', when: { field: 'status', in: ['in_use', 'in_storage', 'in_repair'] }, mobile: true, fields: repairFields },
        { id: 'dispose', label: 'ตัดจำหน่าย', method: 'POST', endpoint: '/assets/:id/dispose', perm: 'assets.asset.dispose', when: { field: 'status', in: ['in_use', 'in_storage', 'in_repair', 'lost'] }, tone: 'danger',
          confirm: 'คิดค่าเสื่อมถึงเดือนที่ตัดจำหน่าย แล้วบันทึกกำไร/ขาดทุนเทียบมูลค่าตามบัญชี — ย้อนกลับไม่ได้',
          fields: [
            { name: 'disposedOn', label: 'วันที่ตัดจำหน่าย', type: 'date', required: true },
            { name: 'method', label: 'วิธี', type: 'select', required: true, options: disposalMethods },
            { name: 'price', label: 'ราคาขาย (บาท)', type: 'number', step: 0.01, default: 0 },
            { name: 'note', label: 'หมายเหตุ', type: 'text' },
          ] },
      ],
    },
    assetSchedule: {
      kind: 'detail', title: 'ตารางค่าเสื่อมราคา', endpoint: '/assets/:id/schedule', perm: 'assets.asset.read', heading: 'code', printable: true,
      fields: [
        { key: 'name', label: 'ทรัพย์สิน' }, { key: 'category_name', label: 'หมวด' }, { key: 'method', label: 'วิธี', format: 'label' },
        { key: 'purchase_date', label: 'วันที่ซื้อ', format: 'date' }, { key: 'cost', label: 'ราคาทุน', format: 'money' }, { key: 'salvage_value', label: 'มูลค่าซาก', format: 'money' },
        { key: 'useful_life_years', label: 'อายุการใช้งาน (ปี)', format: 'qty' }, { key: 'monthly_depreciation', label: 'ค่าเสื่อม/เดือน', format: 'money' },
        { key: 'as_of', label: 'ณ วันที่', format: 'date' }, { key: 'accumulated', label: 'ค่าเสื่อมสะสม', format: 'money' }, { key: 'book_value', label: 'มูลค่าตามบัญชี', format: 'money' },
      ],
      lines: [{ path: 'rows', label: 'รายเดือน', columns: [
        { key: 'period', label: 'เดือน', format: 'month' }, { key: 'depreciation', label: 'ค่าเสื่อม', format: 'money' },
        { key: 'accumulated', label: 'ค่าเสื่อมสะสม', format: 'money' }, { key: 'book_value', label: 'มูลค่าคงเหลือ', format: 'money' },
      ] }],
    },

    /* ---------- categories ---------- */
    categoryList: {
      kind: 'list', title: 'หมวดทรัพย์สิน', endpoint: '/categories', perm: 'assets.asset.read',
      filters: [{ name: 'q', label: 'ค้นหา', type: 'text' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'หมวด' }, { key: 'useful_life_years', label: 'อายุ (ปี)', format: 'qty' },
        { key: 'method', label: 'วิธีคิดค่าเสื่อม', format: 'label' }, { key: 'salvage_pct', label: 'มูลค่าซาก', format: 'percent' }, { key: 'asset_count', label: 'จำนวนทรัพย์สิน', format: 'qty' },
      ],
      create: 'categoryNew', createLabel: 'เพิ่มหมวด', rowLink: { screen: 'categoryEdit' }, empty: 'ยังไม่มีหมวด — เช่น คอมพิวเตอร์ 3 ปี, เครื่องจักร 10 ปี, ยานพาหนะ 5 ปี',
    },
    categoryNew: {
      kind: 'form', title: 'เพิ่มหมวดทรัพย์สิน', method: 'POST', endpoint: '/categories', perm: 'assets.asset.write',
      fields: [
        { name: 'code', label: 'รหัส', type: 'text', required: true },
        { name: 'name', label: 'ชื่อหมวด', type: 'text', required: true },
        { name: 'usefulLifeYears', label: 'อายุการใช้งาน (ปี)', type: 'number', default: 5, required: true },
        { name: 'method', label: 'วิธีคิดค่าเสื่อม', type: 'select', options: methods, default: 'straight_line' },
        { name: 'salvagePct', label: 'มูลค่าซาก (% ของราคาทุน)', type: 'number', step: 0.01, default: 0 },
      ],
      submitLabel: 'บันทึกหมวด', after: { screen: 'categoryList' },
    },
    categoryEdit: {
      kind: 'form', title: 'แก้ไขหมวดทรัพย์สิน', method: 'PATCH', endpoint: '/categories/:id', load: '/categories/:id', perm: 'assets.asset.write',
      fields: [
        { name: 'name', label: 'ชื่อหมวด', type: 'text', required: true },
        { name: 'usefulLifeYears', label: 'อายุการใช้งาน (ปี) — ใช้กับทรัพย์สินที่ลงทะเบียนหลังจากนี้', type: 'number' },
        { name: 'method', label: 'วิธีคิดค่าเสื่อม', type: 'select', options: methods },
        { name: 'salvagePct', label: 'มูลค่าซาก (% ของราคาทุน)', type: 'number', step: 0.01 },
      ],
      submitLabel: 'บันทึกการแก้ไข', after: { screen: 'categoryList' },
    },

    /* ---------- repairs ---------- */
    repairList: {
      kind: 'list', title: 'งานซ่อมทรัพย์สิน', endpoint: '/repairs', perm: 'assets.asset.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาทรัพย์สิน อาการ หรือร้าน', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'open', label: 'กำลังซ่อม' }, { value: 'done', label: 'เสร็จแล้ว' }] }],
      columns: [
        { key: 'repair_date', label: 'วันที่', format: 'date' }, { key: 'asset_code', label: 'รหัส' }, { key: 'asset_name', label: 'ทรัพย์สิน' },
        { key: 'description', label: 'อาการ/งาน' }, { key: 'vendor', label: 'ร้าน/ช่าง' }, { key: 'cost', label: 'ค่าซ่อม', format: 'money' }, { key: 'status', label: 'สถานะ', format: 'status' },
      ],
      create: 'repairNew', createLabel: 'แจ้งซ่อม', rowLink: { screen: 'assetDetail', idFrom: 'asset_id' }, empty: 'ไม่มีงานซ่อม',
      rowActions: [completeRepair],
    },
    repairNew: {
      kind: 'form', title: 'แจ้งซ่อมทรัพย์สิน', method: 'POST', endpoint: '/repairs', perm: 'assets.repair.report', mobile: true,
      fields: [assetLookup('assetId'), ...repairFields],
      submitLabel: 'แจ้งซ่อม', after: { screen: 'assetDetail', idFrom: 'id' },
    },

    /* ---------- depreciation ---------- */
    depreciationReport: {
      kind: 'list', title: 'รายงานค่าเสื่อมราคารายเดือน', endpoint: '/depreciation', rows: 'rows', perm: 'assets.asset.read',
      filters: [{ name: 'month', label: 'เดือน (YYYY-MM)', type: 'text', help: 'เว้นว่าง = เดือนนี้' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ทรัพย์สิน' }, { key: 'category_name', label: 'หมวด' }, { key: 'purchase_date', label: 'วันที่ซื้อ', format: 'date' },
        { key: 'cost', label: 'ราคาทุน', format: 'money' }, { key: 'depreciation', label: 'ค่าเสื่อมเดือนนี้', format: 'money' },
        { key: 'accumulated', label: 'ค่าเสื่อมสะสม', format: 'money' }, { key: 'book_value', label: 'มูลค่าตามบัญชี', format: 'money' },
      ],
      rowLink: { screen: 'assetSchedule' }, empty: 'ไม่มีทรัพย์สินที่คิดค่าเสื่อมในเดือนนี้',
    },
    depreciationByCategory: {
      kind: 'list', title: 'ค่าเสื่อมราคาตามหมวด', endpoint: '/depreciation', rows: 'byCategory', perm: 'assets.asset.read',
      filters: [{ name: 'month', label: 'เดือน (YYYY-MM)', type: 'text', help: 'เว้นว่าง = เดือนนี้' }],
      columns: [
        { key: 'category_code', label: 'รหัสหมวด' }, { key: 'category_name', label: 'หมวด' }, { key: 'count', label: 'จำนวน', format: 'qty' },
        { key: 'cost', label: 'ราคาทุน', format: 'money' }, { key: 'depreciation', label: 'ค่าเสื่อมเดือนนี้', format: 'money' },
        { key: 'accumulated', label: 'ค่าเสื่อมสะสม', format: 'money' }, { key: 'book_value', label: 'มูลค่าตามบัญชี', format: 'money' },
      ],
      empty: 'ไม่มีข้อมูล',
    },

    /* ---------- physical audit ---------- */
    auditList: {
      kind: 'list', title: 'ตรวจนับทรัพย์สิน', endpoint: '/audits', perm: 'assets.asset.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่หรือที่ตั้ง', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'open', label: 'กำลังนับ' }, { value: 'closed', label: 'ปิดแล้ว' }] }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'location', label: 'ที่ตั้ง' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'expected_count', label: 'ตามทะเบียน', format: 'qty' }, { key: 'found_count', label: 'พบ', format: 'qty' },
        { key: 'missing_count', label: 'ไม่พบ', format: 'qty' }, { key: 'unexpected_count', label: 'เกินมา', format: 'qty' }, { key: 'created_at', label: 'เริ่มเมื่อ', format: 'datetime' },
      ],
      create: 'auditNew', createLabel: 'เริ่มตรวจนับ', rowLink: { screen: 'auditDetail' }, empty: 'ยังไม่มีรอบตรวจนับ',
    },
    auditNew: {
      kind: 'form', title: 'เริ่มตรวจนับทรัพย์สิน', method: 'POST', endpoint: '/audits', perm: 'assets.audit.run', mobile: true,
      fields: [
        { name: 'location', label: 'ที่ตั้งที่จะตรวจนับ', type: 'lookup', required: true, lookup: { path: '/locations', label: ['location'], assign: { location: 'location' } } },
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'เริ่มตรวจนับ', after: { screen: 'auditDetail', idFrom: 'id' },
    },
    auditDetail: {
      kind: 'detail', title: 'ตรวจนับทรัพย์สิน', endpoint: '/audits/:id', perm: 'assets.asset.read', heading: 'no', mobile: true, printable: true,
      flow: { field: 'status', steps: [{ value: 'open', label: 'กำลังนับ' }, { value: 'closed', label: 'ปิดรอบ' }] },
      fields: [
        { key: 'location', label: 'ที่ตั้ง' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'expected_count', label: 'ตามทะเบียน', format: 'qty' }, { key: 'found_count', label: 'พบแล้ว', format: 'qty' },
        { key: 'pending_count', label: 'ยังไม่สแกน', format: 'qty' }, { key: 'missing_count', label: 'ไม่พบ', format: 'qty' },
        { key: 'unexpected_count', label: 'เกินมา/ไม่อยู่ในรายการ', format: 'qty' }, { key: 'lost_count', label: 'ตัดเป็นสูญหายแล้ว', format: 'qty' },
        { key: 'created_at', label: 'เริ่มเมื่อ', format: 'datetime' }, { key: 'closed_at', label: 'ปิดเมื่อ', format: 'datetime' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{ path: 'lines', label: 'รายการ', columns: [
        { key: 'asset_code', label: 'รหัส' }, { key: 'asset_name', label: 'ทรัพย์สิน' }, { key: 'registered_location', label: 'ที่ตั้งในทะเบียน' },
        { key: 'expected', label: 'อยู่ในรายการ', format: 'boolean' }, { key: 'state', label: 'ผล', format: 'status' },
        { key: 'scanned_at', label: 'สแกนเมื่อ', format: 'datetime' }, { key: 'marked_lost', label: 'ตัดเป็นสูญหาย', format: 'boolean' },
      ] }],
      actions: [
        { id: 'scan', label: 'สแกน QR', method: 'POST', endpoint: '/audits/:id/scan', perm: 'assets.audit.run', when: { field: 'status', in: ['open'] }, tone: 'primary', mobile: true, toast: 'message',
          fields: [{ name: 'code', label: 'ทรัพย์สิน', type: 'lookup', required: true, lookup: { path: '/assets', label: ['code', 'name'], assign: { code: 'code' }, scanField: 'code' } }] },
        { id: 'scanCode', label: 'พิมพ์รหัส', method: 'POST', endpoint: '/audits/:id/scan', perm: 'assets.audit.run', when: { field: 'status', in: ['open'] }, mobile: true, toast: 'message',
          fields: [{ name: 'code', label: 'รหัสบนป้าย (รวมรหัสที่ไม่มีในทะเบียน)', type: 'text', required: true }] },
        { id: 'close', label: 'ปิดรอบตรวจนับ', method: 'POST', endpoint: '/audits/:id/close', perm: 'assets.audit.run', when: { field: 'status', in: ['open'] }, confirm: 'รายการที่ยังไม่สแกนจะถูกบันทึกว่า "ไม่พบ"' },
        { id: 'lost', label: 'ตัดรายการที่ไม่พบเป็นสูญหาย', method: 'POST', endpoint: '/audits/:id/mark-lost', perm: 'assets.audit.run', when: { field: 'status', in: ['closed'] }, tone: 'danger', confirm: 'ทรัพย์สินที่ไม่พบทั้งหมดจะเปลี่ยนสถานะเป็นสูญหาย' },
      ],
    },
  },
  widgets: [
    { id: 'as-kpi', kind: 'kpi', title: 'ทรัพย์สิน', endpoint: '/summary', perm: 'assets.asset.read', size: 'md', href: 'assetList',
      items: [
        { key: 'count', label: 'ทรัพย์สินในทะเบียน', format: 'qty' },
        { key: 'bookValue', label: 'มูลค่าตามบัญชี', format: 'money', tone: 'ok' },
        { key: 'inRepair', label: 'ส่งซ่อมอยู่', format: 'qty', tone: 'warn' },
        { key: 'warrantyExpiring30d', label: 'ประกันหมดใน 30 วัน', format: 'qty', tone: 'warn' },
      ] },
    { id: 'as-category', kind: 'bars', title: 'มูลค่าตามบัญชีแยกหมวด', endpoint: '/summary', perm: 'assets.asset.read', size: 'md', href: 'depreciationByCategory',
      rows: 'byCategory', label: 'category', value: 'book_value', format: 'money' },
    { id: 'as-dep', kind: 'trend', title: 'ค่าเสื่อมราคา 6 เดือน', endpoint: '/summary', perm: 'assets.asset.read', size: 'md', href: 'depreciationReport',
      rows: 'months', x: 'month', y: 'depreciation', format: 'money' },
    { id: 'as-feed', kind: 'feed', title: 'ทรัพย์สินที่ต้องดูแล', endpoint: '/summary', perm: 'assets.asset.read', size: 'sm', href: 'repairList',
      rows: 'rows', title2: 'title', body: 'body', time: 'time', level: 'level', link: 'link' },
  ],
});
