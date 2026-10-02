import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { verifyToken } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { hasPerm } from '@erp/ui-schema';
import { definition } from '../src/service.ts';
import ui from '../src/ui.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

async function createTenant(code: string) {
  const res = await t.svc.app.inject({
    method: 'POST', url: '/tenants', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
    payload: { code, name: `${code} co`, admin: { email: 'admin@x.co', name: 'Admin', password: 'password123' } },
  });
  expect(res.statusCode).toBe(201);
  return res.json();
}

async function login(tenant: string, email: string, password: string) {
  const res = await t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { tenant, email, password } });
  return { status: res.statusCode, body: res.json() };
}

describe('identity', () => {
  it('provisions a tenant and logs the admin in with full permissions', async () => {
    const { tenant } = await createTenant('acme');
    const r = await login('acme', 'ADMIN@x.co', 'password123');
    expect(r.status).toBe(200);
    const claims = verifyToken(TEST_JWT_SECRET, r.body.token);
    expect(claims.tenantId).toBe(tenant.id);
    expect(claims.perms).toEqual(['*']);
    expect((await login('acme', 'admin@x.co', 'wrong-pass')).status).toBe(401);
    expect((await login('nope', 'admin@x.co', 'password123')).status).toBe(401);
  });

  it('only provisions tenants with the internal token', async () => {
    const res = await t.svc.app.inject({ method: 'POST', url: '/tenants', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('creates roles and users whose token carries role permissions', async () => {
    await createTenant('beta');
    const admin = await login('beta', 'admin@x.co', 'password123');
    const as = { token: admin.body.token };
    const role = await t.api('POST', '/roles', { name: 'Storekeeper', permissions: ['inventory.*', 'master.item.read'] }, as);
    expect(role.status).toBe(201);
    const user = await t.api('POST', '/users', { email: 'store@x.co', name: 'Store', password: 'password123', roleIds: [role.body.id] }, as);
    expect(user.status).toBe(201);
    const store = await login('beta', 'store@x.co', 'password123');
    expect(store.body.permissions).toEqual(['inventory.*', 'master.item.read']);
    const forbidden = await t.api('POST', '/users', { email: 'x@x.co', name: 'X', password: 'password123' }, { token: store.body.token });
    expect(forbidden.status).toBe(403);
    const users = await t.api('GET', '/users', undefined, as);
    expect(users.body.map((u: any) => u.email)).toEqual(['admin@x.co', 'store@x.co']);
    expect(users.body[0]).not.toHaveProperty('password_hash');
    await t.api('POST', `/users/${user.body.id}/deactivate`, undefined, as);
    expect((await login('beta', 'store@x.co', 'password123')).status).toBe(401);
  });

  it('keeps tenants apart', async () => {
    const acme = await login('acme', 'admin@x.co', 'password123');
    const users = await t.api('GET', '/users', undefined, { token: acme.body.token });
    expect(users.body.map((u: any) => u.email)).toEqual(['admin@x.co']);
    const dup = await t.api('POST', '/users', { email: 'admin@x.co', name: 'Dup', password: 'password123' }, { token: acme.body.token });
    expect(dup.status).toBe(409);
  });
});

/** A valid 13-digit tax ID: the first 12 digits + the mod-11 check digit. */
function taxId(first12: string) {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (13 - i);
  return first12 + ((11 - (sum % 11)) % 10);
}
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const SVG = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>').toString('base64');

describe('company profile', () => {
  const tenantA = '7b0c1d36-0000-4000-8000-00000000c0a1';
  const tenantB = '7b0c1d36-0000-4000-8000-00000000c0b2';
  const admin = (tenant = tenantA) => ({ token: t.token(['identity.company.write'], tenant) });
  const reader = (tenant = tenantA) => ({ token: t.token([], tenant) });
  const profile = {
    legalName: 'บริษัท ทดสอบ จำกัด', nameEn: 'Test Co., Ltd.', taxId: taxId('010555912345'), branchCode: '00000',
    address: '99 ถ.สุขุมวิท ต.บางเมือง อ.เมืองสมุทรปราการ จ.สมุทรปราการ 10270', phone: '02-000-0000', email: 'acc@test.co.th',
    website: 'test.co.th', logo: PNG, footerNote: 'ชำระภายใน 30 วัน', signatureLabels: 'ผู้จัดทำ, ผู้อนุมัติ',
  };

  it('answers a default (not configured) profile before setup', async () => {
    const r = await t.api('GET', '/company', undefined, reader());
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ configured: false, tax_id: null, branch_code: '00000', branch_label: null, branch_text: 'สำนักงานใหญ่', signature_labels: [] });
  });

  it('saves and reads the profile; any signed-in user may read it', async () => {
    const put = await t.api('PUT', '/company', profile, admin());
    expect(put.status).toBe(200);
    expect(put.body).toMatchObject({ configured: true, legal_name: 'บริษัท ทดสอบ จำกัด', tax_id: profile.taxId, branch_label: null, branch_text: 'สำนักงานใหญ่', signature_labels: ['ผู้จัดทำ', 'ผู้อนุมัติ'], logo: PNG });
    const got = await t.api('GET', '/company', undefined, reader());
    expect(got.body).toMatchObject({ configured: true, email: 'acc@test.co.th', footer_note: 'ชำระภายใน 30 วัน' });
    // second save replaces (upsert), branch wording follows the code, labels may come as an array, the tax id may be typed with dashes
    const id = taxId('010555912345');
    const again = await t.api('PUT', '/company', { ...profile, taxId: `${id.slice(0, 1)}-${id.slice(1, 5)}-${id.slice(5, 10)}-${id.slice(10)}`, branchCode: '00012', logo: SVG, signatureLabels: ['ผู้รับเงิน'], email: '' }, admin());
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ branch_label: null, branch_text: 'สาขาที่ 00012', tax_id: id, logo: SVG, signature_labels: ['ผู้รับเงิน'], email: null });
    const named = await t.api('PUT', '/company', { ...profile, branchCode: '00012', branchLabel: 'สาขาบางนา' }, admin());
    expect(named.body).toMatchObject({ branch_label: 'สาขาบางนา', branch_text: 'สาขาบางนา' });
  });

  it('needs identity.company.write to change it', async () => {
    expect((await t.api('PUT', '/company', profile, reader())).status).toBe(403);
    expect((await t.svc.app.inject({ method: 'GET', url: '/company' })).statusCode).toBe(401);
  });

  it('validates tax id, branch code, email and logo', async () => {
    const bad = async (patch: Record<string, unknown>) => {
      const r = await t.api('PUT', '/company', { ...profile, ...patch }, admin());
      expect(r.status).toBe(400);
      return r.body.error.details.fieldErrors as Record<string, string[]>;
    };
    const wrongCheck = profile.taxId.slice(0, 12) + ((Number(profile.taxId[12]) + 1) % 10);
    expect((await bad({ taxId: wrongCheck })).taxId[0]).toMatch(/เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง/);
    expect((await bad({ taxId: '12345' })).taxId).toBeTruthy();
    expect((await bad({ branchCode: '1' })).branchCode[0]).toMatch(/5 หลัก/);
    expect((await bad({ email: 'not-an-email' })).email).toBeTruthy();
    expect((await bad({ legalName: '' })).legalName).toBeTruthy();
    expect((await bad({ address: undefined })).address).toBeTruthy();
    expect((await bad({ logo: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' })).logo[0]).toMatch(/PNG, JPEG หรือ SVG/);
    expect((await bad({ logo: 'https://example.com/logo.png' })).logo).toBeTruthy();
    // claims to be PNG but is not
    expect((await bad({ logo: 'data:image/png;base64,' + Buffer.from('hello').toString('base64') })).logo[0]).toMatch(/ไม่ตรงกับชนิด/);
    // too big (> 300 KB decoded)
    const big = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(301 * 1024)]);
    expect((await bad({ logo: 'data:image/png;base64,' + big.toString('base64') })).logo[0]).toMatch(/300 KB/);
    expect((await bad({ signatureLabels: Array(7).fill('x') })).signatureLabels).toBeTruthy();
  });

  it('keeps each company its own profile (tenant isolation)', async () => {
    const b = await t.api('GET', '/company', undefined, reader(tenantB));
    expect(b.body.configured).toBe(false);
    expect(b.body.tax_id).toBeNull();
    await t.api('PUT', '/company', { legalName: 'บริษัท บี จำกัด', address: 'กรุงเทพฯ' }, admin(tenantB));
    expect((await t.api('GET', '/company', undefined, reader(tenantA))).body.legal_name).toBe('บริษัท ทดสอบ จำกัด');
    expect((await t.api('GET', '/company', undefined, reader(tenantB))).body).toMatchObject({ legal_name: 'บริษัท บี จำกัด', tax_id: null, logo: null });
  });

  // bugs-0.3 ID-01: the open GET /company must not hand every staff member an admin "ผู้ใช้และสิทธิ์" menu group
  it('shows the company settings menu only to whoever may change it', () => {
    const visible = (perms: string[]) => ui.menu.filter((i) => hasPerm(perms, ui.screens[i.screen]?.perm)).map((i) => i.screen);
    expect(visible(['approvals.request.write', 'expense.claim.write', 'hr.leave.request'])).toEqual([]);
    expect(visible(['identity.company.write'])).toEqual(['company']);
    expect(visible(['identity.*'])).toEqual(['users', 'roles', 'company', 'audit']);
  });
});

describe('role templates', () => {
  const OFFICE = ['identity', 'master-data', 'approvals', 'expense', 'hr', 'booking', 'helpdesk', 'automation'];
  const admin = (tenantId = t.tenantId) => ({ token: t.token(['*'], tenantId) });

  it('lists the suggested Thai roles, limited to installed modules when asked', async () => {
    const all = (await t.api('GET', '/role-templates', undefined, admin())).body;
    expect(all.map((x: any) => x.name)).toEqual(expect.arrayContaining([
      'ผู้บริหาร', 'พนักงานทั่วไป', 'หัวหน้างาน', 'ฝ่ายบุคคล', 'บัญชีและการเงิน', 'จัดซื้อ', 'ฝ่ายขาย', 'คลังสินค้า', 'ช่างซ่อมบำรุง', 'QC ควบคุมคุณภาพ', 'ไอที / helpdesk', 'ผู้จัดการโครงการ',
    ]));
    const staff = all.find((x: any) => x.id === 'staff');
    expect(staff.permissions).toEqual(expect.arrayContaining([
      'approvals.request.read', 'approvals.request.write', 'expense.claim.read', 'expense.claim.write', 'hr.leave.request', 'hr.attendance.self',
      'booking.book.create', 'helpdesk.ticket.create', 'automation.notify.read',
    ]));
    // self-service only: no approving, paying, other people's data or company money
    expect(staff.permissions.filter((p: string) => /approve|pay|finance|admin|\.read$/.test(p) && !['approvals.request.read', 'expense.claim.read', 'booking.resource.read', 'helpdesk.kb.read', 'assets.asset.read', 'maintenance.machine.read', 'automation.notify.read', 'payroll.payslip.self'].includes(p))).toEqual([]);

    const office = (await t.api('GET', `/role-templates?modules=${OFFICE.join(',')}`, undefined, admin())).body;
    const sales = office.find((x: any) => x.id === 'sales');
    expect(sales.permissions.every((p: string) => !p.startsWith('crm.') && !p.startsWith('sales.'))).toBe(true);
    expect(sales.skipped).toContain('crm.quote.write');
    expect(sales.permissions).toContain('master.partner.read'); // master-data is installed
    expect((await t.api('GET', '/role-templates?q=บัญชี', undefined, admin())).body.map((x: any) => x.id)).toEqual(['accounting']);
  });

  it('creates a role from a template with only the installed modules\' permissions', async () => {
    const r = await t.api('POST', '/roles/from-template', { template: 'staff', modules: OFFICE }, admin());
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ name: 'พนักงานทั่วไป', template: 'staff' });
    expect(r.body.permissions).toContain('hr.attendance.self');
    expect(r.body.permissions.some((p: string) => p.startsWith('assets.') || p.startsWith('maintenance.'))).toBe(false);
    expect(r.body.skipped).toEqual(expect.arrayContaining(['assets.repair.report', 'maintenance.wo.report']));
    expect(r.body.message).toContain('พนักงานทั่วไป');
    const roles = (await t.api('GET', '/roles', undefined, admin())).body;
    expect(roles.find((x: any) => x.name === 'พนักงานทั่วไป').permissions).toEqual(r.body.permissions);

    // same name again -> 409; a custom name works; unknown template -> 400
    expect((await t.api('POST', '/roles/from-template', { template: 'staff', modules: OFFICE }, admin())).status).toBe(409);
    const custom = await t.api('POST', '/roles/from-template', { template: 'supervisor', name: 'หัวหน้าแผนกขาย', modules: OFFICE }, admin());
    expect(custom.status).toBe(201);
    expect(custom.body.permissions).toContain('expense.claim.approve');
    expect((await t.api('POST', '/roles/from-template', { template: 'nope' }, admin())).status).toBe(400);
    expect((await t.api('POST', '/roles/from-template', { template: 'hr', modules: ['../x'] }, admin())).status).toBe(400);
  });

  it('keeps every permission when the installed modules are unknown', async () => {
    const r = await t.api('POST', '/roles/from-template', { template: 'accounting', name: 'บัญชี (ทุกโมดูล)' }, admin());
    expect(r.status).toBe(201);
    expect(r.body.permissions).toContain('assets.finance.read');
    expect(r.body.skipped).toEqual([]);
  });

  it('needs identity.role.write to create and identity.user.read to list', async () => {
    const reader = { token: t.token(['identity.user.read']) };
    expect((await t.api('GET', '/role-templates', undefined, reader)).status).toBe(200);
    expect((await t.api('POST', '/roles/from-template', { template: 'hr', name: 'x' }, reader)).status).toBe(403);
    expect((await t.api('GET', '/role-templates', undefined, { token: t.token([]) })).status).toBe(403);
  });

  it('creates the role in the caller\'s company only', async () => {
    const other = admin(t.otherTenantId);
    expect((await t.api('POST', '/roles/from-template', { template: 'staff', modules: OFFICE }, other)).status).toBe(201); // same name, other company
    expect((await t.api('GET', '/roles', undefined, other)).body.map((x: any) => x.name)).toEqual(['พนักงานทั่วไป']);
  });
});
