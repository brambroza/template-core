import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootTestService, type TestService } from '@erp/kernel/testing';
import { addBusinessSeconds, DEFAULT_CALENDAR } from '../src/business-hours.ts';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const H = 3600;
const at = (iso: string) => new Date(iso).toISOString();
const tech = { userId: randomUUID(), userName: 'ช่างสมชาย' };
const techToken = () => t.token(['helpdesk.ticket.create', 'helpdesk.ticket.read', 'helpdesk.ticket.work'], t.tenantId, tech);

describe('business-hours arithmetic (Mon–Fri 08:00–17:00 Asia/Bangkok)', () => {
  const add = (iso: string, hours: number, holidays: string[] = []) => addBusinessSeconds(new Date(iso), hours * H, { ...DEFAULT_CALENDAR, holidays }).toISOString();

  it('a ticket opened 23:04 Friday with 4 business hours is due Monday 12:00', () => {
    expect(add('2026-10-02T23:04:00+07:00', 4)).toBe(at('2026-10-05T12:00:00+07:00'));
  });
  it('carries the remainder into the next working day and skips weekends and holidays', () => {
    expect(add('2026-10-05T16:00:00+07:00', 2)).toBe(at('2026-10-06T09:00:00+07:00'));
    expect(add('2026-10-02T15:30:00+07:00', 4)).toBe(at('2026-10-05T10:30:00+07:00'));
    expect(add('2026-10-03T10:00:00+07:00', 9)).toBe(at('2026-10-05T17:00:00+07:00')); // Saturday → a full Monday
    expect(add('2026-10-02T23:04:00+07:00', 4, ['2026-10-05'])).toBe(at('2026-10-06T12:00:00+07:00')); // Monday is a holiday
    expect(add('2026-10-05T07:00:00+07:00', 0.5)).toBe(at('2026-10-05T08:30:00+07:00')); // before opening
  });
  it('honours other calendars and time zones', () => {
    const sixDays = { ...DEFAULT_CALENDAR, workDays: [1, 2, 3, 4, 5, 6], workStart: '09:00', workEnd: '18:00' };
    expect(addBusinessSeconds(new Date('2026-10-02T23:04:00+07:00'), 4 * H, sixDays).toISOString()).toBe(at('2026-10-03T13:00:00+07:00'));
    const tokyo = { ...DEFAULT_CALENDAR, timezone: 'Asia/Tokyo' };
    expect(addBusinessSeconds(new Date('2026-10-05T07:00:00+09:00'), 2 * H, tokyo).toISOString()).toBe(at('2026-10-05T10:00:00+09:00'));
  });
});

describe('helpdesk business-hours SLA', () => {
  let cat: any;
  beforeAll(async () => {
    cat = (await t.api('POST', '/categories', { code: 'MA', name: 'บริการหลังการขาย', slaResponseHours: 4, slaResolveHours: 8 })).body;
  });

  it('defaults to Mon–Fri 08:00–17:00 Asia/Bangkok with urgent 24×7', async () => {
    expect((await t.api('GET', '/settings/sla')).body).toMatchObject({
      businessHours: true, urgent24x7: true, timezone: 'Asia/Bangkok', workDays: [1, 2, 3, 4, 5], workStart: '08:00', workEnd: '17:00', upcomingHolidays: [],
    });
  });

  it('a call at 23:04 Friday must be answered by 12:00 Monday (4 business hours), resolved by 16:00 Monday', async () => {
    const r = await t.api('POST', '/tickets', { title: 'กล้องดับ 3 ตัว', categoryId: cat.id, channel: 'line', reportedAt: '2026-10-02T23:04:00+07:00' }, { token: techToken() });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({
      reported_at: at('2026-10-02T23:04:00+07:00'), response_due_at: at('2026-10-05T12:00:00+07:00'), due_at: at('2026-10-05T16:00:00+07:00'),
      sla_mode: 'business', sla_mode_label: 'เวลาทำการ',
    });
  });

  it('urgent tickets count clock hours (halved) unless urgent24x7 is off', async () => {
    const urgent = (await t.api('POST', '/tickets', { title: 'เซิร์ฟเวอร์ล่ม', categoryId: cat.id, priority: 'urgent', reportedAt: '2026-10-02T23:04:00+07:00' }, { token: techToken() })).body;
    expect(urgent).toMatchObject({ sla_mode: 'clock', response_due_at: at('2026-10-03T01:04:00+07:00'), due_at: at('2026-10-03T03:04:00+07:00') });
    expect((await t.api('PUT', '/settings/sla', { urgent24x7: false })).body).toMatchObject({ urgent24x7: false, businessHours: true });
    const later = (await t.api('POST', '/tickets', { title: 'เซิร์ฟเวอร์ล่มอีก', categoryId: cat.id, priority: 'urgent', reportedAt: '2026-10-02T23:04:00+07:00' }, { token: techToken() })).body;
    expect(later).toMatchObject({ sla_mode: 'business', response_due_at: at('2026-10-05T10:00:00+07:00') });
    await t.api('PUT', '/settings/sla', {});
  });

  it('holidays and a custom calendar move the deadline; editing recomputes from the reported time', async () => {
    const hol = await t.api('POST', '/holidays', { date: '2026-10-05', name: 'วันหยุดชดเชย' });
    expect(hol.status).toBe(201);
    expect((await t.api('POST', '/holidays', { date: '2026-10-05', name: 'ซ้ำ' })).status).toBe(409);
    const tk = (await t.api('POST', '/tickets', { title: 'สวิตช์ดับ', categoryId: cat.id, reportedAt: '2026-10-02T23:04:00+07:00' }, { token: techToken() })).body;
    expect(tk.response_due_at).toBe(at('2026-10-06T12:00:00+07:00'));
    expect((await t.api('GET', '/holidays?year=2026')).body).toMatchObject([{ date: '2026-10-05', name: 'วันหยุดชดเชย' }]);
    expect((await t.api('GET', '/holidays?year=2569')).body).toHaveLength(1);
    expect((await t.api('GET', '/holidays?year=2025')).body).toHaveLength(0);

    const set = await t.api('PUT', '/settings/sla', { workDays: '1,2,3,4,5,6', workStart: '09:00', workEnd: '18:00' }); // form sends text
    expect(set.body).toMatchObject({ workDays: [1, 2, 3, 4, 5, 6], workStart: '09:00', workEnd: '18:00' });
    const edited = (await t.api('PUT', `/tickets/${tk.id}`, { title: 'สวิตช์ดับ', categoryId: cat.id })).body;
    expect(edited.response_due_at).toBe(at('2026-10-03T13:00:00+07:00')); // Saturday is now a working day
    expect((await t.api('DELETE', `/holidays/${hol.body.id}`)).status).toBe(200);
    await t.api('PUT', '/settings/sla', {});
  });

  it('24-hour mode for everything when business hours are off', async () => {
    await t.api('PUT', '/settings/sla', { businessHours: false });
    const tk = (await t.api('POST', '/tickets', { title: 'x', categoryId: cat.id, reportedAt: '2026-10-02T23:04:00+07:00' }, { token: techToken() })).body;
    expect(tk).toMatchObject({ sla_mode: 'clock', response_due_at: at('2026-10-03T03:04:00+07:00') });
    await t.api('PUT', '/settings/sla', {});
  });

  it('validates settings, reported time and permissions', async () => {
    expect((await t.api('PUT', '/settings/sla', { workStart: '17:00', workEnd: '08:00' })).status).toBe(400);
    expect((await t.api('PUT', '/settings/sla', { workDays: [0] })).status).toBe(400);
    expect((await t.api('PUT', '/settings/sla', { timezone: 'Mars/Olympus' })).status).toBe(400);
    expect((await t.api('POST', '/tickets', { title: 'อนาคต', reportedAt: new Date(Date.now() + 3600_000).toISOString() }, { token: techToken() })).status).toBe(400);
    // a requester cannot back-date their ticket: the SLA starts when they report it
    const req = t.token(['helpdesk.ticket.create'], t.tenantId, { userName: 'คุณผู้แจ้ง' });
    const mine = (await t.api('POST', '/tickets', { title: 'จอดับ', reportedAt: '2026-01-01T00:00:00+07:00' }, { token: req })).body;
    expect(Date.parse(mine.reported_at)).toBeGreaterThan(Date.now() - 60_000);
    expect(mine.requester_name).toBe('คุณผู้แจ้ง'); // filled from the login
    expect((await t.api('PUT', '/settings/sla', {}, { token: techToken() })).status).toBe(403);
    expect((await t.api('POST', '/holidays', { date: '2026-12-31', name: 'สิ้นปี' }, { token: techToken() })).status).toBe(403);
    expect((await t.api('GET', '/settings/sla', undefined, { token: techToken() })).status).toBe(200);
    expect((await t.api('GET', '/settings/sla', undefined, { token: req })).status).toBe(403);
  });

  it('keeps calendars and holidays per tenant', async () => {
    await t.api('PUT', '/settings/sla', { workDays: [1, 2, 3, 4, 5, 6, 7] });
    await t.api('POST', '/holidays', { date: '2026-12-31', name: 'สิ้นปี' });
    const other = t.token(['*'], t.otherTenantId);
    expect((await t.api('GET', '/settings/sla', undefined, { token: other })).body).toMatchObject({ workDays: [1, 2, 3, 4, 5] });
    expect((await t.api('GET', '/holidays', undefined, { token: other })).body).toEqual([]);
    const h = (await t.api('GET', '/holidays')).body.find((x: any) => x.date === '2026-12-31');
    expect((await t.api('DELETE', `/holidays/${h.id}`, undefined, { token: other })).status).toBe(404);
    await t.api('PUT', '/settings/sla', {});
  });
});

describe('helpdesk tickets ← customer, asset, author names', () => {
  const customer = { customerId: randomUUID(), customerCode: 'CUS-CBP', customerName: 'บริษัท ชลบุรีพลาสติก จำกัด' };

  it('links a ticket to a customer snapshot and an asset/serial; filters by both', async () => {
    const tk = (await t.api('POST', '/tickets', { title: 'กล้องจุดโหลดสินค้าดับ', ...customer, assetRef: 'CCTV-IP4MP SN 4M2309-0017' }, { token: techToken() })).body;
    expect(tk).toMatchObject({ customer_id: customer.customerId, customer_code: 'CUS-CBP', customer_name: customer.customerName, asset_ref: 'CCTV-IP4MP SN 4M2309-0017' });
    expect((await t.api('GET', `/tickets?customerId=${customer.customerId}`)).body.map((x: any) => x.id)).toEqual([tk.id]);
    expect((await t.api('GET', '/tickets?q=4M2309')).body.map((x: any) => x.id)).toEqual([tk.id]);
    expect((await t.api('GET', '/tickets?q=ชลบุรีพลาสติก')).body.map((x: any) => x.id)).toEqual([tk.id]);
    const edited = (await t.api('PUT', `/tickets/${tk.id}`, { title: tk.title, ...customer, assetRef: 'NVR-32CH' })).body;
    expect(edited.asset_ref).toBe('NVR-32CH');
    expect((await t.api('POST', '/tickets', { title: 'x', customerId: 'not-a-uuid' })).status).toBe(400);
  });

  it('fills comment authors and the assignee from the signed-in user', async () => {
    const tk = (await t.api('POST', '/tickets', { title: 'เน็ตช้า' }, { token: techToken() })).body;
    expect((await t.api('POST', `/tickets/${tk.id}/start`, undefined, { token: techToken() })).body).toMatchObject({ assignee_id: tech.userId, assignee_name: tech.userName });
    await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'กำลังตรวจสอบ' }, { token: techToken() });
    await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'โน้ตภายใน', internal: true }, { token: techToken() });
    const legacy = t.token(['helpdesk.ticket.work', 'helpdesk.ticket.read']); // old token without a name
    await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'จากโทเคนเก่า', authorName: 'ชื่อที่พิมพ์' }, { token: legacy });
    const got = (await t.api('GET', `/tickets/${tk.id}`)).body;
    expect(got.comments.map((c: any) => [c.body, c.author_name])).toEqual([
      ['กำลังตรวจสอบ', tech.userName], ['โน้ตภายใน', tech.userName], ['จากโทเคนเก่า', 'ชื่อที่พิมพ์'],
    ]);
    // a name in the body cannot impersonate a signed-in user
    await t.api('POST', `/tickets/${tk.id}/comments`, { body: 'ปลอม', authorName: 'ผู้จัดการ' }, { token: techToken() });
    expect((await t.api('GET', `/tickets/${tk.id}`)).body.comments.at(-1).author_name).toBe(tech.userName);
  });
});
