import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signToken } from '@erp/kernel';
import { bootTestService, TEST_JWT_SECRET, type TestService } from '@erp/kernel/testing';
import { definition } from '../src/service.ts';

let t: TestService;
beforeAll(async () => { t = await bootTestService(definition); });
afterAll(async () => { await t?.close(); });

const STAFF = ['booking.resource.read', 'booking.book.create'];
const aliceUser = randomUUID();
const bobUser = randomUUID();
const as = (userId: string, perms = STAFF) => ({ token: signToken(TEST_JWT_SECRET, { tenantId: t.tenantId, userId, perms }) });
const ids: Record<string, string> = {};
const book = (resourceId: string, date: string, startTime: string, endTime: string, extra: Record<string, unknown> = {}, opts = as(aliceUser)) =>
  t.api('POST', '/bookings', { resourceId, purpose: 'ประชุม', date, startTime, endTime, requesterName: 'อลิส', ...extra }, opts);

describe('booking: resources', () => {
  it('registers rooms, vehicles and equipment', async () => {
    const mr = await t.api('POST', '/resources', { code: 'MR-1', name: 'ห้องประชุมเล็ก', kind: 'room', capacity: 10, location: 'ชั้น 2', color: '#2563eb' });
    expect(mr.status).toBe(201);
    expect(mr.body).toMatchObject({ kind_th: 'ห้อง', requires_approval: false, active: true });
    ids.mr = mr.body.id;
    ids.board = (await t.api('POST', '/resources', { code: 'BOARD', name: 'ห้องประชุมใหญ่', kind: 'room', capacity: 20, requiresApproval: true })).body.id;
    ids.van = (await t.api('POST', '/resources', { code: 'VAN-01', name: 'รถตู้', kind: 'vehicle', capacity: 12, plateNo: 'นข 1234 กรุงเทพฯ' })).body.id;
    ids.pj = (await t.api('POST', '/resources', { code: 'PJ-01', name: 'โปรเจกเตอร์', kind: 'equipment' })).body.id;

    expect((await t.api('POST', '/resources', { code: 'mr-1', name: 'ซ้ำ', kind: 'room' })).status).toBe(409);
    expect((await t.api('POST', '/resources', { code: 'X', name: 'X', kind: 'boat' })).status).toBe(400);
    expect((await t.api('POST', '/resources', { code: 'X', name: 'X', kind: 'room', color: 'blue' })).status).toBe(400);
    expect((await t.api('GET', '/resources?kind=vehicle')).body.map((r: any) => r.code)).toEqual(['VAN-01']);
    expect((await t.api('GET', '/resources?q=1234')).body).toHaveLength(1);
  });
});

describe('booking: bookings', () => {
  it('books a room from date + times and numbers it BK-…', async () => {
    const r = await book(ids.mr, '2027-03-01', '09:00', '10:00', { attendees: 6, purpose: 'ประชุมลูกค้า', requesterDepartment: 'ขาย' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ status: 'confirmed', resource_name: 'ห้องประชุมเล็ก', booking_date: '2027-03-01', time_range: '09:00–10:00', hours: 1, requester_name: 'อลิส' });
    expect(r.body.no).toMatch(/^BK-\d{4}-0001$/);
    expect(new Date(r.body.start_at).toISOString()).toBe('2027-03-01T02:00:00.000Z');
    ids.first = r.body.id;
  });

  it('refuses overlapping slots with a Thai 409 naming the other booking', async () => {
    const clash = await book(ids.mr, '2027-03-01', '09:30', '11:00', {}, as(bobUser));
    expect(clash.status).toBe(409);
    expect(clash.body.error.message).toContain('ห้องประชุมเล็ก ถูกจองแล้วช่วง 1/3/2570 09:00–10:00 น. (BK-');
    expect(clash.body.error.message).toContain('ประชุมลูกค้า — อลิส');
    expect((await book(ids.mr, '2027-03-01', '10:00', '11:00', {}, as(bobUser))).status).toBe(201); // back-to-back is fine
    expect((await book(ids.board, '2027-03-01', '09:30', '11:00', {}, as(bobUser))).status).toBe(201); // another room
    // ISO instants are accepted too
    expect((await t.api('POST', '/bookings', { resourceId: ids.mr, purpose: 'x', requesterName: 'x', startAt: '2027-03-01T08:30:00+07:00', endAt: '2027-03-01T09:15:00+07:00' })).status).toBe(409);
  });

  it('validates times, capacity and inactive resources', async () => {
    const back = await book(ids.mr, '2027-03-02', '10:00', '09:00');
    expect(back.status).toBe(400);
    expect(back.body.error.message).toBe('เวลาสิ้นสุดต้องหลังเวลาเริ่ม');
    expect((await book(ids.mr, '2027-03-02', '10:00', '10:00')).status).toBe(400);
    expect((await t.api('POST', '/bookings', { resourceId: ids.mr, purpose: 'x', requesterName: 'x', date: '2027-03-02' })).status).toBe(400);
    expect((await book(ids.mr, '2027-03-02', '9:00', '10:00')).status).toBe(400);
    const crowd = await book(ids.mr, '2027-03-02', '13:00', '14:00', { attendees: 12 });
    expect(crowd.status).toBe(400);
    expect(crowd.body.error.message).toBe('ห้องประชุมเล็ก รับได้ 10 คน แต่ระบุผู้เข้าร่วม 12 คน');
    expect((await book(ids.mr, '2027-03-02', '13:00', '14:00', { requesterName: '' })).status).toBe(400);
    expect((await book(randomUUID(), '2027-03-02', '13:00', '14:00')).status).toBe(400);

    await t.api('PATCH', `/resources/${ids.pj}`, { active: false });
    const off = await book(ids.pj, '2027-03-02', '13:00', '14:00');
    expect(off.status).toBe(400);
    expect(off.body.error.message).toContain('ปิดใช้งาน');
    await t.api('PATCH', `/resources/${ids.pj}`, { active: true });
    expect((await t.api('GET', '/resources')).body).toHaveLength(4);
  });

  it('holds approval-required bookings as pending and runs the approval state machine', async () => {
    const r = await book(ids.board, '2027-03-05', '13:00', '16:00', { attendees: 18, purpose: 'อบรมความปลอดภัย' });
    expect(r.body.status).toBe('pending');
    // a pending booking already blocks the slot
    expect((await book(ids.board, '2027-03-05', '15:00', '17:00', {}, as(bobUser))).status).toBe(409);
    expect((await t.api('POST', `/bookings/${r.body.id}/approve`, {}, as(aliceUser))).status).toBe(403);
    const inbox = (await t.api('GET', '/bookings/pending')).body;
    expect(inbox.map((b: any) => b.id)).toContain(r.body.id);
    expect((await t.api('POST', `/bookings/${r.body.id}/approve`, { note: 'ok' })).body).toMatchObject({ status: 'confirmed', decision_note: 'ok' });
    expect((await t.api('POST', `/bookings/${r.body.id}/approve`)).status).toBe(409);
    expect((await t.api('POST', `/bookings/${r.body.id}/reject`, { note: 'x' })).status).toBe(409);

    const other = inbox.find((b: any) => b.id !== r.body.id);
    expect((await t.api('POST', `/bookings/${other.id}/reject`, {})).status).toBe(400);
    const rej = await t.api('POST', `/bookings/${other.id}/reject`, { note: 'ห้องปิดปรับปรุง' });
    expect(rej.body).toMatchObject({ status: 'rejected', decision_note: 'ห้องปิดปรับปรุง' });
    expect((await t.api('POST', `/bookings/${other.id}/cancel`)).status).toBe(409);
  });

  it('lets owners cancel their own booking, which frees the slot', async () => {
    expect((await t.api('POST', `/bookings/${ids.first}/cancel`, { reason: 'x' }, as(bobUser))).status).toBe(403);
    const c = await t.api('POST', `/bookings/${ids.first}/cancel`, { reason: 'ลูกค้าเลื่อน' }, as(aliceUser));
    expect(c.body).toMatchObject({ status: 'cancelled', cancel_reason: 'ลูกค้าเลื่อน' });
    expect((await t.api('POST', `/bookings/${ids.first}/cancel`, {}, as(aliceUser))).status).toBe(409);
    expect((await book(ids.mr, '2027-03-01', '09:00', '10:00', {}, as(bobUser))).status).toBe(201);
    const mine = (await t.api('GET', '/bookings/mine', undefined, as(aliceUser))).body;
    expect(mine.every((b: any) => b.requester_id === aliceUser)).toBe(true);
    expect(mine.length).toBe(2);
  });

  it('logs vehicle trips with mileage, distance and fuel', async () => {
    const trip1 = await book(ids.van, '2026-09-01', '08:00', '12:00', { purpose: 'ส่งของลูกค้า', destination: 'บางนา', attendees: 3 });
    expect(trip1.body).toMatchObject({ status: 'confirmed', complete_mode: 'vehicle' });
    expect((await t.api('POST', `/bookings/${trip1.body.id}/complete`, {}, as(aliceUser))).status).toBe(400);
    expect((await t.api('POST', `/bookings/${trip1.body.id}/complete`, { mileageStart: 10000, mileageEnd: 9000 }, as(aliceUser))).status).toBe(400);
    expect((await t.api('POST', `/bookings/${trip1.body.id}/complete`, { mileageStart: 10000, mileageEnd: 10120 }, as(bobUser))).status).toBe(403);
    const done = await t.api('POST', `/bookings/${trip1.body.id}/complete`, { mileageStart: 10000, mileageEnd: 10120, fuelCost: 850.5, note: 'เติมน้ำมันที่ปั๊ม' }, as(aliceUser));
    expect(done.body).toMatchObject({ status: 'completed', distance_km: 120, fuel_cost: 850.5, complete_mode: null });
    expect((await t.api('POST', `/bookings/${trip1.body.id}/complete`, { mileageEnd: 10200 })).status).toBe(409);
    expect((await t.api('POST', `/bookings/${trip1.body.id}/cancel`)).status).toBe(409);

    // the next trip starts from the last odometer reading
    const trip2 = await book(ids.van, '2026-09-15', '13:00', '17:00', { purpose: 'รับวัตถุดิบ', destination: 'สมุทรปราการ' });
    const done2 = await t.api('POST', `/bookings/${trip2.body.id}/complete`, { mileageEnd: 10200, fuelCost: 500 });
    expect(done2.body).toMatchObject({ mileage_start: 10120, mileage_end: 10200, distance_km: 80 });

    const future = await book(ids.van, '2027-04-01', '08:00', '17:00');
    expect((await t.api('POST', `/bookings/${future.body.id}/complete`, { mileageEnd: 10300 })).status).toBe(409);

    // a past booking cannot be cancelled any more, only completed
    const pastRoom = await book(ids.mr, '2026-09-02', '09:00', '10:00');
    expect(pastRoom.body.complete_mode).toBe('other');
    expect((await t.api('POST', `/bookings/${pastRoom.body.id}/cancel`, {}, as(aliceUser))).status).toBe(409);
    expect((await t.api('POST', `/bookings/${pastRoom.body.id}/complete`, {}, as(aliceUser))).body).toMatchObject({ status: 'completed', distance_km: null });

    const trips = (await t.api('GET', '/trips?month=2026-09')).body;
    expect(trips).toMatchObject({ totalKm: 200, totalFuel: 1350.5 });
    expect(trips.rows).toHaveLength(2);
    expect(trips.vehicles[0]).toMatchObject({ resource_code: 'VAN-01', trips: 2, km: 200, fuel_per_km: 6.75 });
    expect((await t.api('GET', `/resources/${ids.van}`)).body).toMatchObject({ lastMileage: 10200, upcoming: [{ id: future.body.id }] });
  });

  it('shows the daily board and filters bookings by date and resource', async () => {
    const board = (await t.api('GET', '/availability?date=2027-03-01&kind=room')).body;
    const mr = board.find((r: any) => r.code === 'MR-1');
    expect(mr).toMatchObject({ booking_count: 2, booked_hours: 2, slots: '09:00–10:00 ประชุม · 10:00–11:00 ประชุม' });
    expect(board.find((r: any) => r.code === 'BOARD')).toMatchObject({ booking_count: 0, slots: 'ว่างทั้งวัน' }); // the 09:30 one was rejected
    expect(board.every((r: any) => r.kind === 'room')).toBe(true);

    expect((await t.api('GET', `/bookings?from=2027-03-01&to=2027-03-01&resourceId=${ids.mr}`)).body).toHaveLength(3); // incl. the cancelled one
    expect((await t.api('GET', '/bookings?from=2027-03-01&to=2027-03-01&status=confirmed')).body).toHaveLength(2);
    expect((await t.api('GET', '/bookings?q=บางนา')).body).toHaveLength(1);
    expect((await t.api('GET', '/bookings?q=ส่งของ')).body).toHaveLength(1);
  });

  it('summarises bookings for the dashboard', async () => {
    const s = (await t.api('GET', '/summary')).body;
    expect(s).toMatchObject({ pendingApproval: 0, activeResources: 4 });
    expect(typeof s.utilization).toBe('number');
    expect(s.months).toHaveLength(6);
    expect(s.months.find((m: any) => m.month === '2026-09')).toMatchObject({ bookings: 3, hours: 9 });
    expect(s.rows[0].title).toContain(' · ');
  });
});

describe('booking: permissions and tenants', () => {
  it('enforces permissions', async () => {
    const reader = { token: t.token(['booking.resource.read']) };
    expect((await book(ids.mr, '2027-05-01', '09:00', '10:00', {}, reader)).status).toBe(403);
    expect((await t.api('POST', '/resources', { code: 'Y', name: 'Y', kind: 'room' }, as(aliceUser))).status).toBe(403);
    expect((await t.api('GET', '/bookings/pending', undefined, as(aliceUser))).status).toBe(403);
    expect((await t.api('GET', '/bookings', undefined, { token: t.token(['booking.book.create']) })).status).toBe(403);
  });

  it('isolates tenants', async () => {
    const other = { token: t.token(['*'], t.otherTenantId) };
    expect((await t.api('GET', '/resources', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/bookings', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', '/availability?date=2027-03-01', undefined, other)).body).toEqual([]);
    expect((await t.api('GET', `/bookings/${ids.first}`, undefined, other)).status).toBe(404);
    expect((await t.api('POST', '/bookings', { resourceId: ids.mr, purpose: 'x', requesterName: 'x', date: '2027-06-01', startTime: '09:00', endTime: '10:00' }, other)).status).toBe(400);
    expect((await t.api('GET', '/summary', undefined, other)).body).toMatchObject({ activeResources: 0, utilization: 0 });
    expect((await t.api('POST', '/resources', { code: 'MR-1', name: 'ห้องของบริษัทอื่น', kind: 'room' }, other)).status).toBe(201);
  });
});

describe('booking: events (for Automation alerts)', () => {
  it('publishes booking.requested for every new booking, flagging the ones that need approval', async () => {
    const evs = (await t.published('booking.requested')).map((e) => e.data);
    const first = evs.find((d: any) => d.bookingId === ids.first);
    expect(first).toMatchObject({ resourceName: 'ห้องประชุมเล็ก', startAt: '2027-03-01T02:00:00.000Z', endAt: '2027-03-01T03:00:00.000Z', requesterName: 'อลิส', needsApproval: false, purpose: 'ประชุมลูกค้า' });
    expect(first.no).toMatch(/^BK-\d{4}-0001$/);
    expect(first.period).toContain('09:00');
    expect(evs.find((d: any) => d.purpose === 'อบรมความปลอดภัย')).toMatchObject({ resourceName: 'ห้องประชุมใหญ่', needsApproval: true });
    // a clash publishes nothing
    const before = evs.length;
    expect((await book(ids.mr, '2027-03-01', '09:30', '10:30', {})).status).toBe(409);
    expect((await t.published('booking.requested')).length).toBe(before);
  });
});

describe('booking — QA regressions (docs/uat/bugs-0.3.md)', () => {
  it('BK-01: the odometer cannot go backwards, and a late-logged trip must fit between its neighbours', async () => {
    const truck = (await t.api('POST', '/resources', { code: 'TRUCK-QA', name: 'รถกระบะ QA', kind: 'vehicle', capacity: 2 })).body.id;
    const t1 = (await book(truck, '2026-08-03', '08:00', '12:00')).body;
    expect((await t.api('POST', `/bookings/${t1.id}/complete`, { mileageStart: 153000, mileageEnd: 153226 }, as(aliceUser))).body.distance_km).toBe(226);
    const t3 = (await book(truck, '2026-08-20', '08:00', '12:00')).body;
    // typo: start reading far below the last one
    const back = await t.api('POST', `/bookings/${t3.id}/complete`, { mileageStart: 10, mileageEnd: 20 }, as(aliceUser));
    expect(back.status).toBe(400);
    expect(back.body.error.message).toContain('153226');
    expect((await t.api('POST', `/bookings/${t3.id}/complete`, { mileageEnd: 153400 }, as(aliceUser))).body).toMatchObject({ mileage_start: 153226, distance_km: 174 });
    // a trip in between, logged afterwards, starts from the reading before it and may not end past the next one
    const t2 = (await book(truck, '2026-08-10', '08:00', '09:00')).body;
    expect((await t.api('POST', `/bookings/${t2.id}/complete`, { mileageEnd: 153500 }, as(aliceUser))).status).toBe(400);
    expect((await t.api('POST', `/bookings/${t2.id}/complete`, { mileageEnd: 153226 }, as(aliceUser))).body).toMatchObject({ mileage_start: 153226, distance_km: 0 });
    // last reading = the latest trip by date, not the last one keyed in
    expect((await t.api('GET', `/resources/${truck}`)).body.lastMileage).toBe(153400);
  });
});
