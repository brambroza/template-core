import { auth, badRequest, conflict, forbidden, hasPerm, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type AuthContext, type Client, type ServiceDefinition } from '@erp/kernel';
import { round } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { TZ, addDays, at, dayStart, localDate, thaiRange, weekStart } from './time.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const optText = (max = 200) => z.string().trim().max(max).optional();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const IdParam = z.object({ id: s.uuid });
const Kind = z.enum(['room', 'vehicle', 'equipment']);
const Status = z.enum(['pending', 'confirmed', 'cancelled', 'rejected', 'completed']);

const ResourceInput = z.object({
  code: s.code,
  name: s.name,
  kind: Kind,
  capacity: z.number().int().positive().max(10000).nullable().optional(),
  location: optText(),
  plateNo: optText(30),
  requiresApproval: z.boolean().default(false),
  active: z.boolean().optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, 'expected #RRGGBB').optional(),
  note: optText(1000),
});
const RESOURCE_COLS: Record<string, string> = {
  code: 'code', name: 'name', kind: 'kind', capacity: 'capacity', location: 'location', plateNo: 'plate_no',
  requiresApproval: 'requires_approval', active: 'active', color: 'color', note: 'note',
};

/** Either ISO instants (`startAt`/`endAt`) or what the form sends: local `date` + `startTime`/`endTime` (+ `endDate` for multi-day trips). */
const BookingInput = z.object({
  resourceId: s.uuid,
  purpose: s.name,
  startAt: z.string().datetime({ offset: true }).optional(),
  endAt: z.string().datetime({ offset: true }).optional(),
  date: s.isoDate.optional(),
  startTime: time.optional(),
  endTime: time.optional(),
  endDate: s.isoDate.optional(),
  attendees: z.number().int().positive().max(10000).optional(),
  destination: optText(300),
  requesterName: s.name,
  requesterDepartment: optText(),
  requesterPhone: optText(30),
});
const NoteInput = z.object({ note: optText(1000) });
const RejectInput = z.object({ note: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ').max(1000) });
const CompleteInput = z.object({
  mileageStart: z.number().min(0).max(9_999_999).optional(),
  mileageEnd: z.number().min(0).max(9_999_999).optional(),
  fuelCost: s.money.max(10_000_000).optional(),
  note: optText(1000),
});

const STATUS_TH: Record<string, string> = { pending: 'รออนุมัติ', confirmed: 'ยืนยันแล้ว', cancelled: 'ยกเลิกแล้ว', rejected: 'ไม่อนุมัติ', completed: 'ใช้งานเสร็จแล้ว' };
const ACTIVE = `('pending', 'confirmed')`;
const HOURS_PER_WEEK = 45;

/* ---------------- queries ---------------- */

const KIND_TH = (col: string) => `case ${col} when 'room' then 'ห้อง' when 'vehicle' then 'รถ' else 'อุปกรณ์' end`;
const BK_SELECT = `select b.*, r.code as resource_code, r.name as resource_name, r.kind as resource_kind, ${KIND_TH('r.kind')} as resource_kind_th,
    r.plate_no, r.location, r.color, r.capacity, r.requires_approval,
    to_char(b.start_at at time zone '${TZ}', 'YYYY-MM-DD') as booking_date,
    to_char(b.start_at at time zone '${TZ}', 'HH24:MI') || '–' || to_char(b.end_at at time zone '${TZ}', 'HH24:MI') as time_range,
    round(extract(epoch from b.end_at - b.start_at) / 3600.0, 2)::float8 as hours,
    case when b.status = 'confirmed' then case when r.kind = 'vehicle' then 'vehicle' else 'other' end end as complete_mode
  from bookings b join resources r on r.id = b.resource_id`;
const RES_SELECT = `select r.*, ${KIND_TH('r.kind')} as kind_th from resources r`;

const like = (q?: string) => (q ? `%${q.trim()}%` : null);

async function loadBooking(c: Client, id: string, lock = false) {
  if (lock) await c.query('select 1 from bookings where id = $1 for update', [id]);
  return one(c, `${BK_SELECT} where b.id = $1`, [id], 'Booking');
}

function assertStatus(bk: any, allowed: string[], verb: string) {
  if (!allowed.includes(bk.status)) throw conflict(`${verb}การจอง ${bk.no} ไม่ได้ เพราะสถานะเป็น "${STATUS_TH[bk.status] ?? bk.status}"`);
}

/** Own booking with `booking.book.create`, or anyone's with `booking.book.approve`. */
function assertOwnerOrApprover(a: AuthContext, bk: any) {
  if (hasPerm(a, 'booking.book.approve')) return;
  requirePerm(a, 'booking.book.create');
  if (bk.requester_id !== a.userId) throw forbidden('จัดการได้เฉพาะการจองของตนเอง');
}

function resolveTimes(b: z.infer<typeof BookingInput>): { start: Date; end: Date } {
  let start: Date;
  let end: Date;
  if (b.startAt && b.endAt) {
    start = new Date(b.startAt);
    end = new Date(b.endAt);
  } else if (b.date && b.startTime && b.endTime) {
    start = at(b.date, b.startTime);
    end = at(b.endDate ?? b.date, b.endTime);
  } else {
    throw badRequest('ระบุวันที่ เวลาเริ่ม และเวลาสิ้นสุด', { fieldErrors: { date: ['กรอกวันที่'], startTime: ['กรอกเวลาเริ่ม'], endTime: ['กรอกเวลาสิ้นสุด'] } });
  }
  if (end <= start) throw badRequest('เวลาสิ้นสุดต้องหลังเวลาเริ่ม', { fieldErrors: { endTime: ['เวลาสิ้นสุดต้องหลังเวลาเริ่ม'] } });
  if (end.getTime() - start.getTime() > 31 * 24 * 3600 * 1000) throw badRequest('จองต่อเนื่องได้ไม่เกิน 31 วันต่อครั้ง');
  return { start, end };
}

/** The first active booking of a resource that overlaps [start, end), if any. */
async function clash(c: Client, resourceId: string, start: Date, end: Date, exceptId?: string) {
  return (await c.query(
    `select no, purpose, requester_name, start_at, end_at from bookings
     where resource_id = $1 and status in ${ACTIVE} and start_at < $3 and end_at > $2 and ($4::uuid is null or id <> $4)
     order by start_at limit 1`, [resourceId, start, end, exceptId ?? null])).rows[0] ?? null;
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ---------------- resources ---------------- */

    app.get('/resources', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.read');
      const q = parse(s.listQuery.extend({
        limit: z.coerce.number().int().min(1).max(500).default(200),
        kind: Kind.optional(),
        all: z.enum(['true', 'false']).optional(),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${RES_SELECT} where ($1::text is null or r.code ilike $1 or r.name ilike $1 or r.plate_no ilike $1 or r.location ilike $1)
           and ($2::text is null or r.kind = $2) and ($3 or r.active) order by r.kind, r.code limit $4 offset $5`,
        [like(q.q), q.kind ?? null, q.all === 'true', q.limit, q.offset])).rows);
    });

    app.post('/resources', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.write');
      const b = parse(ResourceInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        if ((await c.query('select 1 from resources where lower(code) = lower($1)', [b.code])).rowCount) throw conflict(`รหัส ${b.code} มีอยู่แล้ว`);
        const row = (await c.query(
          `insert into resources (code, name, kind, capacity, location, plate_no, requires_approval, active, color, note)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [b.code, b.name, b.kind, b.capacity ?? null, b.location ?? null, b.plateNo ?? null, b.requiresApproval, b.active ?? true, b.color ?? null, b.note ?? null])).rows[0];
        return one(c, `${RES_SELECT} where r.id = $1`, [row.id], 'Resource');
      });
    });

    /** Resource card: upcoming bookings; for vehicles also this month's trips, km and fuel and the last odometer reading. */
    app.get('/resources/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await one(c, `${RES_SELECT} where r.id = $1`, [id], 'Resource');
        r.upcoming = (await c.query(`${BK_SELECT} where b.resource_id = $1 and b.status in ${ACTIVE} and b.end_at >= now() order by b.start_at limit 30`, [id])).rows;
        r.recent = (await c.query(`${BK_SELECT} where b.resource_id = $1 and b.status = 'completed' order by b.completed_at desc limit 10`, [id])).rows;
        const m = (await c.query(
          `select count(*)::int as trips, coalesce(sum(distance_km), 0) as km, coalesce(sum(fuel_cost), 0) as fuel
           from bookings where resource_id = $1 and status = 'completed'
             and date_trunc('month', start_at at time zone '${TZ}') = date_trunc('month', now() at time zone '${TZ}')`, [id])).rows[0];
        r.tripsMonth = m.trips;
        r.kmMonth = m.km;
        r.fuelMonth = m.fuel;
        r.lastMileage = (await c.query(`select mileage_end from bookings where resource_id = $1 and mileage_end is not null order by completed_at desc limit 1`, [id])).rows[0]?.mileage_end ?? null;
        return r;
      });
    });

    app.patch('/resources/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ResourceInput.partial(), req.body) as Record<string, unknown>;
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from resources where id = $1 for update', [id], 'Resource');
        if (b.code && (await c.query('select 1 from resources where lower(code) = lower($1) and id <> $2', [b.code, id])).rowCount) throw conflict(`รหัส ${b.code} มีอยู่แล้ว`);
        const sets: string[] = [];
        const vals: unknown[] = [id];
        for (const [key, col] of Object.entries(RESOURCE_COLS)) {
          if (b[key] === undefined) continue;
          vals.push(b[key]);
          sets.push(`${col} = $${vals.length}`);
        }
        if (sets.length) await c.query(`update resources set ${sets.join(', ')} where id = $1`, vals);
        return one(c, `${RES_SELECT} where r.id = $1`, [id], 'Resource');
      });
    });

    /** Daily board: every active resource with that day's bookings (pending, confirmed, completed). */
    app.get('/availability', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.read');
      const q = parse(z.object({ date: s.isoDate.optional(), kind: Kind.optional(), q: z.string().optional() }), req.query);
      const date = q.date ?? localDate();
      const from = dayStart(date);
      const to = dayStart(addDays(date, 1));
      return k.db.tx(a.tenantId, async (c) => {
        const resources = (await c.query(
          `${RES_SELECT} where r.active and ($1::text is null or r.kind = $1) and ($2::text is null or r.code ilike $2 or r.name ilike $2 or r.plate_no ilike $2)
           order by r.kind, r.code`, [q.kind ?? null, like(q.q)])).rows;
        const bookings = (await c.query(
          `${BK_SELECT} where b.status in ('pending', 'confirmed', 'completed') and b.start_at < $2 and b.end_at > $1 order by b.start_at`, [from, to])).rows;
        const now = Date.now();
        return resources.map((r: any) => {
          const mine = bookings.filter((b: any) => b.resource_id === r.id);
          const minutes = mine.reduce((sum: number, b: any) => {
            const s0 = Math.max(new Date(b.start_at).getTime(), from.getTime());
            const e0 = Math.min(new Date(b.end_at).getTime(), to.getTime());
            return sum + Math.max(0, e0 - s0) / 60000;
          }, 0);
          const current = mine.find((b: any) => b.status !== 'completed' && new Date(b.start_at).getTime() <= now && new Date(b.end_at).getTime() > now);
          return {
            ...r, date,
            bookings: mine.map((b: any) => ({ id: b.id, no: b.no, status: b.status, purpose: b.purpose, requester_name: b.requester_name, start_at: b.start_at, end_at: b.end_at, time_range: b.time_range })),
            booking_count: mine.length,
            booked_hours: round(minutes / 60, 2),
            slots: mine.map((b: any) => `${b.time_range} ${b.purpose}${b.status === 'pending' ? ' (รออนุมัติ)' : ''}`).join(' · ') || 'ว่างทั้งวัน',
            busy_now: !!current,
            now_booking: current ? `${current.no} ${current.purpose}` : null,
          };
        });
      });
    });

    /* ---------------- bookings ---------------- */

    app.get('/bookings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.read');
      const q = parse(s.listQuery.extend({
        limit: z.coerce.number().int().min(1).max(500).default(200),
        from: s.isoDate.optional(),
        to: s.isoDate.optional(),
        resourceId: s.uuid.optional(),
        kind: Kind.optional(),
        status: Status.optional(),
        mine: z.enum(['true', 'false']).optional(),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${BK_SELECT}
         where ($1::text is null or b.no ilike $1 or b.purpose ilike $1 or b.requester_name ilike $1 or b.destination ilike $1 or r.name ilike $1 or r.code ilike $1 or r.plate_no ilike $1)
           and ($2::timestamptz is null or b.end_at > $2) and ($3::timestamptz is null or b.start_at < $3)
           and ($4::uuid is null or b.resource_id = $4) and ($5::text is null or r.kind = $5) and ($6::text is null or b.status = $6)
           and (not $7 or b.requester_id = $8)
         order by b.start_at desc limit $9 offset $10`,
        [like(q.q), q.from ? dayStart(q.from) : null, q.to ? dayStart(addDays(q.to, 1)) : null, q.resourceId ?? null, q.kind ?? null,
          q.status ?? null, q.mine === 'true', a.userId, q.limit, q.offset])).rows);
    });

    /** The signed-in user's bookings: upcoming first, then the past. */
    app.get('/bookings/mine', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.book.create');
      const q = parse(z.object({ status: Status.optional(), q: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${BK_SELECT} where b.requester_id = $1 and ($2::text is null or b.status = $2) and ($3::text is null or b.no ilike $3 or b.purpose ilike $3 or r.name ilike $3)
         order by (b.end_at >= now()) desc, case when b.end_at >= now() then b.start_at end asc, b.start_at desc limit 200`,
        [a.userId, q.status ?? null, like(q.q)])).rows);
    });

    /** Approver inbox (mobile): bookings waiting for approval, soonest first. */
    app.get('/bookings/pending', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.book.approve');
      const q = parse(z.object({ kind: Kind.optional(), q: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${BK_SELECT} where b.status = 'pending' and ($1::text is null or r.kind = $1) and ($2::text is null or b.no ilike $2 or b.purpose ilike $2 or b.requester_name ilike $2 or r.name ilike $2)
         order by b.start_at limit 200`, [q.kind ?? null, like(q.q)])).rows);
    });

    app.get('/bookings/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadBooking(c, id));
    });

    app.post('/bookings', async (req, reply) => {
      const a = auth(req);
      if (!hasPerm(a, 'booking.book.approve')) requirePerm(a, 'booking.book.create');
      const b = parse(BookingInput, req.body);
      const { start, end } = resolveTimes(b);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        // lock the resource so two people cannot grab the same slot at once
        const r = (await c.query('select * from resources where id = $1 for update', [b.resourceId])).rows[0];
        if (!r) throw badRequest('ไม่พบห้อง/รถ/อุปกรณ์ที่เลือก');
        if (!r.active) throw badRequest(`${r.name} ปิดใช้งานอยู่ จองไม่ได้`);
        if (b.attendees && r.capacity && b.attendees > r.capacity) {
          throw badRequest(`${r.name} รับได้ ${r.capacity} คน แต่ระบุผู้เข้าร่วม ${b.attendees} คน`, { fieldErrors: { attendees: [`ไม่เกิน ${r.capacity} คน`] } });
        }
        const other = await clash(c, r.id, start, end);
        if (other) {
          throw conflict(`${r.name} ถูกจองแล้วช่วง ${thaiRange(new Date(other.start_at), new Date(other.end_at))} (${other.no}: ${other.purpose} — ${other.requester_name})`);
        }
        const no = await nextDocNo(c, 'BK');
        const row = (await c.query(
          `insert into bookings (no, resource_id, purpose, start_at, end_at, attendees, destination, requester_id, requester_name, requester_department, requester_phone, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [no, r.id, b.purpose, start, end, b.attendees ?? null, b.destination ?? null, a.userId, b.requesterName, b.requesterDepartment ?? null,
            b.requesterPhone ?? null, r.requires_approval ? 'pending' : 'confirmed'])).rows[0];
        await k.emit(c, 'booking.requested', {
          bookingId: row.id, no, resourceName: r.name, startAt: new Date(start).toISOString(), endAt: new Date(end).toISOString(), requesterName: b.requesterName,
          needsApproval: r.requires_approval, period: thaiRange(new Date(start), new Date(end)), purpose: b.purpose,
        });
        return loadBooking(c, row.id);
      });
    });

    app.post('/bookings/:id/approve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.book.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const bk = await loadBooking(c, id, true);
        assertStatus(bk, ['pending'], 'อนุมัติ');
        await c.query(`update bookings set status = 'confirmed', approved_by = $2, approved_at = now(), decision_note = $3 where id = $1`, [id, a.userId, b.note ?? null]);
        return loadBooking(c, id);
      });
    });

    app.post('/bookings/:id/reject', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.book.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(RejectInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const bk = await loadBooking(c, id, true);
        assertStatus(bk, ['pending'], 'ไม่อนุมัติ');
        await c.query(`update bookings set status = 'rejected', approved_by = $2, approved_at = now(), decision_note = $3 where id = $1`, [id, a.userId, b.note]);
        return loadBooking(c, id);
      });
    });

    app.post('/bookings/:id/cancel', async (req) => {
      const a = auth(req);
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ reason: optText(1000) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const bk = await loadBooking(c, id, true);
        assertOwnerOrApprover(a, bk);
        assertStatus(bk, ['pending', 'confirmed'], 'ยกเลิก');
        if (new Date(bk.end_at).getTime() < Date.now()) throw conflict(`การจอง ${bk.no} ผ่านไปแล้ว — ใช้ "ปิดงาน" แทนการยกเลิก`);
        await c.query(`update bookings set status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3 where id = $1`, [id, a.userId, b.reason ?? null]);
        return loadBooking(c, id);
      });
    });

    /** Finish a booking. Vehicles record the odometer (start defaults to the last trip's end reading) and fuel. */
    app.post('/bookings/:id/complete', async (req) => {
      const a = auth(req);
      const { id } = parse(IdParam, req.params);
      const b = parse(CompleteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const bk = await loadBooking(c, id, true);
        assertOwnerOrApprover(a, bk);
        assertStatus(bk, ['confirmed'], 'ปิดงาน');
        if (new Date(bk.start_at).getTime() > Date.now()) throw conflict(`การจอง ${bk.no} ยังไม่ถึงเวลาเริ่มใช้งาน`);
        let mileageStart: number | null = null;
        let mileageEnd: number | null = null;
        let distance: number | null = null;
        if (bk.resource_kind === 'vehicle') {
          mileageStart = b.mileageStart ?? (await c.query(
            `select mileage_end from bookings where resource_id = $1 and mileage_end is not null order by completed_at desc limit 1`, [bk.resource_id])).rows[0]?.mileage_end ?? null;
          if (mileageStart === null || b.mileageEnd === undefined) {
            throw badRequest('กรอกเลขไมล์ก่อนและหลังใช้รถ', { fieldErrors: { ...(mileageStart === null ? { mileageStart: ['กรอกเลขไมล์ก่อนใช้รถ'] } : {}), ...(b.mileageEnd === undefined ? { mileageEnd: ['กรอกเลขไมล์หลังใช้รถ'] } : {}) } });
          }
          mileageEnd = b.mileageEnd;
          if (mileageEnd < mileageStart) throw badRequest(`เลขไมล์หลังใช้รถ (${mileageEnd}) ต้องไม่น้อยกว่าก่อนใช้ (${mileageStart})`);
          distance = round(mileageEnd - mileageStart, 1);
        }
        await c.query(
          `update bookings set status = 'completed', completed_at = now(), mileage_start = $2, mileage_end = $3, distance_km = $4, fuel_cost = $5, completion_note = $6 where id = $1`,
          [id, mileageStart, mileageEnd, distance, b.fuelCost === undefined ? null : round(b.fuelCost, 2), b.note ?? null]);
        return loadBooking(c, id);
      });
    });

    /** Vehicle trip log for a month: each completed trip with distance and fuel, plus totals per vehicle. */
    app.get('/trips', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.read');
      const q = parse(z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(), resourceId: s.uuid.optional(), q: z.string().optional() }), req.query);
      const month = q.month ?? localDate().slice(0, 7);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `${BK_SELECT} where b.status = 'completed' and r.kind = 'vehicle' and to_char(b.start_at at time zone '${TZ}', 'YYYY-MM') = $1
             and ($2::uuid is null or b.resource_id = $2) and ($3::text is null or b.no ilike $3 or b.requester_name ilike $3 or b.destination ilike $3 or r.name ilike $3)
           order by b.start_at`, [month, q.resourceId ?? null, like(q.q)])).rows;
        const byVehicle = new Map<string, { resource_code: string; resource_name: string; plate_no: string | null; trips: number; km: number; fuel: number }>();
        for (const t of rows) {
          const v = byVehicle.get(t.resource_id) ?? { resource_code: t.resource_code, resource_name: t.resource_name, plate_no: t.plate_no, trips: 0, km: 0, fuel: 0 };
          v.trips += 1;
          v.km = round(v.km + (t.distance_km ?? 0), 1);
          v.fuel = round(v.fuel + (t.fuel_cost ?? 0), 2);
          byVehicle.set(t.resource_id, v);
        }
        const vehicles = [...byVehicle.values()].map((v) => ({ ...v, fuel_per_km: v.km ? round(v.fuel / v.km, 2) : null }));
        return {
          month, rows, vehicles,
          totalKm: round(rows.reduce((sum: number, t: any) => sum + (t.distance_km ?? 0), 0), 1),
          totalFuel: round(rows.reduce((sum: number, t: any) => sum + (t.fuel_cost ?? 0), 0), 2),
        };
      });
    });

    /* ---------------- dashboard ---------------- */

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'booking.resource.read');
      const today = localDate();
      const dFrom = dayStart(today);
      const dTo = dayStart(addDays(today, 1));
      const wFrom = dayStart(weekStart(today));
      const wTo = dayStart(addDays(weekStart(today), 7));
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select (select count(*) from bookings where status in ('pending', 'confirmed', 'completed') and start_at < $2 and end_at > $1)::int as today,
                  (select count(*) from bookings where status = 'pending')::int as pending,
                  (select count(*) from resources where active)::int as resources,
                  (select coalesce(sum(extract(epoch from least(end_at, $4) - greatest(start_at, $3))) / 3600.0, 0)::float8
                     from bookings where status in ('confirmed', 'completed') and start_at < $4 and end_at > $3) as week_hours,
                  (select coalesce(sum(distance_km), 0) from bookings
                     where status = 'completed' and date_trunc('month', start_at at time zone '${TZ}') = date_trunc('month', now() at time zone '${TZ}')) as km_month`,
          [dFrom, dTo, wFrom, wTo])).rows[0];
        const capacity = n.resources * HOURS_PER_WEEK;
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month,
                  (select count(*) from bookings b where b.status in ('pending', 'confirmed', 'completed') and date_trunc('month', b.start_at at time zone '${TZ}') = m)::int as bookings,
                  (select coalesce(round(sum(extract(epoch from b.end_at - b.start_at)) / 3600.0, 1), 0) from bookings b
                     where b.status in ('confirmed', 'completed') and date_trunc('month', b.start_at at time zone '${TZ}') = m)::float8 as hours
           from generate_series(date_trunc('month', $1::date::timestamp) - interval '5 months', date_trunc('month', $1::date::timestamp), interval '1 month') m order by m`, [today])).rows;
        const rows = (await c.query(
          `${BK_SELECT} where b.status in ${ACTIVE} and b.end_at >= now() order by b.start_at limit 24`)).rows
          .map((b: any) => ({ id: b.id, no: b.no, status: b.status, title: `${b.resource_name} · ${b.purpose}`,
            subtitle: `${thaiRange(new Date(b.start_at), new Date(b.end_at))} — ${b.requester_name}` }));
        return {
          date: today,
          bookingsToday: n.today,
          pendingApproval: n.pending,
          activeResources: n.resources,
          bookedHoursWeek: round(n.week_hours, 1),
          utilization: capacity ? round((n.week_hours / capacity) * 100, 1) : 0,
          kmMonth: n.km_month,
          months, rows,
        };
      });
    });
  },
};
