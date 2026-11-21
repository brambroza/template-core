import { defineUi } from '@erp/ui-schema';

const roleLookup = { path: '/roles', label: ['name'], assign: { roleIds: 'id' } };

export default defineUi({
  module: 'identity',
  label: 'ผู้ใช้และสิทธิ์',
  glyph: 'ส',
  icon: 'users',
  menu: [
    { label: 'ผู้ใช้', screen: 'users' },
    { label: 'บทบาทและสิทธิ์', screen: 'roles' },
    { label: 'ข้อมูลบริษัท', screen: 'company' },
    { label: 'แพ็กเกจของบริษัท', screen: 'plan' },
    { label: 'ประวัติการแก้ไข', screen: 'audit' },
  ],
  screens: {
    plan: {
      // cloud plan (identity migration 004); self-hosted installs show "ไม่จำกัดแพ็กเกจ"
      kind: 'detail', title: 'แพ็กเกจของบริษัท', endpoint: '/subscription', heading: 'plan_text', perm: 'identity.user.read',
      fields: [
        { key: 'status_text', label: 'สถานะ' },
        { key: 'usable_until', label: 'ใช้งานได้ถึง', format: 'datetime' },
        { key: 'users_text', label: 'ผู้ใช้' },
        { key: 'modules', label: 'โมดูลในแพ็กเกจ', format: 'list' },
        { key: 'how_to_pay', label: 'วิธีชำระ / ต่ออายุ' },
      ],
    },
    audit: {
      // kernel route every module has (GET /_audit); this one lists identity's own log: users, roles, company profile
      kind: 'list', title: 'ประวัติการแก้ไข (ผู้ใช้และสิทธิ์)', endpoint: '/_audit', perm: 'identity.audit.read',
      columns: [
        { key: 'at', label: 'เวลา', format: 'datetime' },
        { key: 'user_name', label: 'ผู้ทำรายการ' },
        { key: 'action', label: 'รายการ' },
        { key: 'entity_id', label: 'รหัสเรคคอร์ด' },
        { key: 'summary_text', label: 'ข้อมูลที่ส่ง' },
      ],
      filters: [
        { name: 'from', label: 'ตั้งแต่วันที่', type: 'date' },
        { name: 'to', label: 'ถึงวันที่', type: 'date' },
        { name: 'userId', label: 'ผู้ใช้', type: 'lookup', lookup: { path: '/users', label: ['name', 'email'], assign: { userId: 'id' } } },
        { name: 'q', label: 'ค้นหา', type: 'text' },
      ],
      empty: 'ยังไม่มีการแก้ไขในช่วงนี้',
    },
    company: {
      // GET /company stays open to every signed-in user (printing needs it); the settings screen is for whoever sets it up,
      // otherwise every staff member would get an admin "ผู้ใช้และสิทธิ์" menu group (bugs-0.3 ID-01)
      kind: 'detail', title: 'ข้อมูลบริษัท (หัวเอกสาร)', endpoint: '/company', heading: 'legal_name', edit: 'companyEdit', perm: 'identity.company.write',
      fields: [
        { key: 'name_en', label: 'ชื่อภาษาอังกฤษ' },
        { key: 'branch_text', label: 'สำนักงานใหญ่ / สาขา' },
        { key: 'branch_code', label: 'รหัสสาขา' },
        { key: 'tax_id_text', label: 'เลขประจำตัวผู้เสียภาษี' },
        { key: 'address', label: 'ที่อยู่' },
        { key: 'phone', label: 'โทรศัพท์' },
        { key: 'email', label: 'อีเมล' },
        { key: 'website', label: 'เว็บไซต์' },
        { key: 'signature_labels', label: 'ช่องลายเซ็นเริ่มต้น', format: 'list' },
        { key: 'footer_note', label: 'หมายเหตุท้ายเอกสาร' },
        { key: 'configured', label: 'ตั้งค่าแล้ว', format: 'boolean' },
      ],
    },
    companyEdit: {
      kind: 'form', title: 'ข้อมูลบริษัท', method: 'PUT', endpoint: '/company', load: '/company', perm: 'identity.company.write', submitLabel: 'บันทึกข้อมูลบริษัท',
      fields: [
        { name: 'legalName', label: 'ชื่อนิติบุคคล (ภาษาไทย)', type: 'text', required: true, help: 'ตามหนังสือรับรอง เช่น บริษัท สยามพาร์ท เมทัลเวิร์ค จำกัด' },
        { name: 'nameEn', label: 'ชื่อภาษาอังกฤษ', type: 'text' },
        { name: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี', type: 'text', help: '13 หลัก — จำเป็นสำหรับใบกำกับภาษี (มาตรา 86/4)' },
        { name: 'branchCode', label: 'รหัสสาขา', type: 'text', default: '00000', help: 'สำนักงานใหญ่ = 00000' },
        { name: 'branchLabel', label: 'ชื่อสาขาที่พิมพ์', type: 'text', help: 'เว้นว่าง = "สำนักงานใหญ่" หรือ "สาขาที่ 0000x" ตามรหัส' },
        { name: 'address', label: 'ที่อยู่', type: 'textarea', required: true },
        { name: 'phone', label: 'โทรศัพท์', type: 'text' },
        { name: 'email', label: 'อีเมล', type: 'email' },
        { name: 'website', label: 'เว็บไซต์', type: 'text' },
        { name: 'signatureLabels', label: 'ช่องลายเซ็นเริ่มต้น', type: 'text', help: 'คั่นด้วยจุลภาค เช่น ผู้จัดทำ, ผู้อนุมัติ — ใช้กับเอกสารที่ไม่ได้กำหนดเอง' },
        { name: 'footerNote', label: 'หมายเหตุท้ายเอกสาร', type: 'textarea', help: 'เงื่อนไขการชำระเงิน เช่น "ชำระภายใน 30 วัน…" — พิมพ์เฉพาะท้ายใบกำกับภาษี/ใบแจ้งหนี้และใบเสนอราคา (ไม่พิมพ์บนใบสั่งซื้อ ใบเสร็จ สลิป ใบเบิก)' },
        { name: 'logo', label: 'โลโก้บริษัท', type: 'image', help: 'ไฟล์รูป PNG, JPEG หรือ SVG ไม่เกิน 300 KB — พิมพ์ที่หัวเอกสารทุกฉบับ' },
      ],
      after: { screen: 'company' },
    },
    users: {
      kind: 'list', title: 'ผู้ใช้', endpoint: '/users', perm: 'identity.user.read',
      columns: [
        { key: 'email', label: 'อีเมล' }, { key: 'name', label: 'ชื่อ' },
        { key: 'roles', label: 'บทบาท', format: 'list' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'userNew', createLabel: 'เพิ่มผู้ใช้',
      rowLink: { screen: 'userDetail' },
      rowActions: [
        { id: 'roles', label: 'กำหนดบทบาท', method: 'PUT', endpoint: '/users/:id/roles', perm: 'identity.user.write', toast: 'message',
          fields: [{ name: 'roleIds', label: 'บทบาท', type: 'multilookup', lookup: roleLookup, required: true }] },
        { id: 'deactivate', label: 'ปิดใช้งาน', method: 'POST', endpoint: '/users/:id/deactivate', perm: 'identity.user.write',
          when: { field: 'active', in: [true] }, confirm: 'ผู้ใช้นี้จะเข้าสู่ระบบไม่ได้อีก และถูกออกจากระบบทุกอุปกรณ์ทันที', tone: 'danger' },
      ],
    },
    userDetail: {
      kind: 'detail', title: 'ผู้ใช้', endpoint: '/users/:id', heading: 'name', perm: 'identity.user.read',
      fields: [
        { key: 'email', label: 'อีเมล' },
        { key: 'active', label: 'ใช้งาน', format: 'boolean' },
        { key: 'roles', label: 'บทบาท', format: 'list' },
        { key: 'created_at', label: 'สร้างเมื่อ', format: 'datetime' },
        { key: 'sessions_revoked_at', label: 'ยกเลิกเซสชันล่าสุด', format: 'datetime' },
        { key: 'sessions_revoked_reason', label: 'สาเหตุ' },
      ],
      actions: [
        { id: 'forceLogout', label: 'บังคับออกจากระบบ', method: 'POST', endpoint: '/users/:id/revoke-sessions', perm: 'identity.user.write', toast: 'message',
          confirm: 'ผู้ใช้นี้จะถูกออกจากระบบทุกอุปกรณ์ทันที (เข้าสู่ระบบใหม่ได้ด้วยรหัสผ่านเดิม) — ใช้เมื่อเครื่องหาย หรือสงสัยว่ามีคนอื่นใช้บัญชี', tone: 'danger' },
        { id: 'roles', label: 'กำหนดบทบาท', method: 'PUT', endpoint: '/users/:id/roles', perm: 'identity.user.write', toast: 'message',
          fields: [{ name: 'roleIds', label: 'บทบาท', type: 'multilookup', lookup: roleLookup, required: true }] },
        { id: 'deactivate', label: 'ปิดใช้งาน', method: 'POST', endpoint: '/users/:id/deactivate', perm: 'identity.user.write',
          when: { field: 'active', in: [true] }, confirm: 'ผู้ใช้นี้จะเข้าสู่ระบบไม่ได้อีก และถูกออกจากระบบทุกอุปกรณ์ทันที', tone: 'danger' },
      ],
    },
    changePassword: {
      // every signed-in user (no perm, not in the menu — the web links it from the user box next to "ออกจากระบบ")
      kind: 'form', title: 'เปลี่ยนรหัสผ่าน', method: 'POST', endpoint: '/me/password', submitLabel: 'เปลี่ยนรหัสผ่าน',
      fields: [
        { name: 'currentPassword', label: 'รหัสผ่านปัจจุบัน', type: 'password', required: true },
        { name: 'newPassword', label: 'รหัสผ่านใหม่', type: 'password', required: true, help: 'อย่างน้อย 8 ตัวอักษร — อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะถูกออกจากระบบ' },
      ],
    },
    userNew: {
      kind: 'form', title: 'เพิ่มผู้ใช้', method: 'POST', endpoint: '/users', perm: 'identity.user.write', submitLabel: 'เพิ่มผู้ใช้',
      fields: [
        { name: 'email', label: 'อีเมล', type: 'email', required: true },
        { name: 'name', label: 'ชื่อ', type: 'text', required: true },
        { name: 'password', label: 'รหัสผ่านเริ่มต้น', type: 'password', required: true, help: 'อย่างน้อย 8 ตัวอักษร' },
        { name: 'roleIds', label: 'บทบาท', type: 'multilookup', lookup: roleLookup },
      ],
      after: { screen: 'users' },
    },
    roles: {
      kind: 'list', title: 'บทบาทและสิทธิ์', endpoint: '/roles', perm: 'identity.user.read',
      columns: [{ key: 'name', label: 'บทบาท' }, { key: 'permissions', label: 'สิทธิ์', format: 'list' }],
      create: 'roleNew', createLabel: 'เพิ่มบทบาท',
      actions: [
        { id: 'fromTemplate', label: 'สร้างบทบาทจากแม่แบบ', method: 'POST', endpoint: '/roles/from-template', perm: 'identity.role.write', tone: 'primary', toast: 'message',
          fields: [
            { name: 'template', label: 'แม่แบบ', type: 'lookup', required: true,
              lookup: { path: '/role-templates', label: ['name', 'description'], assign: { template: 'id' } },
              help: 'เช่น พนักงานทั่วไป (บริการตนเอง), หัวหน้างาน, ฝ่ายบุคคล, บัญชีและการเงิน — ใส่เฉพาะสิทธิ์ของโมดูลที่ติดตั้ง' },
            { name: 'name', label: 'ชื่อบทบาท', type: 'text', help: 'เว้นว่าง = ชื่อแม่แบบ ปรับสิทธิ์ภายหลังได้' },
          ] },
      ],
    },
    roleNew: {
      kind: 'form', title: 'เพิ่มบทบาท', method: 'POST', endpoint: '/roles', perm: 'identity.role.write', submitLabel: 'บันทึกบทบาท',
      fields: [
        { name: 'name', label: 'ชื่อบทบาท', type: 'text', required: true },
        { name: 'permissions', label: 'สิทธิ์', type: 'permissions', required: true },
      ],
      after: { screen: 'roles' },
    },
  },
});
