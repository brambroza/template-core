import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';
import { addDays, addMonths, todayBkk } from '../src/schedule.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const T = todayBkk();
const year = new Date().getFullYear() + 543;
const tech = { userId: randomUUID(), userName: 'ช่างวิทยา' };
const techToken = () => t.token(['contracts.visit.read', 'contracts.visit.work'], t.tenantId, tech);
const customer = { customerId: randomUUID(), customerCode: 'CUS-CBP', customerName: 'บริษัท ชลบุรี พลาสติก จำกัด' };

const base = (over: Record<string, unknown> = {}) => ({
  ...customer, title: 'MA ระบบ CCTV 32 จุด', contactName: 'คุณสมชาย', contactPhone: '081-111-2222',
  startDate: T, endDate: addDays(addMonths(T, 12), -1), value: 120000, billingPlan: 'monthly', coverage: '8x5',
  slaResponseHours: 4, slaResolveHours: 24, pmEveryMonths: 3, technicianId: tech.userId, technicianName: tech.userName,
  checklistText: '- ตรวจภาพกล้องทุกตัว\n- ตรวจ HDD ของ NVR\n3. ทำความสะอาดหน้ากล้อง',
  items: [{ asset: 'กล้อง IP 4MP x32', location: 'อาคาร A', serialNo: 'CAM-LOT-01' }, { asset: 'NVR 32CH', serialNo: 'NVR-SN-777', location: 'ห้อง Server' }],
  ...over,
});

let ma: any;

describe('contracts: create, edit, activate', () => {
  it('creates a draft MA contract with covered items and a checklist from text', async () => {
    const r = await t.api('POST', '/contracts', base());
    expect(r.status).toBe(201);
    ma = r.body;
    expect(ma).toMatchObject({ no: `MA-${year}-0001`, status: 'draft', customer_name: customer.customerName, value: 120000, billing_plan_label: 'รายเดือน', coverage_label: 'เวลาทำการ (8x5)', pm_label: 'ทุก 3 เดือน', item_count: 2 });
    expect(ma.checklist).toEqual(['ตรวจภาพกล้องทุกตัว', 'ตรวจ HDD ของ NVR', 'ทำความสะอาดหน้ากล้อง']);
    expect(ma.items.map((i: any) => i.serial_no).sort()).toEqual(['CAM-LOT-01', 'NVR-SN-777']);
    expect(ma.installments).toEqual([]); // built on activation
  });

  it('validates input (400)', async () => {
    expect((await t.api('POST', '/contracts', base({ endDate: addDays(T, -1) }))).status).toBe(400);
    expect((await t.api('POST', '/contracts', base({ slaResponseHours: 8, slaResolveHours: 4 }))).status).toBe(400);
    expect((await t.api('POST', '/contracts', base({ billingPlan: 'weekly' }))).status).toBe(400);
    expect((await t.api('POST', '/contracts', base({ firstPmDate: addMonths(T, 13) }))).status).toBe(400);
    expect((await t.api('POST', '/contracts', base({ customerName: '' }))).status).toBe(400);
  });

  it('edits a draft like the edit form does (ids only): keeps names, items and checklist', async () => {
    const r = await t.api('PUT', `/contracts/${ma.id}`, {
      customerId: customer.customerId, title: 'MA ระบบ CCTV 32 จุด + เครือข่าย', startDate: T, endDate: ma.end_date, value: 120000,
      billingPlan: 'monthly', pmEveryMonths: 3, technicianId: tech.userId,
    });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ title: 'MA ระบบ CCTV 32 จุด + เครือข่าย', customer_name: customer.customerName, customer_code: 'CUS-CBP', technician_name: tech.userName, item_count: 2 });
    expect(r.body.checklist).toHaveLength(3);
  });

  it('activates: builds 12 monthly installments summing to the value; then locks editing (409)', async () => {
    const r = await t.api('POST', `/contracts/${ma.id}/activate`);
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('active');
    expect(r.body.installments).toHaveLength(12);
    expect(r.body.installments.reduce((s: number, i: any) => s + i.amount, 0)).toBeCloseTo(120000, 2);
    expect(r.body.installments[0]).toMatchObject({ seq: 1, due_date: T, amount: 10000, invoiced: false });
    expect(r.body.unbilled_amount).toBe(120000);
    expect((await t.api('POST', `/contracts/${ma.id}/activate`)).status).toBe(409);
    expect((await t.api('PUT', `/contracts/${ma.id}`, base())).status).toBe(409);
  });

  it('adds equipment to an active contract and finds it by serial (coverage)', async () => {
    const r = await t.api('POST', `/contracts/${ma.id}/items`, { asset: 'สวิตช์ PoE 24 พอร์ต', serialNo: 'SW-POE-9001', location: 'ตู้ Rack ชั้น 2' });
    expect(r.status).toBe(201);
    expect(r.body.item_count).toBe(3);
    const cov = (await t.api('GET', '/coverage?q=SW-POE-9001')).body;
    expect(cov).toHaveLength(1);
    expect(cov[0]).toMatchObject({ no: ma.no, asset: 'สวิตช์ PoE 24 พอร์ต', coverage_label: '8x5', sla_response_hours: 4 });
    expect((await t.api('GET', '/coverage?q=NO-SUCH-SERIAL')).body).toHaveLength(0);
    expect((await t.api('GET', '/contracts?q=NVR-SN-777')).body.map((c: any) => c.no)).toEqual([ma.no]);
    const del = await t.api('DELETE', `/contract-items/${r.body.items.find((i: any) => i.serial_no === 'SW-POE-9001').id}`);
    expect(del.status).toBe(200);
  });
});

describe('PM visits', () => {
  let visits: any[];

  it('generates visits idempotently per contract + due date and publishes contracts.visit_due', async () => {
    const first = await t.api('POST', '/visits/generate', { until: T });
    expect(first.status).toBe(200);
    expect(first.body.created).toBe(1);
    const all = await t.api('POST', '/visits/generate', { until: addMonths(T, 24) });
    expect(all.body.created).toBe(3); // every 3 months within the 12-month contract = 4 visits
    expect((await t.api('POST', '/visits/generate', { until: addMonths(T, 24) })).body.created).toBe(0);
    expect((await t.api('POST', `/contracts/${ma.id}/generate-visits`, { until: addMonths(T, 24) })).body.created).toBe(0);
    visits = (await t.api('GET', `/visits?contractId=${ma.id}`)).body;
    expect(visits.map((v) => v.due_date)).toEqual([T, addMonths(T, 3), addMonths(T, 6), addMonths(T, 9)]);
    expect(visits[0]).toMatchObject({ no: `PMV-${year}-0001`, status: 'planned', technician_name: tech.userName, checks_total: 3, overdue: false });
    const ev = await t.published('contracts.visit_due');
    expect(ev).toHaveLength(4);
    expect(ev[0].data).toMatchObject({ contractNo: ma.no, customerName: customer.customerName, dueDate: T, technicianId: tech.userId, coverage: '8x5' });
    expect(ev[0].data.itemsText).toContain('NVR 32CH');
  });

  it('shows the technician their visits today and records the checklist on the phone', async () => {
    const mine = (await t.api('GET', '/visits/mine', undefined, { token: techToken() })).body;
    expect(mine.map((v: any) => v.id)).toEqual([visits[0].id]);
    const started = await t.api('POST', `/visits/${visits[0].id}/start`, undefined, { token: techToken() });
    expect(started.status).toBe(200);
    expect(started.body.started_at).not.toBeNull();
    const checks = (await t.api('GET', `/visits/${visits[0].id}/checks`, undefined, { token: techToken() })).body;
    expect(checks.map((c: any) => c.status)).toEqual(['open', 'open', 'open']);
    expect((await t.api('POST', `/checks/${checks[0].id}/pass`, {}, { token: techToken() })).body).toMatchObject({ result: 'pass', status: 'pass' });
    expect((await t.api('POST', `/checks/${checks[1].id}/fail`, { note: 'HDD มี bad sector' }, { token: techToken() })).body).toMatchObject({ result: 'fail', note: 'HDD มี bad sector' });
  });

  it('completes only when every item has a result, with the customer sign-off', async () => {
    const id = visits[0].id;
    const notYet = await t.api('POST', `/visits/${id}/complete`, { signoffName: 'คุณสมชาย' }, { token: techToken() });
    expect(notYet.status).toBe(409);
    expect((await t.api('POST', `/visits/${id}/complete`, {}, { token: techToken() })).status).toBe(400); // sign-off name required
    const done = await t.api('POST', `/visits/${id}/complete`, { signoffName: 'คุณสมชาย', findings: 'แนะนำเปลี่ยน HDD', markRemainingPass: true }, { token: techToken() });
    expect(done.status).toBe(200);
    expect(done.body).toMatchObject({ status: 'done', done_on: T, signoff_name: 'คุณสมชาย', completed_by_name: tech.userName, checks_done: 3, checks_failed: 1 });
    expect(done.body.checks.map((c: any) => c.result_label)).toEqual(['ผ่าน', 'ไม่ผ่าน', 'ผ่าน']);
    expect((await t.api('POST', `/visits/${id}/complete`, { signoffName: 'x' }, { token: techToken() })).status).toBe(409);
    expect((await t.api('POST', `/checks/${done.body.checks[0].id}/fail`, {}, { token: techToken() })).status).toBe(409);
    expect((await t.api('POST', `/visits/${id}/miss`, { reason: 'x' })).status).toBe(409);
  });

  it('flags overdue visits, lists them for "PM วันนี้", and handles missed → rescheduled', async () => {
    const v = visits[1];
    const moved = await t.api('PUT', `/visits/${v.id}`, { scheduledDate: addDays(T, -3), technicianId: tech.userId });
    expect(moved.body).toMatchObject({ overdue: true, technician_name: tech.userName, days_to: -3 });
    expect((await t.api('GET', '/visits/today')).body.map((x: any) => x.id)).toEqual([v.id]);
    expect((await t.api('GET', '/visits?overdue=1')).body.map((x: any) => x.id)).toEqual([v.id]);
    expect((await t.api('GET', '/summary')).body.overdueVisits).toBe(1);
    const missed = await t.api('POST', `/visits/${v.id}/miss`, { reason: 'ลูกค้าปิดโรงงาน' });
    expect(missed.body).toMatchObject({ status: 'missed', overdue: false, missed_reason: 'ลูกค้าปิดโรงงาน' });
    expect((await t.api('POST', `/visits/${v.id}/miss`, { reason: 'x' })).status).toBe(409);
    expect((await t.api('PUT', `/visits/${v.id}`, { scheduledDate: T })).status).toBe(409);
    const again = await t.api('POST', `/visits/${v.id}/reschedule`, { scheduledDate: addDays(T, 2) });
    expect(again.body).toMatchObject({ status: 'planned', scheduled_date: addDays(T, 2), missed_reason: null });
  });
});

describe('billing schedule', () => {
  it('lists installments due this month and records the sales invoice number', async () => {
    const due = (await t.api('GET', '/billing')).body;
    expect(due.length).toBeGreaterThanOrEqual(1);
    const first = due.find((i: any) => i.contract_no === ma.no && i.seq === 1);
    expect(first).toMatchObject({ amount: 10000, invoiced: false, period_label: '1/12', customer_name: customer.customerName });
    const billed = await t.api('POST', `/installments/${first.id}/bill`, { invoiceNo: `INV-${year}-0014` });
    expect(billed.status).toBe(200);
    expect(billed.body).toMatchObject({ invoiced: true, invoice_no: `INV-${year}-0014`, invoiced_on: T });
    expect((await t.api('POST', `/installments/${first.id}/bill`, { invoiceNo: 'X' })).status).toBe(409);
    expect((await t.api('POST', `/installments/${first.id}/bill`, {})).status).toBe(400);
    expect((await t.api('GET', '/billing')).body.find((i: any) => i.id === first.id)).toBeUndefined();
    expect((await t.api('GET', '/billing?scope=all')).body.filter((i: any) => i.contract_no === ma.no)).toHaveLength(12);
    expect((await t.api('GET', '/billing?scope=open')).body.filter((i: any) => i.contract_no === ma.no)).toHaveLength(11);
    const c = (await t.api('GET', `/contracts/${ma.id}`)).body;
    expect(c).toMatchObject({ billed_amount: 10000, unbilled_amount: 110000 });
    const un = await t.api('POST', `/installments/${first.id}/unbill`);
    expect(un.body.invoiced).toBe(false);
    expect((await t.api('POST', `/installments/${first.id}/unbill`)).status).toBe(409);
  });
});

describe('renewal, expiry and alerts', () => {
  let short: any;

  it('renews with a price uplift into a linked draft for the next period (once)', async () => {
    const r = await t.api('POST', `/contracts/${ma.id}/renew`, { upliftPct: 5 });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      status: 'draft', renewal_of: ma.id, renewal_of_no: ma.no, uplift_pct: 5, value: 126000,
      start_date: addMonths(T, 12), end_date: addDays(addMonths(T, 24), -1), customer_name: customer.customerName, item_count: 2,
    });
    expect(r.body.checklist).toHaveLength(3);
    expect((await t.api('GET', `/contracts/${ma.id}`)).body.renewed_to_no).toBe(r.body.no);
    expect((await t.api('POST', `/contracts/${ma.id}/renew`, { upliftPct: 3 })).status).toBe(409);
    expect((await t.api('POST', `/contracts/${r.body.id}/renew`, {})).status).toBe(409); // a draft cannot be renewed
    // cancelling the renewal frees the original to be renewed again
    expect((await t.api('POST', `/contracts/${r.body.id}/cancel`, { reason: 'ลูกค้าขอปรับขอบเขต' })).body.status).toBe('cancelled');
    expect((await t.api('GET', `/contracts/${ma.id}`)).body.renewed_to_no).toBeNull();
    const again = await t.api('POST', `/contracts/${ma.id}/renew`, { upliftPct: 0, value: 118000 });
    expect(again.body).toMatchObject({ value: 118000, status: 'draft' });
  });

  it('lists contracts expiring within 60 days and alerts once per month', async () => {
    short = (await t.api('POST', '/contracts', base({ title: 'MA เครือข่าย 3 เดือน', startDate: addDays(T, -60), endDate: addDays(T, 30), billingPlan: 'one_time', value: 30000, pmEveryMonths: 0, items: [] }))).body;
    await t.api('POST', `/contracts/${short.id}/activate`);
    const exp = (await t.api('GET', '/contracts/expiring')).body;
    expect(exp.map((c: any) => c.no)).toEqual([short.no]); // ma is 12 months out
    expect(exp[0].days_left).toBe(30);
    expect((await t.api('GET', '/contracts/expiring?days=400')).body.map((c: any) => c.no)).toEqual([short.no]); // ma is already renewed
    expect((await t.api('GET', '/contracts/expiring?days=400&all=1')).body).toHaveLength(2);
    const n1 = await t.api('POST', '/contracts/expiring/notify', {});
    expect(n1.body).toMatchObject({ notified: 1, contracts: [short.no] });
    expect((await t.api('POST', '/contracts/expiring/notify', {})).body.notified).toBe(0);
    const ev = await t.published('contracts.contract_expiring');
    expect(ev).toHaveLength(1);
    expect(ev[0].data).toMatchObject({ no: short.no, daysLeft: 30, value: 30000, customerName: customer.customerName, endDate: addDays(T, 30) });
    // no PM frequency -> no visits
    expect((await t.api('POST', `/contracts/${short.id}/generate-visits`, { until: addDays(T, 60) })).body.created).toBe(0);
  });

  it('expires active contracts after the end date; expired contracts can still be renewed', async () => {
    await t.svc.db.tx(t.tenantId, (c) => c.query(`update contracts set end_date = $2 where id = $1`, [short.id, addDays(T, -1)]));
    const c = (await t.api('GET', `/contracts/${short.id}`)).body;
    expect(c.status).toBe('expired');
    expect((await t.api('POST', `/contracts/${short.id}/cancel`, {})).status).toBe(409);
    const r = await t.api('POST', `/contracts/${short.id}/renew`, { upliftPct: 10 });
    expect(r.body).toMatchObject({ value: 33000, start_date: T });
    expect((await t.api('GET', '/coverage?q=MA เครือข่าย')).body).toHaveLength(0); // expired = not covered
  });

  it('cancelling an active contract cancels its planned visits and stops generation', async () => {
    const x = (await t.api('POST', '/contracts', base({ title: 'MA ยกเลิก', billingPlan: 'yearly', items: [] }))).body;
    await t.api('POST', `/contracts/${x.id}/activate`);
    expect((await t.api('POST', `/contracts/${x.id}/generate-visits`, { until: addMonths(T, 12) })).body.created).toBe(4);
    const cancelled = await t.api('POST', `/contracts/${x.id}/cancel`, { reason: 'ลูกค้าย้ายผู้ให้บริการ' });
    expect(cancelled.body.status).toBe('cancelled');
    expect(cancelled.body.visits.every((v: any) => v.status === 'cancelled')).toBe(true);
    expect((await t.api('POST', `/contracts/${x.id}/generate-visits`, { until: addMonths(T, 12) })).status).toBe(409);
    expect((await t.api('GET', `/billing?scope=all&contractId=${x.id}`)).body).toHaveLength(0);
  });

  it('summarises the dashboard', async () => {
    const s = (await t.api('GET', '/summary')).body;
    expect(s).toMatchObject({ activeContracts: 1, activeValue: 120000, visitsDoneMonth: 1, overdueVisits: 0, billingDueCount: 2, billingDueMonth: 40000 }); // ma's first month + the expired one-time contract (still to bill)
    expect(s.months).toHaveLength(6);
    expect(s.months[5].done).toBe(1);
    expect(s.rows.map((r: any) => r.status)).toContain('active');
    expect(s.rows.map((r: any) => r.status)).not.toContain('cancelled');
  });
});

describe('permissions and tenant isolation', () => {
  it('requires permissions (403)', async () => {
    const reader = t.token(['contracts.contract.read']);
    expect((await t.api('POST', '/contracts', base(), { token: reader })).status).toBe(403);
    expect((await t.api('POST', `/contracts/${ma.id}/renew`, {}, { token: reader })).status).toBe(403);
    expect((await t.api('GET', '/visits', undefined, { token: reader })).status).toBe(403);
    const writer = t.token(['contracts.contract.read', 'contracts.contract.write']);
    const d = await t.api('POST', '/contracts', base({ title: 'ร่างของเซลส์' }), { token: writer });
    expect(d.status).toBe(201);
    expect((await t.api('POST', `/contracts/${d.body.id}/activate`, undefined, { token: writer })).status).toBe(403);
    expect((await t.api('POST', '/visits/generate', { until: T }, { token: techToken() })).status).toBe(403);
    expect((await t.api('GET', '/billing', undefined, { token: techToken() })).status).toBe(403);
    const visitId = (await t.api('GET', '/visits?status=planned')).body[0].id;
    expect((await t.api('POST', `/visits/${visitId}/start`, undefined, { token: t.token(['contracts.visit.read']) })).status).toBe(403);
    expect((await t.api('GET', '/summary', undefined, { token: t.token([]) })).status).toBe(403);
    expect((await t.api('GET', '/summary', undefined, { token: techToken() })).status).toBe(200);
  });

  it('another tenant sees nothing and cannot touch records', async () => {
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/contracts', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', '/visits', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', '/billing?scope=all', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', '/coverage', undefined, { token: other })).body).toHaveLength(0);
    expect((await t.api('GET', `/contracts/${ma.id}`, undefined, { token: other })).status).toBe(404);
    expect((await t.api('POST', `/contracts/${ma.id}/renew`, {}, { token: other })).status).toBe(404);
    expect((await t.api('POST', '/visits/generate', { until: addMonths(T, 12) }, { token: other })).body.created).toBe(0);
    expect((await t.api('GET', '/summary', undefined, { token: other })).body).toMatchObject({ activeContracts: 0, overdueVisits: 0, billingDueCount: 0 });
    // numbering is per tenant
    const mine = await t.api('POST', '/contracts', base(), { token: other });
    expect(mine.body.no).toBe(`MA-${year}-0001`);
  });
});
