import { defineUi, type Action, type Field, type ImportColumn, type Lookup } from '@erp/ui-schema';

/** Screens for web + mobile. Endpoints use the same path templates as the routes in service.ts. */

const opt = (pairs: [string, string][]) => pairs.map(([value, label]) => ({ value, label }));
const priceUnits = opt([['ream', 'รีม'], ['kg', 'กิโลกรัม'], ['sheet', 'แผ่น']]);
const chargeBys = opt([['per_job', 'เหมาต่องาน'], ['per_sheet', 'ต่อแผ่นพิมพ์'], ['per_piece', 'ต่อชิ้น'], ['per_sqin', 'ต่อตารางนิ้ว']]);
const formulaKinds = opt([['step', 'ค่าคำนวณระหว่างทาง'], ['cost', 'ต้นทุน'], ['price', 'ราคาขาย']]);
const statuses = opt([['draft', 'ร่าง'], ['confirmed', 'ยืนยันราคาแล้ว'], ['cancelled', 'ยกเลิก']]);

const customerLookup: Lookup = {
  module: 'master-data', path: '/partners', query: { kind: 'customer' }, label: ['code', 'name'],
  assign: { partnerId: 'id', customerName: 'name', customerTaxId: 'tax_id', customerBranch: 'branch', customerAddress: 'address' },
};

/* ---------- rate tables ---------- */

const paperFields: Field[] = [
  { name: 'code', label: 'รหัส', type: 'text', required: true },
  { name: 'name', label: 'ชื่อกระดาษ', type: 'text', required: true },
  { name: 'gsm', label: 'แกรม', type: 'number', required: true },
  { name: 'widthIn', label: 'กว้าง (นิ้ว)', type: 'number', required: true },
  { name: 'lengthIn', label: 'ยาว (นิ้ว)', type: 'number', required: true },
  { name: 'priceUnit', label: 'หน่วยราคา', type: 'select', options: priceUnits, default: 'ream', required: true, help: 'รีม = 500 แผ่น · กิโลกรัม = ระบบคิดน้ำหนักรีมจาก กว้าง × ยาว × แกรม ÷ 3100' },
  { name: 'price', label: 'ราคาต่อหน่วย (บาท)', type: 'number', required: true, format: 'money' },
  { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true },
];
const pressFields: Field[] = [
  { name: 'code', label: 'รหัส', type: 'text', required: true },
  { name: 'name', label: 'ชื่อเครื่องพิมพ์', type: 'text', required: true },
  { name: 'maxWidthIn', label: 'แผ่นพิมพ์ใหญ่สุด กว้าง (นิ้ว)', type: 'number' },
  { name: 'maxLengthIn', label: 'แผ่นพิมพ์ใหญ่สุด ยาว (นิ้ว)', type: 'number' },
  { name: 'maxColors', label: 'จำนวนป้อมสี', type: 'number', step: 1 },
  { name: 'plateCost', label: 'ค่าเพลทต่อแผ่น (บาท)', type: 'number', format: 'money' },
  { name: 'makereadyCost', label: 'ค่าตั้งเครื่องต่อสี (บาท)', type: 'number', format: 'money' },
  { name: 'runCostPerThousand', label: 'ค่าพิมพ์ต่อสีต่อ 1,000 รอบ (บาท)', type: 'number', format: 'money' },
  { name: 'minImpressions', label: 'รอบพิมพ์ขั้นต่ำที่คิดเงิน', type: 'number', step: 1 },
  { name: 'makereadyWaste', label: 'แผ่นเผื่อเสียตอนตั้งเครื่อง ต่อสี', type: 'number', step: 1 },
  { name: 'runWastePct', label: 'เผื่อเสียระหว่างพิมพ์ %', type: 'number' },
  { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true },
];
const finishingFields: Field[] = [
  { name: 'code', label: 'รหัส', type: 'text', required: true },
  { name: 'name', label: 'ชื่องานหลังพิมพ์', type: 'text', required: true },
  { name: 'chargeBy', label: 'คิดราคา', type: 'select', options: chargeBys, default: 'per_piece', required: true, help: 'ต่อแผ่นพิมพ์และต่อตารางนิ้ว คิดจากจำนวนแผ่นพิมพ์รวม (สูตร pressSheets)' },
  { name: 'rate', label: 'อัตรา (บาท)', type: 'number', help: 'เช่น เคลือบ PVC 0.006 บาทต่อตารางนิ้ว' },
  { name: 'setupCost', label: 'ค่าเริ่มงาน / บล็อก (บาท)', type: 'number', format: 'money' },
  { name: 'minCharge', label: 'ขั้นต่ำต่องาน (บาท)', type: 'number', format: 'money' },
  { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true },
];

/** Import columns: headers in the file may be these Thai labels or the keys; a list exported from the screen can be imported back. */
const paperImport: ImportColumn[] = [
  { key: 'code', label: 'รหัส', required: true }, { key: 'name', label: 'ชื่อกระดาษ', required: true }, { key: 'gsm', label: 'แกรม', required: true },
  { key: 'widthIn', label: 'กว้าง (นิ้ว)', required: true }, { key: 'lengthIn', label: 'ยาว (นิ้ว)', required: true },
  { key: 'priceUnit', label: 'หน่วยราคา' }, { key: 'price', label: 'ราคาต่อหน่วย', required: true }, { key: 'active', label: 'ใช้งาน' },
];
const pressImport: ImportColumn[] = [
  { key: 'code', label: 'รหัส', required: true }, { key: 'name', label: 'ชื่อเครื่องพิมพ์', required: true },
  { key: 'maxWidthIn', label: 'แผ่นใหญ่สุด กว้าง (นิ้ว)' }, { key: 'maxLengthIn', label: 'แผ่นใหญ่สุด ยาว (นิ้ว)' }, { key: 'maxColors', label: 'จำนวนป้อมสี' },
  { key: 'plateCost', label: 'ค่าเพลทต่อแผ่น' }, { key: 'makereadyCost', label: 'ค่าตั้งเครื่องต่อสี' }, { key: 'runCostPerThousand', label: 'ค่าพิมพ์ต่อสีต่อพันรอบ' },
  { key: 'minImpressions', label: 'รอบพิมพ์ขั้นต่ำ' }, { key: 'makereadyWaste', label: 'เผื่อเสียตั้งเครื่องต่อสี' }, { key: 'runWastePct', label: 'เผื่อเสียระหว่างพิมพ์ %' },
  { key: 'active', label: 'ใช้งาน' },
];
const finishingImport: ImportColumn[] = [
  { key: 'code', label: 'รหัส', required: true }, { key: 'name', label: 'ชื่องานหลังพิมพ์', required: true }, { key: 'chargeBy', label: 'คิดราคา' },
  { key: 'rate', label: 'อัตรา' }, { key: 'setupCost', label: 'ค่าเริ่มงาน' }, { key: 'minCharge', label: 'ขั้นต่ำต่องาน' }, { key: 'active', label: 'ใช้งาน' },
];
const importNote = 'รหัสที่มีอยู่แล้วจะถูกปรับราคาตามไฟล์ รหัสใหม่จะถูกเพิ่ม — ใบประเมินที่ยืนยันราคาแล้วไม่เปลี่ยน';

/* ---------- formulas ---------- */

const formulaHelp = 'ใช้ + − × ÷ วงเล็บ และ ceil, floor, round, roundup, min, max, abs, if(เงื่อนไข, ถ้าจริง, ถ้าไม่จริง) · ชื่อตัวแปรดูที่เมนู "ตัวแปรในสูตร"';
const formulaFields: Field[] = [
  { name: 'label', label: 'ชื่อรายการ', type: 'text', required: true, help: 'ชื่อที่แสดงในใบประเมินราคา เช่น ค่าขนส่ง' },
  { name: 'expression', label: 'สูตร', type: 'textarea', required: true, help: formulaHelp },
  { name: 'kind', label: 'ประเภท', type: 'select', options: formulaKinds, default: 'cost', required: true, help: 'ต้นทุน = รวมเข้าต้นทุนรวม · ค่าคำนวณระหว่างทาง = ให้สูตรอื่นใช้ต่อ · ราคาขาย = ราคาต่อชิ้น (มีได้สูตรเดียว)' },
  { name: 'seq', label: 'ลำดับคำนวณ', type: 'number', step: 1, default: 100, comma: false, help: 'เลขน้อยคำนวณก่อน สูตรอ่านผลของสูตรที่มาก่อนได้' },
  { name: 'unit', label: 'หน่วย', type: 'text', default: 'บาท' },
  { name: 'note', label: 'คำอธิบาย', type: 'text' },
  { name: 'active', label: 'ใช้งาน', type: 'boolean', default: true },
];
const formulaTest: Action = {
  id: 'test', label: 'ลองสูตร', method: 'POST', endpoint: '/formulas/test', perm: 'estimating.rate.read', toast: 'message',
  fields: [{ name: 'expression', label: 'สูตรที่จะลอง', type: 'textarea', required: true, help: `คำนวณกับงานตัวอย่างโดยไม่บันทึก · ${formulaHelp}` }],
};

/* ---------- estimates ---------- */

const estimateFields: Field[] = [
  { name: 'jobName', label: 'ชื่องาน', type: 'text', required: true, help: 'เช่น โบรชัวร์สินค้า A4 พับ 3' },
  { name: 'partnerId', label: 'ลูกค้า', type: 'lookup', lookup: customerLookup, help: 'เลือกจากทะเบียนลูกค้า หรือพิมพ์ชื่อด้านล่าง' },
  { name: 'customerName', label: 'ชื่อลูกค้า', type: 'text', required: true },
  { name: 'finishedW', label: 'ขนาดงานสำเร็จ กว้าง (นิ้ว)', type: 'number', required: true },
  { name: 'finishedL', label: 'ขนาดงานสำเร็จ ยาว (นิ้ว)', type: 'number', required: true },
  { name: 'bleed', label: 'ตัดตก ด้านละ (นิ้ว)', type: 'number', default: 0.125 },
  { name: 'paperId', label: 'กระดาษ', type: 'lookup', required: true, lookup: { path: '/papers', query: { active: '1' }, label: ['code', 'name'], assign: { paperId: 'id' } } },
  { name: 'pressId', label: 'เครื่องพิมพ์', type: 'lookup', required: true, lookup: { path: '/presses', query: { active: '1' }, label: ['code', 'name'], assign: { pressId: 'id' } } },
  { name: 'pressSheetW', label: 'แผ่นพิมพ์ กว้าง (นิ้ว)', type: 'number', required: true, help: 'ขนาดกระดาษที่เข้าเครื่อง เช่น 31×43 ตัด 4 = 15.5 × 21.5' },
  { name: 'pressSheetL', label: 'แผ่นพิมพ์ ยาว (นิ้ว)', type: 'number', required: true },
  { name: 'ups', label: 'จำนวนชิ้นต่อแผ่นพิมพ์', type: 'number', step: 1, help: 'เว้นว่าง = ระบบวางงานให้จากขนาดงานและตัดตก' },
  { name: 'cuts', label: 'ตัดกระดาษแผ่นใหญ่ได้กี่แผ่นพิมพ์', type: 'number', step: 1, help: 'เว้นว่าง = ระบบคำนวณจากขนาดกระดาษ' },
  { name: 'colorsFront', label: 'สีด้านหน้า', type: 'number', step: 1, default: 4 },
  { name: 'colorsBack', label: 'สีด้านหลัง', type: 'number', step: 1, default: 0, help: '0 = พิมพ์หน้าเดียว' },
  { name: 'quantities', label: 'ยอดพิมพ์', type: 'text', required: true, help: 'ใส่ได้หลายยอด คั่นด้วยจุลภาค เช่น 1000, 2000, 5000 (ไม่ใส่จุลภาคคั่นหลักพัน)' },
  { name: 'marginPct', label: 'กำไรที่บวก %', type: 'number', default: 30 },
  { name: 'note', label: 'หมายเหตุ', type: 'textarea' },
];

export default defineUi({
  module: 'estimating',
  label: 'ประเมินราคางานพิมพ์',
  glyph: 'ป',
  icon: 'gauge',
  area: 'commercial',
  statusLabels: {
    confirmed: 'ยืนยันราคาแล้ว',
    ream: 'รีม', kg: 'กิโลกรัม', sheet: 'แผ่น',
    per_job: 'เหมาต่องาน', per_sheet: 'ต่อแผ่นพิมพ์', per_piece: 'ต่อชิ้น', per_sqin: 'ต่อตารางนิ้ว',
    step: 'ค่าคำนวณระหว่างทาง', cost: 'ต้นทุน', price: 'ราคาขาย',
  },
  menu: [
    { label: 'ใบประเมินราคา', screen: 'estimates' },
    { label: 'กระดาษ', screen: 'papers' },
    { label: 'เครื่องพิมพ์', screen: 'presses' },
    { label: 'งานหลังพิมพ์', screen: 'finishings' },
    { label: 'สูตรคำนวณ', screen: 'formulas' },
    { label: 'ตัวแปรในสูตร', screen: 'variables' },
  ],
  commands: [
    { id: 'estimate', label: 'ประเมินราคางานพิมพ์', example: 'ประเมินราคา CUS-001 โบรชัวร์ A4', keywords: ['ประเมินราคา', 'ตีราคางานพิมพ์', 'estimate'], screen: 'estimateNew', perm: 'estimating.estimate.write',
      arg: { lookup: customerLookup }, restField: 'jobName' },
  ],
  search: [
    { id: 'estimates', title: 'ใบประเมินราคา', endpoint: '/estimates', label: ['no', 'job_name', 'customer_name'], screen: 'estimate', perm: 'estimating.estimate.read' },
  ],
  screens: {
    /* ---------- estimates ---------- */
    estimates: {
      kind: 'list', title: 'ใบประเมินราคา', endpoint: '/estimates', perm: 'estimating.estimate.read',
      filters: [{ name: 'q', label: 'ค้นหาเลขที่ ชื่องาน หรือลูกค้า', type: 'text' }, { name: 'status', label: 'สถานะ', type: 'select', options: statuses }],
      columns: [
        { key: 'no', label: 'เลขที่' }, { key: 'job_name', label: 'ชื่องาน' }, { key: 'customer_name', label: 'ลูกค้า' }, { key: 'paper_name', label: 'กระดาษ', phone: false },
        { key: 'qty_text', label: 'ยอดพิมพ์' }, { key: 'price_from', label: 'ราคาเริ่มต้น', format: 'money' }, { key: 'status', label: 'สถานะ', format: 'status' },
        { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' },
      ],
      create: 'estimateNew', createLabel: 'ประเมินราคา', rowLink: { screen: 'estimate' },
      empty: 'ยังไม่มีใบประเมินราคา — เพิ่มกระดาษ เครื่องพิมพ์ และงานหลังพิมพ์ก่อน แล้วกด "ประเมินราคา"',
    },
    estimateNew: {
      kind: 'form', title: 'ประเมินราคางานพิมพ์', method: 'POST', endpoint: '/estimates', perm: 'estimating.estimate.write',
      fields: estimateFields,
      lines: {
        name: 'finishings', label: 'งานหลังพิมพ์',
        fields: [
          { name: 'finishingId', label: 'งานหลังพิมพ์', type: 'lookup', required: true, lookup: { path: '/finishings', query: { active: '1' }, label: ['code', 'name'], assign: { finishingId: 'id' } } },
          // no default here: a default would make the empty first row count as filled in and demand a finishing for every job
          { name: 'times', label: 'จำนวนครั้ง / ด้าน (เว้นว่าง = 1)', type: 'number' },
        ],
      },
      submitLabel: 'คำนวณและบันทึก', after: { screen: 'estimate', idFrom: 'id' },
    },
    estimate: {
      kind: 'detail', title: 'ใบประเมินราคา', endpoint: '/estimates/:id', perm: 'estimating.estimate.read', heading: 'no',
      print: { title: 'ใบประเมินราคางานพิมพ์', signatures: ['ผู้ประเมินราคา', 'ผู้อนุมัติราคา'] },
      flow: { field: 'status', steps: [{ value: 'draft', label: 'ร่าง' }, { value: 'confirmed', label: 'ยืนยันราคา' }], exits: [{ value: 'cancelled', label: 'ยกเลิก' }] },
      fields: [
        { key: 'status', label: 'สถานะ', format: 'status' }, { key: 'job_name', label: 'ชื่องาน' }, { key: 'customer_name', label: 'ลูกค้า' },
        { key: 'created_by_name', label: 'ผู้ประเมิน' }, { key: 'created_at', label: 'วันที่ประเมิน', format: 'date' },
        { key: 'size_text', label: 'ขนาดงานสำเร็จ', section: 'งานพิมพ์' }, { key: 'bleed', label: 'ตัดตก (นิ้ว)', format: 'number' }, { key: 'colors_text', label: 'พิมพ์ หน้า/หลัง' },
        { key: 'paper_text', label: 'กระดาษ' }, { key: 'press_text', label: 'เครื่องพิมพ์' }, { key: 'press_sheet_text', label: 'แผ่นพิมพ์' },
        { key: 'ups', label: 'ชิ้นต่อแผ่นพิมพ์', format: 'number' }, { key: 'cuts', label: 'แผ่นพิมพ์ต่อกระดาษแผ่นใหญ่', format: 'number' },
        { key: 'margin_pct', label: 'กำไรที่บวก', format: 'percent', section: 'ราคา' }, { key: 'confirmed_qty', label: 'ยอดพิมพ์ที่ยืนยัน', format: 'number' },
        { key: 'confirmed_unit_price', label: 'ราคาต่อชิ้นที่ยืนยัน', format: 'money' }, { key: 'confirmed_price', label: 'ราคาที่ยืนยัน (ก่อน VAT)', format: 'money', emphasis: true },
        { key: 'confirmed_by_name', label: 'ผู้ยืนยันราคา' }, { key: 'note', label: 'หมายเหตุ' },
      ],
      lines: [
        {
          path: 'breaks', label: 'ราคาตามยอดพิมพ์',
          columns: [
            { key: 'qty', label: 'ยอดพิมพ์', format: 'number' }, { key: 'press_sheets', label: 'แผ่นพิมพ์รวม', format: 'number' },
            { key: 'total_cost', label: 'ต้นทุนรวม', format: 'money' }, { key: 'unit_cost', label: 'ต้นทุนต่อชิ้น', format: 'number' },
            { key: 'unit_price', label: 'ราคาขายต่อชิ้น', format: 'number' }, { key: 'price', label: 'ราคาขาย (ก่อน VAT)', format: 'money' }, { key: 'profit', label: 'กำไร', format: 'money' },
          ],
        },
        {
          path: 'finishing_lines', label: 'งานหลังพิมพ์',
          columns: [
            { key: 'qty', label: 'ยอดพิมพ์', format: 'number', hideRepeats: true }, { key: 'code', label: 'รหัส' }, { key: 'name', label: 'รายการ' },
            { key: 'chargeBy', label: 'คิดราคา', format: 'label' }, { key: 'basis', label: 'ปริมาณที่คิด', format: 'number' }, { key: 'rate', label: 'อัตรา', format: 'number' },
            { key: 'times', label: 'ครั้ง', format: 'number' }, { key: 'setupCost', label: 'ค่าเริ่มงาน', format: 'money' }, { key: 'amount', label: 'จำนวนเงิน', format: 'money' },
          ],
        },
        {
          path: 'cost_lines', label: 'รายละเอียดการคำนวณตามสูตร',
          columns: [
            { key: 'qty', label: 'ยอดพิมพ์', format: 'number', hideRepeats: true }, { key: 'label', label: 'รายการ' }, { key: 'kind', label: 'ประเภท', format: 'label' },
            { key: 'value', label: 'ผลลัพธ์', format: 'number' }, { key: 'unit', label: 'หน่วย' },
          ],
        },
      ],
      actions: [
        { id: 'confirm', label: 'ยืนยันราคา → ทำใบเสนอราคา', method: 'POST', endpoint: '/estimates/:id/confirm', perm: 'estimating.estimate.confirm', when: { field: 'status', in: ['draft'] }, tone: 'primary',
          confirm: 'ราคาจะถูกล็อก และถ้าติดตั้งโมดูลลูกค้าสัมพันธ์ ระบบจะร่างใบเสนอราคาให้',
          fields: [{ name: 'qty', label: 'ยอดพิมพ์ที่ลูกค้าตกลง', type: 'number', step: 1, help: 'เว้นว่างได้เมื่อใบประเมินมียอดพิมพ์เดียว' }] },
        { id: 'recalculate', label: 'คำนวณใหม่', method: 'POST', endpoint: '/estimates/:id/recalculate', perm: 'estimating.estimate.write', when: { field: 'status', in: ['draft'] },
          confirm: 'คำนวณใหม่ด้วยราคากระดาษ อัตราเครื่อง และสูตรล่าสุด',
          fields: [
            { name: 'quantities', label: 'ยอดพิมพ์ใหม่', type: 'text', help: 'เว้นว่าง = ใช้ยอดเดิม · หลายยอดคั่นด้วยจุลภาค เช่น 1000, 3000' },
            { name: 'marginPct', label: 'กำไรที่บวก % ใหม่', type: 'number', help: 'เว้นว่าง = ใช้ค่าเดิม' },
          ] },
        { id: 'cancel', label: 'ยกเลิก', method: 'POST', endpoint: '/estimates/:id/cancel', perm: 'estimating.estimate.write', when: { field: 'status', in: ['draft'] }, tone: 'danger', confirm: 'ยกเลิกใบประเมินราคานี้' },
      ],
    },

    /* ---------- paper ---------- */
    papers: {
      kind: 'list', title: 'กระดาษ', endpoint: '/papers', perm: 'estimating.rate.read',
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อกระดาษ' }, { key: 'gsm', label: 'แกรม', format: 'number' },
        { key: 'width_in', label: 'กว้าง (นิ้ว)', format: 'number' }, { key: 'length_in', label: 'ยาว (นิ้ว)', format: 'number' },
        { key: 'price_unit', label: 'หน่วยราคา', format: 'label' }, { key: 'price', label: 'ราคาต่อหน่วย', format: 'money' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'paperNew', createLabel: 'เพิ่มกระดาษ', rowLink: { screen: 'paperEdit' },
      import: { endpoint: '/papers/import', perm: 'estimating.rate.write', columns: paperImport, template: 'แบบฟอร์มนำเข้ากระดาษ.csv', note: importNote },
      empty: 'ยังไม่มีกระดาษ — เพิ่มทีละรายการ หรือนำเข้าตารางราคากระดาษจาก Excel',
    },
    paperNew: { kind: 'form', title: 'เพิ่มกระดาษ', method: 'POST', endpoint: '/papers', perm: 'estimating.rate.write', fields: paperFields, submitLabel: 'บันทึกกระดาษ', after: { screen: 'papers' } },
    paperEdit: { kind: 'form', title: 'แก้ไขกระดาษ', method: 'PATCH', endpoint: '/papers/:id', load: '/papers/:id', perm: 'estimating.rate.write', fields: paperFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'papers' } },

    /* ---------- presses ---------- */
    presses: {
      kind: 'list', title: 'เครื่องพิมพ์', endpoint: '/presses', perm: 'estimating.rate.read',
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่อเครื่องพิมพ์' }, { key: 'max_colors', label: 'ป้อมสี', format: 'number' },
        { key: 'plate_cost', label: 'ค่าเพลท', format: 'money' }, { key: 'makeready_cost', label: 'ค่าตั้งเครื่องต่อสี', format: 'money' },
        { key: 'run_cost_per_thousand', label: 'ค่าพิมพ์ต่อสีต่อพันรอบ', format: 'money' }, { key: 'min_impressions', label: 'รอบขั้นต่ำ', format: 'number', phone: false },
        { key: 'run_waste_pct', label: 'เผื่อเสีย', format: 'percent', phone: false }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'pressNew', createLabel: 'เพิ่มเครื่องพิมพ์', rowLink: { screen: 'pressEdit' },
      import: { endpoint: '/presses/import', perm: 'estimating.rate.write', columns: pressImport, template: 'แบบฟอร์มนำเข้าเครื่องพิมพ์.csv', note: importNote },
      empty: 'ยังไม่มีเครื่องพิมพ์ — ใส่ค่าเพลท ค่าตั้งเครื่อง และค่าพิมพ์ของแต่ละเครื่อง',
    },
    pressNew: { kind: 'form', title: 'เพิ่มเครื่องพิมพ์', method: 'POST', endpoint: '/presses', perm: 'estimating.rate.write', fields: pressFields, submitLabel: 'บันทึกเครื่องพิมพ์', after: { screen: 'presses' } },
    pressEdit: { kind: 'form', title: 'แก้ไขเครื่องพิมพ์', method: 'PATCH', endpoint: '/presses/:id', load: '/presses/:id', perm: 'estimating.rate.write', fields: pressFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'presses' } },

    /* ---------- finishing ---------- */
    finishings: {
      kind: 'list', title: 'งานหลังพิมพ์', endpoint: '/finishings', perm: 'estimating.rate.read',
      filters: [{ name: 'q', label: 'ค้นหารหัสหรือชื่อ', type: 'text' }],
      columns: [
        { key: 'code', label: 'รหัส' }, { key: 'name', label: 'ชื่องานหลังพิมพ์' }, { key: 'charge_by', label: 'คิดราคา', format: 'label' },
        { key: 'rate', label: 'อัตรา', format: 'number' }, { key: 'setup_cost', label: 'ค่าเริ่มงาน', format: 'money' }, { key: 'min_charge', label: 'ขั้นต่ำต่องาน', format: 'money' },
        { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'finishingNew', createLabel: 'เพิ่มงานหลังพิมพ์', rowLink: { screen: 'finishingEdit' },
      import: { endpoint: '/finishings/import', perm: 'estimating.rate.write', columns: finishingImport, template: 'แบบฟอร์มนำเข้างานหลังพิมพ์.csv', note: importNote },
      empty: 'ยังไม่มีงานหลังพิมพ์ — เช่น เคลือบ ไดคัท พับ เข้าเล่ม',
    },
    finishingNew: { kind: 'form', title: 'เพิ่มงานหลังพิมพ์', method: 'POST', endpoint: '/finishings', perm: 'estimating.rate.write', fields: finishingFields, submitLabel: 'บันทึกงานหลังพิมพ์', after: { screen: 'finishings' } },
    finishingEdit: { kind: 'form', title: 'แก้ไขงานหลังพิมพ์', method: 'PATCH', endpoint: '/finishings/:id', load: '/finishings/:id', perm: 'estimating.rate.write', fields: finishingFields, submitLabel: 'บันทึกการแก้ไข', after: { screen: 'finishings' } },

    /* ---------- formulas ---------- */
    formulas: {
      kind: 'list', title: 'สูตรคำนวณ', endpoint: '/formulas', perm: 'estimating.rate.read',
      columns: [
        { key: 'seq', label: 'ลำดับ', format: 'number' }, { key: 'label', label: 'รายการ' }, { key: 'code', label: 'ชื่อตัวแปร' }, { key: 'expression', label: 'สูตร' },
        { key: 'kind', label: 'ประเภท', format: 'label' }, { key: 'unit', label: 'หน่วย', phone: false }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
        { key: 'updated_by_name', label: 'แก้ไขล่าสุดโดย', phone: false },
      ],
      create: 'formulaNew', createLabel: 'เพิ่มสูตร', rowLink: { screen: 'formulaEdit' }, actions: [formulaTest],
      empty: 'ยังไม่มีสูตร',
    },
    formulaNew: {
      kind: 'form', title: 'เพิ่มสูตรคำนวณ', method: 'POST', endpoint: '/formulas', perm: 'estimating.formula.write',
      fields: [{ name: 'code', label: 'ชื่อตัวแปร', type: 'text', required: true, help: 'ภาษาอังกฤษติดกัน เช่น deliveryCost — สูตรลำดับถัดไปอ้างชื่อนี้ได้ ตั้งแล้วเปลี่ยนไม่ได้' }, ...formulaFields],
      submitLabel: 'ตรวจและบันทึกสูตร', after: { screen: 'formulas' },
    },
    formulaEdit: {
      kind: 'form', title: 'แก้ไขสูตรคำนวณ', method: 'PATCH', endpoint: '/formulas/:id', load: '/formulas/:id', perm: 'estimating.formula.write',
      fields: formulaFields, submitLabel: 'ตรวจและบันทึกสูตร', after: { screen: 'formulas' },
    },
    variables: {
      kind: 'list', title: 'ตัวแปรในสูตร', endpoint: '/formulas/variables', perm: 'estimating.rate.read',
      columns: [{ key: 'group', label: 'กลุ่ม', hideRepeats: true }, { key: 'code', label: 'ชื่อตัวแปร' }, { key: 'label', label: 'ความหมาย' }, { key: 'unit', label: 'หน่วย' }],
      empty: 'ไม่มีตัวแปร',
    },
  },
  widgets: [
    { id: 'estimating-kpi', kind: 'kpi', title: 'ประเมินราคางานพิมพ์', endpoint: '/summary', perm: 'estimating.estimate.read', size: 'sm', href: 'estimates',
      items: [
        { key: 'drafts', label: 'ใบประเมินรอยืนยันราคา', format: 'number', tone: 'warn' },
        { key: 'confirmedThisMonth', label: 'ยืนยันราคาเดือนนี้', format: 'number' },
        { key: 'confirmedValueThisMonth', label: 'มูลค่าที่ยืนยันเดือนนี้', format: 'money', tone: 'ok' },
      ] },
  ],
});
