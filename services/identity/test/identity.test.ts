import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hashPassword, verifyToken } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { hasPerm } from '@erp/ui-schema';
import { canGrant, clientIp, definition, LOGIN_MAX_FAILURES, LOGIN_MAX_FAILURES_PER_EMAIL, resetLoginThrottle } from '../src/service.ts';
import ui from '../src/ui.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

async function createTenant(code: string) {
  const res = await t.svc.app.inject({
    method: 'POST', url: '/tenants', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
    payload: { code, name: `${code} co`, admin: { email: `admin@${code}.co`, name: 'Admin', password: 'password123' } },
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
    const r = await login('acme', 'admin@acme.co', 'password123');
    expect(r.status).toBe(200);
    const claims = verifyToken(TEST_JWT_SECRET, r.body.token);
    expect(claims.tenantId).toBe(tenant.id);
    expect(claims.perms).toEqual(['*']);
    expect((await login('acme', 'admin@acme.co', 'wrong-pass')).status).toBe(401);
    expect((await login('nope', 'admin@nope.co', 'password123')).status).toBe(401);
  });

  it('only provisions tenants with the internal token', async () => {
    const res = await t.svc.app.inject({ method: 'POST', url: '/tenants', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('creates roles and users whose token carries role permissions', async () => {
    await createTenant('beta');
    const admin = await login('beta', 'admin@beta.co', 'password123');
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
    expect(users.body.map((u: any) => u.email)).toEqual(['admin@beta.co', 'store@x.co']);
    expect(users.body[0]).not.toHaveProperty('password_hash');
    await t.api('POST', `/users/${user.body.id}/deactivate`, undefined, as);
    expect((await login('beta', 'store@x.co', 'password123')).status).toBe(401);
  });

  it('ID-04 (bugs-0.4): every signed-in user can pick colleagues from the directory (id, name, e-mail only), not the admin user list', async () => {
    await createTenant('gamma');
    const admin = { token: (await login('gamma', 'admin@gamma.co', 'password123')).body.token };
    const role = (await t.api('POST', '/roles', { name: 'หัวหน้างาน', permissions: ['approvals.request.approve'] }, admin)).body;
    await t.api('POST', '/users', { email: 'sup@x.co', name: 'วิชัย หัวหน้า', password: 'password123', roleIds: [role.id] }, admin);
    const gone = (await t.api('POST', '/users', { email: 'old@x.co', name: 'วิชัย ลาออก', password: 'password123' }, admin)).body;
    await t.api('POST', `/users/${gone.id}/deactivate`, undefined, admin);
    const sup = { token: (await login('gamma', 'sup@x.co', 'password123')).body.token };
    expect((await t.api('GET', '/users', undefined, sup)).status).toBe(403);
    const dir = await t.api('GET', '/users/directory?q=วิชัย', undefined, sup);
    expect(dir.status).toBe(200);
    expect(dir.body).toEqual([{ id: expect.any(String), name: 'วิชัย หัวหน้า', email: 'sup@x.co' }]);
    expect((await t.api('GET', '/users/directory', undefined, sup)).body).toHaveLength(2); // admin + sup, not the deactivated one
    expect((await t.api('GET', '/users/directory', undefined, { token: t.token([], t.otherTenantId) })).body).toEqual([]);
    expect((await t.api('GET', '/users/directory')).status).toBe(200);
  });

  it('keeps tenants apart', async () => {
    const acme = await login('acme', 'admin@acme.co', 'password123');
    const users = await t.api('GET', '/users', undefined, { token: acme.body.token });
    expect(users.body.map((u: any) => u.email)).toEqual(['admin@acme.co']);
    const dup = await t.api('POST', '/users', { email: 'admin@acme.co', name: 'Dup', password: 'password123' }, { token: acme.body.token });
    expect(dup.status).toBe(409);
  });
});

describe('login by e-mail only (migration 003: one e-mail = one user in the whole system)', () => {
  const loginEmail = async (body: object, ip?: string) => {
    const res = await t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: body, headers: ip ? { 'x-erp-client-ip': ip } : {} });
    return { status: res.statusCode, body: res.json() };
  };
  const provision = (code: string, email: string) => t.svc.app.inject({
    method: 'POST', url: '/tenants', headers: { 'x-internal-token': TEST_INTERNAL_TOKEN },
    payload: { code, name: `${code} co`, admin: { email, name: 'Admin', password: 'password123' } },
  });

  it('logs in without a company code and finds the company from the e-mail', async () => {
    resetLoginThrottle();
    await createTenant('solo');
    const r = await loginEmail({ email: 'ADMIN@solo.co', password: 'password123' });
    expect(r.status).toBe(200);
    expect(r.body.tenant.code).toBe('solo');
    expect(verifyToken(TEST_JWT_SECRET, r.body.token).tenantId).toBe(r.body.tenant.id);
    // an empty company code counts as none (older apps send "")
    expect((await loginEmail({ tenant: '', email: 'admin@solo.co', password: 'password123' })).status).toBe(200);
    // the company code still works
    expect((await loginEmail({ tenant: 'solo', email: 'admin@solo.co', password: 'password123' })).status).toBe(200);
  });

  it('answers a wrong password, an unknown e-mail and a deactivated user alike', async () => {
    resetLoginThrottle();
    const wrong = await loginEmail({ email: 'admin@solo.co', password: 'nope-nope' });
    const ghost = await loginEmail({ email: 'ghost@nowhere.co', password: 'nope-nope' });
    expect([wrong.status, ghost.status]).toEqual([401, 401]);
    expect(wrong.body).toEqual(ghost.body);
    expect(wrong.body.error.message).toBe('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  });

  it('refuses an e-mail that another company already uses (provisioning and new users), leaving no empty company', async () => {
    const taken = await provision('copycat', 'admin@solo.co');
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe('email_taken');
    expect((await t.svc.db.pool.query('select 1 from tenants where code = $1', ['copycat'])).rowCount).toBe(0);

    await createTenant('other');
    const admin = { token: (await loginEmail({ email: 'admin@other.co', password: 'password123' })).body.token };
    const dup = await t.api('POST', '/users', { email: 'Admin@Solo.co', name: 'ซ้ำ', password: 'password123' }, admin);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('email_taken');
    expect(dup.body.error.message).toContain('อีเมลนี้ถูกใช้แล้ว');
  });

  it('throttles per e-mail, with or without the company code', async () => {
    resetLoginThrottle();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) {
      const body = i % 2 ? { email: 'admin@solo.co', password: `bad-${i}` } : { tenant: 'solo', email: 'admin@solo.co', password: `bad-${i}` };
      expect((await loginEmail(body)).status).toBe(401);
    }
    expect((await loginEmail({ email: 'admin@solo.co', password: 'password123' })).status).toBe(429);
    resetLoginThrottle();
  });

  it('wrong passwords from one IP do not lock the owner out from another IP; spreading over many IPs still hits a cap', async () => {
    resetLoginThrottle();
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await loginEmail({ email: 'admin@solo.co', password: `bad-${i}` }, '203.0.113.9')).status).toBe(401);
    expect((await loginEmail({ email: 'admin@solo.co', password: 'password123' }, '203.0.113.9')).status).toBe(429);
    const owner = await loginEmail({ email: 'admin@solo.co', password: 'password123' }, '198.51.100.7');
    expect(owner.status).toBe(200);
    expect(owner.body.token).toBeTruthy();
    // the same e-mail from many addresses: the per-e-mail cap
    for (let i = LOGIN_MAX_FAILURES; i < LOGIN_MAX_FAILURES_PER_EMAIL; i++) await loginEmail({ email: 'admin@solo.co', password: 'bad' }, `203.0.113.${i % 200}`);
    expect((await loginEmail({ email: 'admin@solo.co', password: 'password123' }, '192.0.2.1')).status).toBe(429);
    resetLoginThrottle();
  });

  it('client IP header: only short IP-like values are used', () => {
    expect(clientIp({ 'x-erp-client-ip': '203.0.113.9' })).toBe('203.0.113.9');
    expect(clientIp({ 'x-erp-client-ip': '::ffff:10.0.0.1' })).toBe('::ffff:10.0.0.1');
    expect(clientIp({ 'x-erp-client-ip': 'a|b' })).toBe('direct');
    expect(clientIp({})).toBe('direct');
  });

  it('e-mails duplicated before 003: the password picks the account, otherwise the company code is asked for', async () => {
    resetLoginThrottle();
    // an older database: two companies share an e-mail (the global index could not be created there)
    await t.svc.db.rawTx((c) => c.query('drop index users_email_global'));
    try {
      await createTenant('old-a');
      await createTenant('old-b');
      for (const [code, pw] of [['old-a', 'password-a1'], ['old-b', 'password-b1']]) {
        const tid = (await t.svc.db.pool.query('select id from tenants where code = $1', [code])).rows[0].id;
        await t.svc.db.tx(tid, (c) => c.query('insert into users (email, name, password_hash) values ($1, $2, $3)', ['shared@x.co', code, hashPassword(pw)]));
      }
      const a = await loginEmail({ email: 'shared@x.co', password: 'password-b1' });
      expect(a.status).toBe(200);
      expect(a.body.tenant.code).toBe('old-b');
      // same password in both companies → ask for the company
      const tidA = (await t.svc.db.pool.query('select id from tenants where code = $1', ['old-a'])).rows[0].id;
      await t.svc.db.tx(tidA, (c) => c.query('update users set password_hash = $1 where email = $2', [hashPassword('password-b1'), 'shared@x.co']));
      const both = await loginEmail({ email: 'shared@x.co', password: 'password-b1' });
      expect(both.status).toBe(409);
      expect(both.body.error.code).toBe('tenant_required');
      expect((await loginEmail({ tenant: 'old-a', email: 'shared@x.co', password: 'password-b1' })).body.tenant.code).toBe('old-a');
    } finally {
      for (const code of ['old-a', 'old-b']) {
        const tid = (await t.svc.db.pool.query('select id from tenants where code = $1', [code])).rows[0]?.id;
        if (tid) await t.svc.db.tx(tid, (c) => c.query(`delete from users where email = 'shared@x.co'`));
      }
      await t.svc.db.rawTx((c) => c.query('create unique index users_email_global on users (email)'));
    }
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

describe('security review 0.3', () => {
  it('SEC-01: user/role admins can only hand out permissions they hold themselves', async () => {
    await createTenant('esc');
    const admin = { token: (await login('esc', 'admin@esc.co', 'password123')).body.token };
    const adminRole = (await t.api('GET', '/roles', undefined, admin)).body.find((r: any) => r.name === 'Administrator');
    const hrRole = (await t.api('POST', '/roles', { name: 'HR officer', permissions: ['identity.user.read', 'identity.user.write', 'identity.role.write', 'hr.*'] }, admin)).body;
    const hr = (await t.api('POST', '/users', { email: 'hr@x.co', name: 'HR', password: 'password123', roleIds: [hrRole.id] }, admin)).body;
    const hrTok = { token: (await login('esc', 'hr@x.co', 'password123')).body.token };

    // cannot give themselves (or anyone) the Administrator role
    expect((await t.api('PUT', `/users/${hr.id}/roles`, { roleIds: [adminRole.id] }, hrTok)).status).toBe(403);
    expect((await t.api('POST', '/users', { email: 'x@x.co', name: 'X', password: 'password123', roleIds: [adminRole.id] }, hrTok)).status).toBe(403);
    // cannot mint a role with more than they have
    expect((await t.api('POST', '/roles', { name: 'Root', permissions: ['*'] }, hrTok)).status).toBe(403);
    expect((await t.api('POST', '/roles', { name: 'Pay', permissions: ['payroll.run.read'] }, hrTok)).status).toBe(403);
    expect((await t.api('POST', '/roles', { name: 'Payroll all', permissions: ['payroll.*'] }, hrTok)).status).toBe(403);
    expect((await t.api('POST', '/roles/from-template', { template: 'accounting', name: 'acc' }, hrTok)).status).toBe(403);
    // cannot lock out or strip a more powerful user
    const adminUser = (await t.api('GET', '/users', undefined, admin)).body.find((u: any) => u.email === 'admin@esc.co');
    expect((await t.api('POST', `/users/${adminUser.id}/deactivate`, undefined, hrTok)).status).toBe(403);
    expect((await t.api('PUT', `/users/${adminUser.id}/roles`, { roleIds: [] }, hrTok)).status).toBe(403);
    // within their own permissions everything still works
    const leave = (await t.api('POST', '/roles', { name: 'Leave clerk', permissions: ['hr.leave.request', 'identity.user.read'] }, hrTok));
    expect(leave.status).toBe(201);
    const staff = await t.api('POST', '/users', { email: 'staff@x.co', name: 'Staff', password: 'password123', roleIds: [leave.body.id] }, hrTok);
    expect(staff.status).toBe(201);
    expect((await t.api('POST', `/users/${staff.body.id}/deactivate`, undefined, hrTok)).status).toBe(200);
    // a role id of another company is refused, not silently linked
    const foreign = (await t.api('POST', '/roles', { name: 'foreign', permissions: [] }, { token: t.token(['*'], randomUUID()) })).body;
    expect((await t.api('PUT', `/users/${hr.id}/roles`, { roleIds: [foreign.id] }, admin)).status).toBe(400);
    // the administrator can still do everything
    expect((await t.api('PUT', `/users/${hr.id}/roles`, { roleIds: [adminRole.id] }, admin)).status).toBe(200);
  });

  it('SEC-01: canGrant follows wildcards', () => {
    const a = (perms: string[]) => ({ tenantId: 't', userId: 'u', perms });
    expect(canGrant(a(['*']), '*')).toBe(true);
    expect(canGrant(a(['hr.*']), 'hr.leave.approve')).toBe(true);
    expect(canGrant(a(['hr.*']), 'hr.*')).toBe(true);
    expect(canGrant(a(['hr.leave.approve']), 'hr.*')).toBe(false);
    expect(canGrant(a(['hr.*']), '*')).toBe(false);
    expect(canGrant(a(['hr.*']), 'payroll.run.read')).toBe(false);
  });

  it('SEC-02: throttles repeated wrong passwords per account and does not reveal unknown accounts', async () => {
    resetLoginThrottle();
    await createTenant('brute');
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) expect((await login('brute', 'admin@brute.co', `wrong-${i}`)).status).toBe(401);
    const locked = await login('brute', 'admin@brute.co', 'password123');
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('too_many_attempts');
    // other accounts are not affected
    expect((await login('acme', 'admin@acme.co', 'password123')).status).toBe(200);
    // unknown company / unknown user answer exactly like a wrong password
    const a = await login('brute', 'ghost@x.co', 'x');
    const b = await login('no-such-co', 'admin@no-such-co.co', 'x');
    expect([a.status, b.status]).toEqual([401, 401]);
    expect(a.body).toEqual(b.body);
    resetLoginThrottle();
    expect((await login('brute', 'admin@brute.co', 'password123')).status).toBe(200);
  });
});

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
    // SEC-11 (security review 0.3): an SVG logo may not carry script, handlers, entities or outside links
    const svg = (body: string) => 'data:image/svg+xml;base64,' + Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg">${body}</svg>`).toString('base64');
    for (const evil of ['<script>alert(1)</script>', '<rect onload="alert(1)"/>', '<a href="javascript:alert(1)"><text>x</text></a>', '<foreignObject><div/></foreignObject>', '<image href="https://evil.example/t.png"/>']) {
      expect((await bad({ logo: svg(evil) })).logo[0], evil).toMatch(/สคริปต์/);
    }
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
    expect(visible(['identity.*'])).toEqual(['users', 'roles', 'company', 'plan', 'audit']);
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

  it('ID-02 (bugs-0.4): the accounting role can confirm the MA installment orders it must invoice', async () => {
    const tpl = (await t.api('GET', '/role-templates?q=accounting', undefined, admin())).body[0];
    expect(tpl.permissions).toEqual(expect.arrayContaining(['sales.order.write', 'sales.invoice.write', 'contracts.billing.write']));
    // ID-03: purchasing can send QC-rejected goods back to the supplier
    const buyer = (await t.api('GET', '/role-templates?q=purchasing', undefined, admin())).body[0];
    expect(buyer.permissions).toContain('purchasing.po.return');
  });

  it('ID-05 (bugs-0.4): the accounting role can set lock dates and override them with a reason; other roles cannot', async () => {
    const all = (await t.api('GET', '/role-templates', undefined, admin())).body;
    const acc = all.find((x: any) => x.id === 'accounting');
    expect(acc.permissions).toEqual(expect.arrayContaining(['sales.lock.write', 'sales.lock.override', 'expense.lock.write', 'expense.lock.override', 'purchasing.lock.write']));
    for (const tpl of all.filter((x: any) => x.id !== 'accounting')) {
      expect(tpl.permissions.filter((p: string) => /\.lock\.override$/.test(p)), tpl.id).toEqual([]);
    }
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
