import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { hasPerm } from '@erp/kernel';
import { bootTestService, TEST_INTERNAL_TOKEN, type TestService } from '@erp/kernel/testing';
import { hasPerm as uiHasPerm } from '@erp/ui-schema';
import { addMonthsIso, paymentPeriod } from '../src/plans.ts';
import { canGrant, definition, resetLoginThrottle } from '../src/service.ts';

/**
 * GO Along's back office inside its own company (OPS_TENANT_CODE): staff with the explicit identity.ops.* rights confirm transfers,
 * change plans, and every payment publishes identity.subscription_paid for the operator's sales module.
 */
let t: TestService;
beforeAll(async () => { t = await bootTestService(definition, { OPS_TENANT_CODE: 'goalong' }); await resetLoginThrottle(); });
afterAll(async () => { await t?.close(); });

const internal = { 'x-internal-token': TEST_INTERNAL_TOKEN };
const provision = (code: string, plan?: string) => t.svc.app.inject({
  method: 'POST', url: '/tenants', headers: internal,
  payload: { code, name: `${code} co`, admin: { email: `admin@${code}.co`, name: `Admin ${code}`, password: 'password123' }, ...(plan ? { plan } : {}) },
});
const login = async (email: string) =>
  (await t.svc.app.inject({ method: 'POST', url: '/auth/login', payload: { email, password: 'password123' } })).json().token as string;
const as = (token: string) => async (method: string, url: string, payload?: object) => {
  const r = await t.svc.app.inject({ method: method as 'GET', url, headers: { authorization: `Bearer ${token}` }, ...(payload ? { payload } : {}) });
  return { status: r.statusCode, body: r.json() };
};

let staff: ReturnType<typeof as>;
let customerAdmin: ReturnType<typeof as>;

beforeAll(async () => {
  await provision('goalong');
  await provision('cust', 'starter');
  const granted = await t.svc.app.inject({ method: 'POST', url: '/_ops/operators', headers: internal, payload: { email: 'admin@goalong.co' } });
  expect(granted.json().message).toContain('ได้สิทธิ์หลังบ้าน GO Along');
  staff = as(await login('admin@goalong.co'));
  customerAdmin = as(await login('admin@cust.co'));
});

describe('back-office rights', () => {
  it('wildcards never grant *.ops.* (kernel, apps and role granting agree)', () => {
    const admin = { tenantId: 't', userId: 'u', perms: ['*'] };
    expect(hasPerm(admin, 'identity.ops.read')).toBe(false);
    expect(hasPerm({ ...admin, perms: ['identity.*'] }, 'identity.ops.write')).toBe(false);
    expect(hasPerm({ ...admin, perms: ['identity.ops.read'] }, 'identity.ops.read')).toBe(true);
    expect(uiHasPerm(['*'], 'identity.ops.read')).toBe(false);
    expect(uiHasPerm(['identity.ops.read'], 'identity.ops.read')).toBe(true);
    expect(canGrant(admin, 'identity.ops.write')).toBe(false);
    expect(hasPerm(admin, 'identity.user.write')).toBe(true);
  });

  it("a customer's administrator (*) cannot open the back office or give themselves its role", async () => {
    expect((await customerAdmin('GET', '/ops/tenants')).status).toBe(403);
    const role = await customerAdmin('POST', '/roles', { name: 'แอบ', permissions: ['identity.ops.read'] });
    expect(role.status).toBe(403);
  });

  it('the right only works inside the operator company', async () => {
    // a token of another company that somehow lists the permission is still refused
    const outsider = as(t.token(['identity.ops.read'], t.otherTenantId));
    expect((await outsider('GET', '/ops/tenants')).status).toBe(403);
  });
});

describe('back office', () => {
  it('lists companies with plan, status and users', async () => {
    const r = await staff('GET', '/ops/tenants?q=cust');
    expect(r.status).toBe(200);
    expect(r.body).toEqual([expect.objectContaining({ code: 'cust', plan_name: 'Starter', status_th: 'ทดลองใช้', days_left: 14, activeUsers: 1 })]);
    const all = (await staff('GET', '/ops/tenants')).body.map((x: { code: string }) => x.code);
    expect(all).toEqual(expect.arrayContaining(['goalong', 'cust']));
  });

  it('a confirmed transfer activates the company, extends it, logs the payment and asks sales for the tax invoice', async () => {
    await customerAdmin('PUT', '/company', { legalName: 'บริษัท ลูกค้า จำกัด', taxId: '0105536000313', address: '1 ถนนสุขุมวิท กรุงเทพฯ', branchCode: '00000' });
    const before = Number((await t.svc.db.pool.query(`select count(*) as n from _outbox where type = 'identity.subscription_paid'`)).rows[0].n);
    const r = await staff('POST', '/ops/tenants/cust/payments', { months: 3, plan: 'factory', ref: 'KBANK-123' });
    expect(r.status).toBe(201);
    expect(r.body.subscription).toMatchObject({ plan: 'factory', status: 'active', blocked: null });
    expect(r.body.message).toContain('บันทึกรับโอนแล้ว');
    expect(r.body.revokedUsers).toBe(1);

    const detail = (await staff('GET', '/ops/tenants/cust')).body;
    expect(detail).toMatchObject({ legal_name: 'บริษัท ลูกค้า จำกัด', tax_id: '0105536000313', invoice_ready: true, paid_through: r.body.periodTo });
    expect(detail.payments[0]).toMatchObject({ months: 3, plan: 'Factory', ref: 'KBANK-123', by_name: 'Admin goalong' });
    expect(Number(detail.payments[0].amount)).toBe(3 * 3490);
    expect(detail.log[0].change).toMatch(/^รับโอน 10,470 บาท \(3 เดือน\) .* · แพ็กเกจ Factory · สถานะ ใช้งาน · ชำระถึง \d{4}-\d{2}-\d{2}$/);

    const ev = (await t.svc.db.pool.query(`select tenant_id, data from _outbox where type = 'identity.subscription_paid' order by occurred_at desc limit 1`)).rows[0];
    expect(Number((await t.svc.db.pool.query(`select count(*) as n from _outbox where type = 'identity.subscription_paid'`)).rows[0].n)).toBe(before + 1);
    const ops = (await t.svc.db.pool.query(`select id from tenants where code = 'goalong'`)).rows[0];
    expect(ev.tenant_id).toBe(ops.id); // the operator's sales module drafts the invoice
    expect(ev.data.data).toMatchObject({ tenantCode: 'cust', companyName: 'บริษัท ลูกค้า จำกัด', taxId: '0105536000313', branch: 'สำนักงานใหญ่', planName: 'Factory', months: 3, amount: 10470 });

    // a second transfer continues from the end of the paid period
    const next = await staff('POST', '/ops/tenants/cust/payments', { months: 1, amount: 3000 });
    expect(next.body.periodFrom > r.body.periodTo).toBe(true);
    expect(next.body.revokedUsers).toBe(0); // nothing the company may use changed
  });

  it('changes plan / status with a reason; refuses a future transfer date', async () => {
    expect((await staff('POST', '/ops/tenants/cust/plan', { status: 'suspended' })).status).toBe(400); // reason required
    const s = await staff('POST', '/ops/tenants/cust/plan', { status: 'suspended', note: 'ลูกค้าขอพักการใช้งาน' });
    expect(s.body.subscription).toMatchObject({ status: 'suspended' });
    expect(s.body.message).toContain('ระงับชั่วคราว');
    const future = await staff('POST', '/ops/tenants/cust/payments', { months: 1, paidOn: '2099-01-01' });
    expect(future.status).toBe(400);
    expect((await staff('GET', '/ops/tenants/nobody')).status).toBe(404);
  });
});

describe('payment period', () => {
  it('continues the paid period, or starts today when nothing is paid or it lapsed', () => {
    expect(paymentPeriod(null, '2026-11-20', 1)).toEqual({ from: '2026-11-20', to: '2026-12-19' });
    expect(paymentPeriod('2026-12-19', '2026-11-25', 2)).toEqual({ from: '2026-12-20', to: '2027-02-19' });
    expect(paymentPeriod('2026-10-31', '2026-11-20', 1)).toEqual({ from: '2026-11-20', to: '2026-12-19' });
    expect(addMonthsIso('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsIso('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsIso('2026-11-30', 12)).toBe('2027-11-30');
  });
});
