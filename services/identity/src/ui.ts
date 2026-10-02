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
  ],
  screens: {
    users: {
      kind: 'list', title: 'ผู้ใช้', endpoint: '/users', perm: 'identity.user.read',
      columns: [
        { key: 'email', label: 'อีเมล' }, { key: 'name', label: 'ชื่อ' },
        { key: 'roles', label: 'บทบาท', format: 'list' }, { key: 'active', label: 'ใช้งาน', format: 'boolean' },
      ],
      create: 'userNew', createLabel: 'เพิ่มผู้ใช้',
      rowActions: [
        { id: 'roles', label: 'กำหนดบทบาท', method: 'PUT', endpoint: '/users/:id/roles', perm: 'identity.user.write',
          fields: [{ name: 'roleIds', label: 'บทบาท', type: 'multilookup', lookup: roleLookup, required: true }] },
        { id: 'deactivate', label: 'ปิดใช้งาน', method: 'POST', endpoint: '/users/:id/deactivate', perm: 'identity.user.write',
          when: { field: 'active', in: [true] }, confirm: 'ผู้ใช้นี้จะเข้าสู่ระบบไม่ได้อีก', tone: 'danger' },
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
