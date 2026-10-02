import { defineUi, type Field } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const stageOptions = [
  { value: 'incoming', label: 'ตรวจรับเข้า (Incoming)' },
  { value: 'in_process', label: 'ระหว่างผลิต (In-process)' },
  { value: 'final', label: 'ก่อนส่งมอบ (Final)' },
];
const severityOptions = [{ value: 'minor', label: 'เล็กน้อย' }, { value: 'major', label: 'สำคัญ' }, { value: 'critical', label: 'วิกฤต' }];
const dispositionOptions = [
  { value: 'rework', label: 'แก้ไขงาน (Rework)' }, { value: 'scrap', label: 'ทำลาย (Scrap)' },
  { value: 'use_as_is', label: 'ใช้ได้ตามสภาพ (Use as is)' }, { value: 'return_to_supplier', label: 'ส่งคืนผู้ขาย' },
];
const inspStatusOptions = [
  { value: 'pending', label: 'รอตรวจ' }, { value: 'in_progress', label: 'กำลังตรวจ' },
  { value: 'completed', label: 'ตรวจเสร็จ' }, { value: 'cancelled', label: 'ยกเลิก' },
];
const resultOptions = [{ value: 'pass', label: 'ผ่าน' }, { value: 'conditional', label: 'ผ่านแบบมีเงื่อนไข' }, { value: 'fail', label: 'ไม่ผ่าน' }];
const ncrStatusOptions = [{ value: 'open', label: 'เปิด' }, { value: 'investigating', label: 'กำลังสอบสวน' }, { value: 'action', label: 'กำลังแก้ไข' }, { value: 'closed', label: 'ปิดแล้ว' }];

const item: Field = {
  name: 'itemId', label: 'สินค้า/วัตถุดิบ', type: 'lookup', required: true,
  lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' }, scanField: 'code' },
};
const optionalItem: Field = { ...item, required: false };
const supplier: Field = {
  name: 'supplierId', label: 'ผู้ขาย', type: 'lookup',
  lookup: { module: 'master-data', path: '/partners', query: { kind: 'supplier' }, label: ['code', 'name'], assign: { supplierId: 'id', supplierName: 'name' } },
};
const inspector: Field = {
  name: 'inspectorId', label: 'ผู้ตรวจ', type: 'lookup',
  lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { inspectorId: 'id', inspectorName: 'name' } },
};
const owner: Field = {
  name: 'ownerId', label: 'ผู้รับผิดชอบ', type: 'lookup',
  lookup: { module: 'identity', path: '/users', label: ['name', 'email'], assign: { ownerId: 'id', ownerName: 'name' } },
};
const checkpointFields: Field[] = [
  { name: 'name', label: 'จุดตรวจ', type: 'text', required: true },
  { name: 'method', label: 'วิธีตรวจ/เครื่องมือ', type: 'text' },
  { name: 'type', label: 'ชนิด', type: 'select', default: 'pass_fail', options: [{ value: 'measure', label: 'วัดค่า' }, { value: 'pass_fail', label: 'ผ่าน/ไม่ผ่าน' }, { value: 'visual', label: 'ตรวจด้วยสายตา' }] },
  { name: 'unit', label: 'หน่วย', type: 'text' },
  { name: 'target', label: 'ค่าเป้าหมาย', type: 'number', step: 0.0001 },
  { name: 'min', label: 'ต่ำสุด', type: 'number', step: 0.0001 },
  { name: 'max', label: 'สูงสุด', type: 'number', step: 0.0001 },
  { name: 'critical', label: 'จุดวิกฤต', type: 'boolean' },
];
const resultColumns = [
  { key: 'seq', label: '#' }, { key: 'name', label: 'จุดตรวจ' }, { key: 'method', label: 'วิธีตรวจ' }, { key: 'type_th', label: 'ชนิด' },
  { key: 'spec', label: 'สเปก' }, { key: 'critical_th', label: 'วิกฤต' }, { key: 'value', label: 'ค่าที่วัด', format: 'qty' as const },
  { key: 'passed_th', label: 'ผล' }, { key: 'note', label: 'หมายเหตุ' },
];

export default defineUi({
  module: 'quality',
  label: 'ควบคุมคุณภาพ',
  glyph: 'QC',
  icon: 'shield-check',
  menu: [
    { label: 'งานรอตรวจ', screen: 'queue' },
    { label: 'งานตรวจทั้งหมด', screen: 'inspList' },
    { label: 'NCR', screen: 'ncrList' },
    { label: 'การแก้ไข (CA)', screen: 'caList' },
    { label: 'แผนการตรวจ', screen: 'planList' },
    { label: 'อัตราผ่านรายเดือน', screen: 'passRate' },
    { label: 'ข้อบกพร่องที่พบ', screen: 'defects' },
    { label: 'คุณภาพผู้ขาย', screen: 'suppliers' },
    { label: 'NCR ตามความรุนแรง', screen: 'ncrSeverity' },
  ],
  commands: [
    { id: 'inspect', label: 'สร้างงานตรวจคุณภาพ', example: 'ตรวจ RM-STEEL LOT-2401', keywords: ['ตรวจ', 'ตรวจสอบ', 'qc'], screen: 'inspNew', perm: 'quality.inspection.record',
      arg: { lookup: { module: 'master-data', path: '/items', label: ['code', 'name'], assign: { itemId: 'id', itemCode: 'code', itemName: 'name' } } }, restField: 'lotNo' },
    { id: 'ncr', label: 'ออก NCR (รายงานสิ่งที่ไม่เป็นไปตามข้อกำหนด)', example: 'NCR ชิ้นงานมีรอยร้าว', keywords: ['NCR', 'ของเสีย', 'ไม่เป็นไปตามข้อกำหนด'], screen: 'ncrNew', perm: 'quality.ncr.write', restField: 'description' },
    { id: 'queue', label: 'งานรอตรวจ', example: 'รอตรวจ', keywords: ['รอตรวจ', 'งานตรวจ'], screen: 'queue', perm: 'quality.inspection.read' },
    { id: 'overdue', label: 'การแก้ไขที่ค้าง/เลยกำหนด', example: 'CA ค้าง', keywords: ['CA', 'การแก้ไข', 'แก้ไขค้าง'], screen: 'caList', perm: 'quality.ncr.read' },
  ],
  search: [
    { id: 'inspections', title: 'งานตรวจคุณภาพ', endpoint: '/inspections', label: ['no', 'item_code', 'item_name', 'lot_no', 'source_ref'], screen: 'inspDetail', perm: 'quality.inspection.read' },
    { id: 'ncrs', title: 'NCR', endpoint: '/ncrs', label: ['no', 'item_code', 'description'], screen: 'ncrDetail', perm: 'quality.ncr.read' },
  ],
  screens: {
    /* ----- inspections ----- */
    queue: {
      kind: 'list', title: 'งานรอตรวจ', endpoint: '/inspections/queue', perm: 'quality.inspection.read', mobile: true,
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ สินค้า ล็อต', type: 'text' }, { name: 'stage', label: 'ขั้นตอน', type: 'select', options: stageOptions }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'stage_th', label: 'ขั้นตอน' }, { key: 'item_code', label: 'สินค้า' }, { key: 'item_name', label: 'ชื่อ' },
        { key: 'lot_no', label: 'ล็อต' }, { key: 'source_ref', label: 'อ้างอิง' }, { key: 'qty', label: 'จำนวน', format: 'qty' },
        { key: 'sample_size', label: 'สุ่มตรวจ', format: 'qty' }, { key: 'open_points', label: 'จุดที่ยังไม่ตรวจ', format: 'qty' },
        { key: 'status_th', label: 'สถานะ' }, { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' },
      ],
      create: 'inspNew', createLabel: 'สร้างงานตรวจ', rowLink: { screen: 'inspDetail' },
      rowActions: [
        { id: 'record', label: 'บันทึกผล', method: 'POST', endpoint: '/inspections/:id/start', perm: 'quality.inspection.record', tone: 'primary', then: { screen: 'inspResults', idFrom: 'id' }, mobile: true },
      ],
      empty: 'ไม่มีงานรอตรวจ',
    },
    inspList: {
      kind: 'list', title: 'งานตรวจคุณภาพ', endpoint: '/inspections', perm: 'quality.inspection.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ สินค้า ล็อต ผู้ขาย', type: 'text' },
        { name: 'stage', label: 'ขั้นตอน', type: 'select', options: stageOptions },
        { name: 'status', label: 'สถานะ', type: 'select', options: inspStatusOptions },
        { name: 'result', label: 'ผลตรวจ', type: 'select', options: resultOptions },
        { name: 'from', label: 'ตั้งแต่', type: 'date' }, { name: 'to', label: 'ถึง', type: 'date' },
      ],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'stage_th', label: 'ขั้นตอน' }, { key: 'item_code', label: 'สินค้า' }, { key: 'lot_no', label: 'ล็อต' },
        { key: 'source_ref', label: 'อ้างอิง' }, { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'qty', label: 'จำนวน', format: 'qty' },
        { key: 'status_th', label: 'สถานะ' }, { key: 'result_th', label: 'ผลตรวจ' }, { key: 'failed_points', label: 'จุดไม่ผ่าน', format: 'qty' },
        { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' },
      ],
      create: 'inspNew', createLabel: 'สร้างงานตรวจ', rowLink: { screen: 'inspDetail' }, empty: 'ยังไม่มีงานตรวจ',
    },
    inspNew: {
      kind: 'form', title: 'สร้างงานตรวจคุณภาพ', method: 'POST', endpoint: '/inspections', perm: 'quality.inspection.record', mobile: true,
      fields: [
        { name: 'stage', label: 'ขั้นตอนการตรวจ', type: 'select', required: true, default: 'incoming', options: stageOptions },
        item,
        { name: 'lotNo', label: 'เลขล็อต', type: 'text' },
        { name: 'sourceRef', label: 'อ้างอิง (เลข PO / ใบสั่งผลิต)', type: 'text' },
        { name: 'warehouseCode', label: 'ของอยู่ที่คลัง (ถ้าไม่ผ่าน ระบบย้ายเข้าคลังกักกัน QC-HOLD)', type: 'text' },
        { name: 'qty', label: 'จำนวนทั้งล็อต', type: 'number', required: true },
        { name: 'sampleSize', label: 'จำนวนสุ่มตรวจ (เว้นว่าง = ตามแผน)', type: 'number' },
        supplier, inspector,
        { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
      ],
      submitLabel: 'สร้างงานตรวจ', after: { screen: 'inspDetail', idFrom: 'id' },
    },
    inspDetail: {
      kind: 'detail', title: 'รายงานผลการตรวจคุณภาพ', endpoint: '/inspections/:id', perm: 'quality.inspection.read', heading: 'no', attachments: { entity: 'inspection', label: 'รูปถ่าย / ผลวัด' }, mobile: true,
      print: { title: 'รายงานผลการตรวจคุณภาพ (Inspection Report)', signatures: ['ผู้ตรวจ', 'ผู้ทบทวน', 'ผู้อนุมัติ (QA)'] },
      flow: {
        field: 'status',
        steps: [{ value: 'pending', label: 'รอตรวจ' }, { value: 'in_progress', label: 'กำลังตรวจ' }, { value: 'completed', label: 'ตรวจเสร็จ' }],
        exits: [{ value: 'cancelled', label: 'ยกเลิก' }],
      },
      fields: [
        { key: 'status_th', label: 'สถานะ' }, { key: 'result_th', label: 'ผลตรวจ' }, { key: 'stage_th', label: 'ขั้นตอน' },
        { key: 'item_code', label: 'รหัสสินค้า' }, { key: 'item_name', label: 'ชื่อสินค้า' }, { key: 'lot_no', label: 'ล็อต' },
        { key: 'source_th', label: 'ที่มา' }, { key: 'source_ref', label: 'อ้างอิง' }, { key: 'supplier_name', label: 'ผู้ขาย' },
        { key: 'warehouse_code', label: 'คลัง' }, { key: 'plan_name', label: 'แผนการตรวจ' }, { key: 'qty', label: 'จำนวนทั้งล็อต', format: 'qty' }, { key: 'sample_size', label: 'จำนวนสุ่มตรวจ', format: 'qty' },
        { key: 'recorded_points', label: 'บันทึกผลแล้ว (จุด)', format: 'qty' }, { key: 'failed_points', label: 'ไม่ผ่าน (จุด)', format: 'qty' },
        { key: 'accepted_qty', label: 'รับ', format: 'qty' }, { key: 'rejected_qty', label: 'ปฏิเสธ', format: 'qty' },
        { key: 'inspector_name', label: 'ผู้ตรวจ' }, { key: 'started_at', label: 'เริ่มตรวจ', format: 'datetime' },
        { key: 'completed_at', label: 'ตรวจเสร็จ', format: 'datetime' }, { key: 'ncr_no', label: 'NCR' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{ path: 'results', label: 'ผลการตรวจรายจุด', columns: resultColumns }],
      actions: [
        { id: 'record', label: 'บันทึกผลตรวจ', method: 'POST', endpoint: '/inspections/:id/start', perm: 'quality.inspection.record', when: { field: 'status', in: ['pending', 'in_progress'] },
          tone: 'primary', then: { screen: 'inspResults', idFrom: 'id' }, mobile: true },
        { id: 'assign', label: 'มอบหมายผู้ตรวจ', method: 'POST', endpoint: '/inspections/:id/start', perm: 'quality.inspection.record', when: { field: 'status', in: ['pending', 'in_progress'] },
          fields: [inspector] },
        { id: 'complete', label: 'ปิดงานตรวจ', method: 'POST', endpoint: '/inspections/:id/complete', perm: 'quality.inspection.record', when: { field: 'status', in: ['pending', 'in_progress'] },
          tone: 'primary', mobile: true,
          fields: [
            { name: 'acceptedQty', label: 'จำนวนรับ (เว้นว่าง = ตามผลตรวจ)', type: 'number' },
            { name: 'rejectedQty', label: 'จำนวนปฏิเสธ', type: 'number' },
            { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
          ] },
        { id: 'ncr', label: 'ออก NCR', method: 'POST', endpoint: '/inspections/:id/ncr', perm: 'quality.ncr.write', when: { field: 'result', in: ['fail', 'conditional'] },
          tone: 'danger', mobile: true, then: { screen: 'ncrDetail', idFrom: 'id' },
          fields: [
            { name: 'severity', label: 'ความรุนแรง (เว้นว่าง = ตามผลตรวจ)', type: 'select', options: severityOptions },
            { name: 'disposition', label: 'การจัดการของเสีย', type: 'select', options: dispositionOptions },
            { name: 'qtyAffected', label: 'จำนวนที่ได้รับผลกระทบ', type: 'number' },
            { name: 'description', label: 'รายละเอียด (เว้นว่าง = สรุปจากจุดที่ไม่ผ่าน)', type: 'textarea' },
          ] },
        { id: 'cancel', label: 'ยกเลิกงานตรวจ', method: 'POST', endpoint: '/inspections/:id/cancel', perm: 'quality.inspection.record', when: { field: 'status', in: ['pending', 'in_progress'] },
          tone: 'danger', confirm: 'ยกเลิกงานตรวจนี้?', fields: [{ name: 'reason', label: 'เหตุผล', type: 'text' }] },
      ],
    },
    inspResults: {
      kind: 'list', title: 'บันทึกผลตรวจรายจุด', endpoint: '/inspections/:id/results', perm: 'quality.inspection.read', mobile: true,
      columns: [
        { key: 'name', label: 'จุดตรวจ' }, { key: 'passed_th', label: 'ผล' }, { key: 'spec', label: 'สเปก' }, { key: 'value', label: 'ค่าที่วัด', format: 'qty' },
        { key: 'method', label: 'วิธีตรวจ' }, { key: 'type_th', label: 'ชนิด' }, { key: 'critical_th', label: 'วิกฤต' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      actions: [
        { id: 'complete', label: 'ปิดงานตรวจ', method: 'POST', endpoint: '/inspections/:id/complete', perm: 'quality.inspection.record', tone: 'primary',
          fields: [{ name: 'acceptedQty', label: 'จำนวนรับ (เว้นว่าง = ตามผลตรวจ)', type: 'number' }, { name: 'rejectedQty', label: 'จำนวนปฏิเสธ', type: 'number' }] },
      ],
      rowActions: [
        { id: 'measure', label: 'บันทึกค่า', method: 'POST', endpoint: '/inspection-results/:id', perm: 'quality.inspection.record', tone: 'primary', mobile: true,
          when: { field: 'type', in: ['measure'] },
          fields: [{ name: 'value', label: 'ค่าที่วัดได้', type: 'number', step: 0.0001, required: true }, { name: 'note', label: 'หมายเหตุ', type: 'text' }] },
        { id: 'pass', label: 'ผ่าน', method: 'POST', endpoint: '/inspection-results/:id/pass', perm: 'quality.inspection.record', tone: 'primary', mobile: true,
          when: { field: 'type', in: ['pass_fail', 'visual'] } },
        { id: 'fail', label: 'ไม่ผ่าน', method: 'POST', endpoint: '/inspection-results/:id/fail', perm: 'quality.inspection.record', tone: 'danger', mobile: true,
          fields: [{ name: 'note', label: 'พบอะไร', type: 'text' }] },
      ],
      empty: 'งานตรวจนี้ไม่มีจุดตรวจ',
    },

    /* ----- NCR ----- */
    ncrList: {
      kind: 'list', title: 'NCR — รายงานสิ่งที่ไม่เป็นไปตามข้อกำหนด', endpoint: '/ncrs', perm: 'quality.ncr.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหาเลขที่ สินค้า รายละเอียด', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: ncrStatusOptions },
        { name: 'severity', label: 'ความรุนแรง', type: 'select', options: severityOptions },
        { name: 'open', label: 'เฉพาะที่ยังไม่ปิด', type: 'select', options: [{ value: 'true', label: 'ยังไม่ปิด' }, { value: 'false', label: 'ปิดแล้ว' }] },
      ],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'severity_th', label: 'ความรุนแรง' }, { key: 'item_code', label: 'สินค้า' }, { key: 'lot_no', label: 'ล็อต' },
        { key: 'description', label: 'รายละเอียด' }, { key: 'qty_affected', label: 'จำนวน', format: 'qty' }, { key: 'disposition_th', label: 'การจัดการ' },
        { key: 'status_th', label: 'สถานะ' }, { key: 'open_actions', label: 'CA ค้าง', format: 'qty' }, { key: 'created_at', label: 'ออกเมื่อ', format: 'datetime' },
      ],
      create: 'ncrNew', createLabel: 'ออก NCR', rowLink: { screen: 'ncrDetail' }, empty: 'ไม่มี NCR',
    },
    ncrNew: {
      kind: 'form', title: 'ออก NCR', method: 'POST', endpoint: '/ncrs', perm: 'quality.ncr.write', mobile: true,
      fields: [
        { name: 'description', label: 'สิ่งที่ไม่เป็นไปตามข้อกำหนด', type: 'textarea', required: true },
        optionalItem,
        { name: 'stage', label: 'พบที่ขั้นตอน', type: 'select', options: stageOptions },
        { name: 'lotNo', label: 'เลขล็อต', type: 'text' },
        { name: 'sourceRef', label: 'อ้างอิง (PO / ใบสั่งผลิต / ลูกค้าร้องเรียน)', type: 'text' },
        supplier,
        { name: 'qtyAffected', label: 'จำนวนที่ได้รับผลกระทบ', type: 'number' },
        { name: 'severity', label: 'ความรุนแรง', type: 'select', required: true, default: 'minor', options: severityOptions },
        { name: 'disposition', label: 'การจัดการของเสีย', type: 'select', options: dispositionOptions },
      ],
      submitLabel: 'ออก NCR', after: { screen: 'ncrDetail', idFrom: 'id' },
    },
    ncrEdit: {
      kind: 'form', title: 'แก้ไข NCR / วิเคราะห์สาเหตุ', method: 'PATCH', endpoint: '/ncrs/:id', load: '/ncrs/:id', perm: 'quality.ncr.write',
      fields: [
        { name: 'description', label: 'สิ่งที่ไม่เป็นไปตามข้อกำหนด', type: 'textarea', required: true },
        { name: 'qtyAffected', label: 'จำนวนที่ได้รับผลกระทบ', type: 'number' },
        { name: 'severity', label: 'ความรุนแรง', type: 'select', options: severityOptions },
        { name: 'disposition', label: 'การจัดการของเสีย', type: 'select', options: dispositionOptions },
        { name: 'whyAnalysis', label: 'วิเคราะห์ 5 Why (ทำไม 1…5)', type: 'textarea' },
        { name: 'rootCause', label: 'สาเหตุราก (Root cause)', type: 'textarea' },
      ],
      submitLabel: 'บันทึก', after: { screen: 'ncrDetail', idFrom: 'id' },
    },
    ncrDetail: {
      kind: 'detail', title: 'รายงานสิ่งที่ไม่เป็นไปตามข้อกำหนด (NCR)', endpoint: '/ncrs/:id', perm: 'quality.ncr.read', heading: 'no', attachments: { entity: 'ncr', label: 'รูปของเสีย / เอกสาร' }, mobile: true, edit: 'ncrEdit',
      print: { title: 'รายงานสิ่งที่ไม่เป็นไปตามข้อกำหนด (NCR)', signatures: ['ผู้รายงาน', 'ผู้รับผิดชอบแก้ไข', 'ผู้ปิด NCR (QA)'] },
      flow: {
        field: 'status',
        steps: [{ value: 'open', label: 'เปิด' }, { value: 'investigating', label: 'สอบสวนสาเหตุ' }, { value: 'action', label: 'แก้ไข' }, { value: 'closed', label: 'ปิด' }],
      },
      fields: [
        { key: 'status_th', label: 'สถานะ' }, { key: 'severity_th', label: 'ความรุนแรง' }, { key: 'description', label: 'สิ่งที่ไม่เป็นไปตามข้อกำหนด' },
        { key: 'item_code', label: 'รหัสสินค้า' }, { key: 'item_name', label: 'ชื่อสินค้า' }, { key: 'lot_no', label: 'ล็อต' },
        { key: 'stage_th', label: 'พบที่ขั้นตอน' }, { key: 'inspection_no', label: 'จากงานตรวจ' }, { key: 'source_ref', label: 'อ้างอิง' },
        { key: 'supplier_name', label: 'ผู้ขาย' }, { key: 'qty_affected', label: 'จำนวนที่ได้รับผลกระทบ', format: 'qty' },
        { key: 'disposition_th', label: 'การจัดการของเสีย' }, { key: 'return_hint', label: 'ส่งคืนผู้ขาย' }, { key: 'why_analysis', label: 'วิเคราะห์ 5 Why' }, { key: 'root_cause', label: 'สาเหตุราก' },
        { key: 'created_at', label: 'ออกเมื่อ', format: 'datetime' }, { key: 'closed_at', label: 'ปิดเมื่อ', format: 'datetime' },
      ],
      lines: [
        { path: 'failedCheckpoints', label: 'จุดตรวจที่ไม่ผ่าน', columns: [{ key: 'name', label: 'จุดตรวจ' }, { key: 'spec', label: 'สเปก' }, { key: 'value', label: 'ค่าที่วัด', format: 'qty' }, { key: 'note', label: 'หมายเหตุ' }] },
        { path: 'actions', label: 'การแก้ไขและป้องกัน (CA)', columns: [
          { key: 'no', label: 'เลขที่' }, { key: 'action', label: 'การแก้ไข' }, { key: 'owner_name', label: 'ผู้รับผิดชอบ' }, { key: 'due_on', label: 'กำหนดเสร็จ', format: 'date' },
          { key: 'status_th', label: 'สถานะ' }, { key: 'overdue_th', label: '' },
        ] },
      ],
      actions: [
        { id: 'investigate', label: 'เริ่มสอบสวนสาเหตุ', method: 'POST', endpoint: '/ncrs/:id/investigate', perm: 'quality.ncr.write', when: { field: 'status', in: ['open'] }, tone: 'primary', mobile: true,
          fields: [
            { name: 'whyAnalysis', label: 'วิเคราะห์ 5 Why', type: 'textarea' },
            { name: 'rootCause', label: 'สาเหตุราก', type: 'textarea' },
            { name: 'disposition', label: 'การจัดการของเสีย', type: 'select', options: dispositionOptions },
          ] },
        { id: 'addCa', label: 'เพิ่มการแก้ไข (CA)', method: 'POST', endpoint: '/ncrs/:id/actions', perm: 'quality.ncr.write', when: { field: 'status', in: ['open', 'investigating', 'action'] }, mobile: true,
          fields: [{ name: 'action', label: 'การแก้ไข/ป้องกัน', type: 'textarea', required: true }, owner, { name: 'dueOn', label: 'กำหนดเสร็จ', type: 'date' }] },
        { id: 'close', label: 'ปิด NCR', method: 'POST', endpoint: '/ncrs/:id/close', perm: 'quality.ncr.close', when: { field: 'status', in: ['investigating', 'action'] }, tone: 'primary',
          fields: [
            { name: 'rootCause', label: 'สาเหตุราก (เว้นว่าง = ใช้ที่บันทึกไว้)', type: 'textarea' },
            { name: 'disposition', label: 'การจัดการของเสีย (เว้นว่าง = ใช้ที่บันทึกไว้)', type: 'select', options: dispositionOptions },
          ] },
      ],
    },

    /* ----- corrective actions ----- */
    caList: {
      kind: 'list', title: 'การแก้ไขและป้องกัน (CA)', endpoint: '/corrective-actions', perm: 'quality.ncr.read', mobile: true,
      filters: [
        { name: 'q', label: 'ค้นหา', type: 'text' },
        { name: 'status', label: 'สถานะ', type: 'select', options: [{ value: 'open', label: 'รอดำเนินการ' }, { value: 'done', label: 'ทำแล้ว รอทวนสอบ' }, { value: 'verified', label: 'ทวนสอบแล้ว' }] },
        { name: 'overdue', label: 'เลยกำหนด', type: 'select', options: [{ value: 'true', label: 'เฉพาะที่เลยกำหนด' }] },
      ],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'ncr_no', label: 'NCR' }, { key: 'action', label: 'การแก้ไข' }, { key: 'owner_name', label: 'ผู้รับผิดชอบ' },
        { key: 'due_on', label: 'กำหนดเสร็จ', format: 'date' }, { key: 'status_th', label: 'สถานะ' }, { key: 'overdue_th', label: 'เลยกำหนด' },
      ],
      rowLink: { screen: 'caDetail' },
      rowActions: [
        { id: 'done', label: 'ทำแล้ว', method: 'POST', endpoint: '/corrective-actions/:id/done', perm: 'quality.ncr.write', when: { field: 'status', in: ['open'] }, tone: 'primary', mobile: true,
          fields: [{ name: 'note', label: 'ทำอะไรไปแล้ว', type: 'text' }] },
        { id: 'verify', label: 'ทวนสอบ', method: 'POST', endpoint: '/corrective-actions/:id/verify', perm: 'quality.ncr.close', when: { field: 'status', in: ['done'] }, mobile: true,
          fields: [{ name: 'note', label: 'ผลการทวนสอบประสิทธิผล', type: 'text' }] },
      ],
      empty: 'ไม่มีการแก้ไขค้าง',
    },
    caDetail: {
      kind: 'detail', title: 'การแก้ไขและป้องกัน (CA)', endpoint: '/corrective-actions/:id', perm: 'quality.ncr.read', heading: 'no', attachments: { entity: 'ca', label: 'หลักฐานการแก้ไข' }, mobile: true,
      flow: { field: 'status', steps: [{ value: 'open', label: 'รอดำเนินการ' }, { value: 'done', label: 'ทำแล้ว' }, { value: 'verified', label: 'ทวนสอบแล้ว' }] },
      fields: [
        { key: 'status_th', label: 'สถานะ' }, { key: 'overdue_th', label: 'เลยกำหนด' }, { key: 'ncr_no', label: 'NCR' }, { key: 'ncr_description', label: 'ปัญหา' },
        { key: 'action', label: 'การแก้ไข/ป้องกัน' }, { key: 'owner_name', label: 'ผู้รับผิดชอบ' }, { key: 'due_on', label: 'กำหนดเสร็จ', format: 'date' },
        { key: 'done_note', label: 'สิ่งที่ทำ' }, { key: 'done_at', label: 'ทำเสร็จเมื่อ', format: 'datetime' },
        { key: 'verified_note', label: 'ผลการทวนสอบ' }, { key: 'verified_at', label: 'ทวนสอบเมื่อ', format: 'datetime' },
      ],
      actions: [
        { id: 'done', label: 'บันทึกว่าทำแล้ว', method: 'POST', endpoint: '/corrective-actions/:id/done', perm: 'quality.ncr.write', when: { field: 'status', in: ['open'] }, tone: 'primary', mobile: true,
          fields: [{ name: 'note', label: 'ทำอะไรไปแล้ว', type: 'textarea' }] },
        { id: 'verify', label: 'ทวนสอบประสิทธิผล', method: 'POST', endpoint: '/corrective-actions/:id/verify', perm: 'quality.ncr.close', when: { field: 'status', in: ['done'] }, tone: 'primary', mobile: true,
          fields: [{ name: 'note', label: 'ผลการทวนสอบ', type: 'textarea' }] },
      ],
    },

    /* ----- inspection plans ----- */
    planList: {
      kind: 'list', title: 'แผนการตรวจคุณภาพ', endpoint: '/plans', perm: 'quality.plan.read',
      filters: [
        { name: 'q', label: 'ค้นหาสินค้า/ชื่อแผน', type: 'text' },
        { name: 'stage', label: 'ขั้นตอน', type: 'select', options: stageOptions },
        { name: 'active', label: 'สถานะ', type: 'select', options: [{ value: 'true', label: 'ใช้งาน' }, { value: 'false', label: 'ปิดใช้' }] },
      ],
      columns: [
        { key: 'name', label: 'แผน' }, { key: 'item_code', label: 'สินค้า' }, { key: 'item_name', label: 'ชื่อสินค้า' }, { key: 'stage_th', label: 'ขั้นตอน' },
        { key: 'sampling_th', label: 'สุ่มตรวจ' }, { key: 'checkpoint_count', label: 'จุดตรวจ', format: 'qty' }, { key: 'critical_count', label: 'จุดวิกฤต', format: 'qty' },
        { key: 'active_th', label: 'สถานะ' },
      ],
      create: 'planNew', createLabel: 'สร้างแผนการตรวจ', rowLink: { screen: 'planDetail' }, empty: 'ยังไม่มีแผนการตรวจ — สร้างแผนให้สินค้าที่ต้องตรวจรับ/ตรวจก่อนส่ง',
    },
    planNew: {
      kind: 'form', title: 'สร้างแผนการตรวจ', method: 'POST', endpoint: '/plans', perm: 'quality.plan.write',
      fields: [
        item,
        { name: 'stage', label: 'ขั้นตอนการตรวจ', type: 'select', required: true, default: 'incoming', options: stageOptions },
        { name: 'name', label: 'ชื่อแผน (เว้นว่าง = ตั้งให้อัตโนมัติ)', type: 'text' },
        { name: 'samplingMode', label: 'วิธีสุ่มตัวอย่าง', type: 'select', default: 'fixed', options: [{ value: 'fixed', label: 'จำนวนคงที่ (ชิ้น)' }, { value: 'percent', label: '% ของล็อต' }] },
        { name: 'samplingValue', label: 'จำนวน/เปอร์เซ็นต์ที่สุ่ม', type: 'number', required: true, default: 5 },
        { name: 'note', label: 'หมายเหตุ/มาตรฐานอ้างอิง', type: 'textarea' },
      ],
      lines: { name: 'checkpoints', label: 'จุดตรวจ', min: 1, fields: checkpointFields },
      submitLabel: 'บันทึกแผน', after: { screen: 'planDetail', idFrom: 'id' },
    },
    planEdit: {
      kind: 'form', title: 'แก้ไขแผนการตรวจ', method: 'PATCH', endpoint: '/plans/:id', load: '/plans/:id', perm: 'quality.plan.write',
      fields: [
        { name: 'name', label: 'ชื่อแผน', type: 'text', required: true },
        { name: 'samplingMode', label: 'วิธีสุ่มตัวอย่าง', type: 'select', options: [{ value: 'fixed', label: 'จำนวนคงที่ (ชิ้น)' }, { value: 'percent', label: '% ของล็อต' }] },
        { name: 'samplingValue', label: 'จำนวน/เปอร์เซ็นต์ที่สุ่ม', type: 'number', required: true },
        { name: 'note', label: 'หมายเหตุ/มาตรฐานอ้างอิง', type: 'textarea' },
      ],
      submitLabel: 'บันทึก', after: { screen: 'planDetail', idFrom: 'id' },
    },
    planDetail: {
      kind: 'detail', title: 'แผนการตรวจคุณภาพ', endpoint: '/plans/:id', perm: 'quality.plan.read', heading: 'name', printable: true, edit: 'planEdit',
      fields: [
        { key: 'item_code', label: 'รหัสสินค้า' }, { key: 'item_name', label: 'ชื่อสินค้า' }, { key: 'stage_th', label: 'ขั้นตอน' },
        { key: 'sampling_th', label: 'สุ่มตรวจ' }, { key: 'active_th', label: 'สถานะ' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [{ path: 'checkpoints', label: 'จุดตรวจ', columns: [
        { key: 'seq', label: '#' }, { key: 'name', label: 'จุดตรวจ' }, { key: 'method', label: 'วิธีตรวจ' }, { key: 'type_th', label: 'ชนิด' },
        { key: 'spec', label: 'สเปก' }, { key: 'critical_th', label: 'วิกฤต' },
      ] }],
      actions: [
        { id: 'addCheckpoint', label: 'เพิ่มจุดตรวจ', method: 'POST', endpoint: '/plans/:id/checkpoints', perm: 'quality.plan.write', tone: 'primary', fields: checkpointFields },
        { id: 'removeCheckpoint', label: 'ลบจุดตรวจ', method: 'POST', endpoint: '/plans/:id/checkpoints/remove', perm: 'quality.plan.write',
          fields: [{ name: 'seq', label: 'ลำดับ (#) ที่จะลบ', type: 'number', required: true }] },
        { id: 'deactivate', label: 'ปิดใช้แผน', method: 'POST', endpoint: '/plans/:id/deactivate', perm: 'quality.plan.write', when: { field: 'active', in: [true] }, tone: 'danger',
          confirm: 'ปิดใช้แล้วจะไม่สร้างงานตรวจอัตโนมัติจากแผนนี้' },
        { id: 'activate', label: 'เปิดใช้แผน', method: 'POST', endpoint: '/plans/:id/activate', perm: 'quality.plan.write', when: { field: 'active', in: [false] } },
      ],
    },

    /* ----- reports ----- */
    passRate: {
      kind: 'list', title: 'อัตราผ่านการตรวจรายเดือน', endpoint: '/reports/pass-rate', perm: 'quality.inspection.read',
      filters: [{ name: 'stage', label: 'ขั้นตอน', type: 'select', options: stageOptions }, { name: 'months', label: 'ย้อนหลัง (เดือน)', type: 'number' }],
      columns: [
        { key: 'month', label: 'เดือน', format: 'month' }, { key: 'inspections', label: 'ตรวจ (ครั้ง)', format: 'qty' }, { key: 'passed', label: 'ผ่าน', format: 'qty' },
        { key: 'conditional', label: 'มีเงื่อนไข', format: 'qty' }, { key: 'failed', label: 'ไม่ผ่าน', format: 'qty' },
        { key: 'pass_rate', label: 'อัตราผ่าน', format: 'percent' }, { key: 'rejected_qty', label: 'ปฏิเสธ (หน่วย)', format: 'qty' },
      ],
      empty: 'ยังไม่มีข้อมูล',
    },
    defects: {
      kind: 'list', title: 'ข้อบกพร่องที่พบ', endpoint: '/reports/defects', perm: 'quality.inspection.read',
      filters: [
        { name: 'by', label: 'จัดกลุ่มตาม', type: 'select', options: [{ value: 'checkpoint', label: 'จุดตรวจ' }, { value: 'item', label: 'สินค้า' }] },
        { name: 'stage', label: 'ขั้นตอน', type: 'select', options: stageOptions },
        { name: 'from', label: 'ตั้งแต่', type: 'date' }, { name: 'to', label: 'ถึง', type: 'date' },
      ],
      columns: [
        { key: 'label', label: 'จุดตรวจ/สินค้า' }, { key: 'fails', label: 'ไม่ผ่าน (ครั้ง)', format: 'qty' }, { key: 'checks', label: 'ตรวจทั้งหมด', format: 'qty' },
        { key: 'inspections_failed', label: 'งานตรวจที่พบ', format: 'qty' }, { key: 'fail_rate', label: 'อัตราไม่ผ่าน', format: 'percent' },
      ],
      empty: 'ยังไม่พบข้อบกพร่อง',
    },
    suppliers: {
      kind: 'list', title: 'คุณภาพผู้ขาย (ตรวจรับเข้า)', endpoint: '/reports/suppliers', perm: 'quality.inspection.read',
      filters: [{ name: 'from', label: 'ตั้งแต่', type: 'date' }, { name: 'to', label: 'ถึง', type: 'date' }],
      columns: [
        { key: 'supplier', label: 'ผู้ขาย' }, { key: 'inspections', label: 'ล็อตที่ตรวจ', format: 'qty' }, { key: 'passed', label: 'ผ่าน', format: 'qty' },
        { key: 'conditional', label: 'มีเงื่อนไข', format: 'qty' }, { key: 'failed', label: 'ไม่ผ่าน', format: 'qty' }, { key: 'pass_rate', label: 'อัตราผ่าน', format: 'percent' },
        { key: 'received_qty', label: 'รับเข้า (หน่วย)', format: 'qty' }, { key: 'rejected_qty', label: 'ปฏิเสธ (หน่วย)', format: 'qty' },
      ],
      empty: 'ยังไม่มีงานตรวจรับเข้าที่ตรวจเสร็จ',
    },
    ncrSeverity: {
      kind: 'list', title: 'NCR ตามความรุนแรง', endpoint: '/reports/ncr-severity', perm: 'quality.ncr.read',
      columns: [{ key: 'severity_th', label: 'ความรุนแรง' }, { key: 'open', label: 'ยังไม่ปิด', format: 'qty' }, { key: 'closed', label: 'ปิดแล้ว', format: 'qty' }, { key: 'total', label: 'ทั้งหมด', format: 'qty' }],
    },
  },
  widgets: [
    { id: 'qc-kpi', kind: 'kpi', title: 'ควบคุมคุณภาพ', endpoint: '/summary', perm: 'quality.inspection.read', size: 'md', href: 'queue',
      items: [
        { key: 'pendingInspections', label: 'งานรอตรวจ', format: 'qty', tone: 'warn' },
        { key: 'passRateMonth', label: 'อัตราผ่านเดือนนี้', format: 'percent', tone: 'ok' },
        { key: 'openNcr', label: 'NCR ยังไม่ปิด', format: 'qty', tone: 'stop' },
        { key: 'overdueActions', label: 'CA เลยกำหนด', format: 'qty', tone: 'stop' },
      ] },
    { id: 'qc-trend', kind: 'trend', title: 'อัตราผ่านการตรวจ 6 เดือน', endpoint: '/summary', perm: 'quality.inspection.read', size: 'md', href: 'passRate',
      rows: 'months', x: 'month', y: 'pass_rate', format: 'percent' },
    { id: 'qc-ncr', kind: 'pipeline', title: 'NCR ที่ยังไม่ปิด', endpoint: '/summary', perm: 'quality.inspection.read', size: 'wide', href: 'ncrList',
      rows: 'rows', field: 'status', title2: 'no', subtitle: 'title', link: { screen: 'ncrDetail' },
      stages: [{ value: 'open', label: 'เปิด' }, { value: 'investigating', label: 'สอบสวน' }, { value: 'action', label: 'แก้ไข' }] },
    { id: 'qc-defects', kind: 'bars', title: 'จุดตรวจที่ไม่ผ่านบ่อย (90 วัน)', endpoint: '/summary', perm: 'quality.inspection.read', size: 'sm', href: 'defects',
      rows: 'defects', label: 'label', value: 'fails', format: 'qty' },
  ],
});
