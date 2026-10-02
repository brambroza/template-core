import { auth, badRequest, conflict, forbidden, hasPerm, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type AuthContext, type Client, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';
import { TZ, eachDate, hhmm, loadCalendar, loadSchedule, localDate, localMinutes, monthRange, toMinutes } from './calendar.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const optText = (max = 200) => z.string().trim().max(max).optional();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'expected HH:MM');
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'expected YYYY-MM');
const IdParam = z.object({ id: s.uuid });

const DepartmentInput = z.object({
  code: s.code, name: s.name, managerName: optText(), active: z.boolean().optional(),
  /** the department head (an employee): default leave approver for members without a direct manager */
  managerEmployeeId: s.uuid.nullable().optional(),
});
const PositionInput = z.object({ code: s.code, name: s.name });

const EmployeeInput = z.object({
  code: s.code,
  prefix: z.enum(['นาย', 'นาง', 'นางสาว']).optional(),
  firstName: s.name,
  lastName: optText(),
  nickname: optText(50),
  departmentId: s.uuid.optional(),
  positionId: s.uuid.optional(),
  startDate: s.isoDate,
  birthDate: s.isoDate.optional(),
  phone: optText(30),
  email: z.string().trim().email().max(200).optional(),
  status: z.enum(['active', 'probation']).default('active'),
  userId: s.uuid.optional(),
  /** direct manager (an employee) — approves this employee's leave */
  managerId: s.uuid.optional(),
});
const EmployeePatch = EmployeeInput.omit({ status: true }).partial().extend({
  status: z.enum(['active', 'probation', 'resigned']).optional(), userId: s.uuid.nullable().optional(), managerId: s.uuid.nullable().optional(),
});
const EMPLOYEE_COLS: Record<string, string> = {
  code: 'code', prefix: 'prefix', firstName: 'first_name', lastName: 'last_name', nickname: 'nickname', departmentId: 'department_id',
  positionId: 'position_id', startDate: 'start_date', birthDate: 'birth_date', phone: 'phone', email: 'email', status: 'status', userId: 'user_id',
  managerId: 'manager_id',
};

const HolidayInput = z.object({ date: s.isoDate, name: s.name });
const ScheduleInput = z.object({
  startTime: time, endTime: time.optional(), graceMinutes: z.number().int().min(0).max(240).default(0), saturdayWorkday: z.boolean().default(false),
});
const LeaveTypeInput = z.object({
  code: s.code, name: s.name, daysPerYear: z.number().min(0).max(366).nullable().optional(), allowHalfDay: z.boolean().default(true),
  active: z.boolean().optional(), sortOrder: z.number().int().optional(),
});

const LeaveInput = z.object({
  employeeId: s.uuid.optional(),
  leaveTypeId: s.uuid,
  fromDate: s.isoDate,
  toDate: s.isoDate.optional(),
  halfDay: z.boolean().default(false),
  reason: optText(1000),
});
const NoteInput = z.object({ note: optText(1000) });
const RejectInput = z.object({ note: z.string().trim().min(1, 'กรุณาระบุเหตุผลที่ไม่อนุมัติ').max(1000) });

const CheckInput = z.object({
  employeeId: s.uuid.optional(),
  /** only for hr.attendance.manage: record a forgotten scan */
  at: z.string().datetime({ offset: true }).optional(),
  /** same as `at`, as Bangkok local date + HH:MM (what the admin form sends) */
  date: s.isoDate.optional(),
  time: time.optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  note: optText(500),
});

/** Thai labour-law defaults (Labour Protection Act): sick 30 paid days, personal business 3, annual 6, maternity 98. */
const DEFAULT_LEAVE_TYPES = [
  { code: 'SICK', name: 'ลาป่วย', days: 30, half: true, sort: 10 },
  { code: 'BUSINESS', name: 'ลากิจ', days: 3, half: true, sort: 20 },
  { code: 'ANNUAL', name: 'ลาพักร้อน', days: 6, half: true, sort: 30 },
  { code: 'MATERNITY', name: 'ลาคลอด', days: 98, half: false, sort: 40 },
  { code: 'ORDAIN', name: 'ลาบวช', days: 15, half: false, sort: 50 },
  { code: 'MILITARY', name: 'ลารับราชการทหาร', days: 60, half: false, sort: 60 },
  { code: 'UNPAID', name: 'ลาไม่รับค่าจ้าง', days: null, half: true, sort: 90 },
];

const LEAVE_TH: Record<string, string> = { pending: 'รออนุมัติ', approved: 'อนุมัติแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิกแล้ว' };

/* ---------------- queries ---------------- */

const fullName = (x: string) => `coalesce(${x}.prefix, '') || ${x}.first_name || coalesce(' ' || ${x}.last_name, '')`;
const FULL_NAME = fullName('e');
/**
 * Org chart: the leave approver of employee `e` (department `d`) is the direct manager, else the department head (not the employee themself).
 * Only a current employee with a linked login counts — otherwise nobody is the approver and HR (hr.leave.approve / approve-all) decides.
 */
const APPROVER_JOIN = `left join employees ap on ap.id = coalesce(e.manager_id, nullif(d.manager_employee_id, e.id))
    and ap.status <> 'resigned' and ap.user_id is not null and ap.id <> e.id`;
const EMP_SELECT = `select e.*, ${FULL_NAME} as full_name, d.code as department_code, d.name as department_name, p.name as position_name,
    ${fullName('mg')} as manager_name, mg.code as manager_code,
    ap.id as approver_employee_id, ap.user_id as approver_user_id, ${fullName('ap')} as approver_name
  from employees e left join departments d on d.id = e.department_id left join positions p on p.id = e.position_id
  left join employees mg on mg.id = e.manager_id
  ${APPROVER_JOIN}`;
const LEAVE_SELECT = `select r.*, e.code as employee_code, ${FULL_NAME} as employee_name, e.nickname, e.user_id as employee_user_id,
    d.name as department_name, t.code as leave_type_code, t.name as leave_type_name,
    ap.id as approver_employee_id, ap.user_id as approver_user_id, ${fullName('ap')} as approver_name,
    coalesce(${fullName('ap')}, 'ฝ่ายบุคคล') as approver_label
  from leave_requests r join employees e on e.id = r.employee_id join leave_types t on t.id = r.leave_type_id left join departments d on d.id = e.department_id
  ${APPROVER_JOIN}`;
const ATT_SELECT = `select a.*, e.code as employee_code, ${FULL_NAME} as employee_name, e.nickname, d.name as department_name
  from attendance a join employees e on e.id = a.employee_id left join departments d on d.id = e.department_id`;

const like = (q?: string) => (q ? `%${q.trim()}%` : null);

async function loadEmployee(c: Client, id: string, lock = false) {
  if (lock) await c.query('select 1 from employees where id = $1 for update', [id]);
  return one(c, `${EMP_SELECT} where e.id = $1`, [id], 'Employee');
}

async function employeeOfUser(c: Client, userId: string) {
  return (await c.query(`${EMP_SELECT} where e.user_id = $1`, [userId])).rows[0] ?? null;
}

async function mustExist(c: Client, table: string, id: string | undefined | null, what: string) {
  if (!id) return;
  if (!(await c.query(`select 1 from ${table} where id = $1`, [id])).rowCount) throw badRequest(`ไม่พบ${what}ที่เลือก`);
}

async function uniqueCode(c: Client, table: string, code: string, what: string, exceptId?: string) {
  const r = await c.query(`select 1 from ${table} where lower(code) = lower($1) and ($2::uuid is null or id <> $2)`, [code, exceptId ?? null]);
  if (r.rowCount) throw conflict(`รหัส${what} ${code} มีอยู่แล้ว`);
}

async function patchRow(c: Client, table: string, id: string, cols: Record<string, string>, body: Record<string, unknown>, what: string) {
  const sets: string[] = [];
  const vals: unknown[] = [id];
  for (const [key, col] of Object.entries(cols)) {
    if (body[key] === undefined) continue;
    vals.push(body[key]);
    sets.push(`${col} = $${vals.length}`);
  }
  if (!sets.length) return one(c, `select * from ${table} where id = $1`, [id], what);
  return one(c, `update ${table} set ${sets.join(', ')} where id = $1 returning *`, vals, what);
}

/** Leave quota / used / pending / remaining for one employee and one calendar year (by the leave's start date). */
async function balances(c: Client, employeeId: string, year: number) {
  const rows = (await c.query(
    `select t.id as leave_type_id, t.code, t.name, t.days_per_year as quota, t.allow_half_day,
            coalesce(sum(r.days) filter (where r.status = 'approved'), 0) as used,
            coalesce(sum(r.days) filter (where r.status = 'pending'), 0) as pending
     from leave_types t
     left join leave_requests r on r.leave_type_id = t.id and r.employee_id = $1 and extract(year from r.from_date) = $2
     where t.active or r.id is not null
     group by t.id order by t.sort_order, t.code`, [employeeId, year])).rows;
  return rows.map((r: any) => ({ ...r, remaining: r.quota === null ? null : Math.round((r.quota - r.used - r.pending) * 10) / 10 }));
}

async function loadLeave(c: Client, id: string, lock = false) {
  if (lock) await c.query('select 1 from leave_requests where id = $1 for update', [id]);
  return one(c, `${LEAVE_SELECT} where r.id = $1`, [id], 'Leave request');
}

/** "pending" -> 409 with the Thai status name. */
function assertLeaveStatus(lv: any, allowed: string[], verb: string) {
  if (!allowed.includes(lv.status)) throw conflict(`${verb}ใบลา ${lv.no} ไม่ได้ เพราะสถานะเป็น "${LEAVE_TH[lv.status] ?? lv.status}"`);
}

const isOwn = (a: AuthContext, row: { user_id?: string | null; employee_user_id?: string | null }) =>
  (row.employee_user_id ?? row.user_id) === a.userId;

const approveAll = (a: AuthContext) => hasPerm(a, 'hr.leave.approve-all');
/** Any leave permission at all (managers only need to be able to file their own leave). */
const anyLeavePerm = (a: AuthContext) => ['hr.leave.request', 'hr.leave.approve', 'hr.leave.approve-all'].some((p) => hasPerm(a, p));

/**
 * Who may approve / reject this leave: the employee's manager (org chart), HR with `hr.leave.approve-all`, or — when the
 * employee has no manager with a login — anyone with `hr.leave.approve`. Never the employee themself (checked separately → 409).
 */
const canDecide = (a: AuthContext, lv: any) =>
  approveAll(a) || (lv.approver_user_id ? lv.approver_user_id === a.userId : hasPerm(a, 'hr.leave.approve'));

const withLeaveFlags = (a: AuthContext) => (lv: any) => ({
  ...lv,
  can_decide: lv.status === 'pending' && !isOwn(a, lv) && canDecide(a, lv),
  is_my_team: !!lv.approver_user_id && lv.approver_user_id === a.userId,
});

/** Reject a manager that is the employee themself or would create a loop (A → B → A). */
async function checkManager(c: Client, employeeId: string | null, managerId: string | null | undefined) {
  if (!managerId) return;
  if (managerId === employeeId) throw badRequest('พนักงานเป็นหัวหน้าของตนเองไม่ได้', { fieldErrors: { managerId: ['เลือกหัวหน้าคนอื่น'] } });
  if (!(await c.query('select 1 from employees where id = $1', [managerId])).rowCount) throw badRequest('ไม่พบหัวหน้าที่เลือก');
  if (!employeeId) return;
  const loop = (await c.query(
    `with recursive up(id, depth) as (select manager_id, 1 from employees where id = $1
       union all select e.manager_id, up.depth + 1 from employees e join up on e.id = up.id where up.depth < 50 and e.manager_id is not null)
     select 1 from up where id = $2 limit 1`, [managerId, employeeId])).rowCount;
  if (loop) throw badRequest('ตั้งหัวหน้าแบบนี้จะวนกลับมาที่พนักงานคนนี้เอง', { fieldErrors: { managerId: ['สายบังคับบัญชาวนซ้ำ'] } });
}

/** The department head snapshot: id + display name (kept in manager_name for screens that show text). */
async function departmentHead(c: Client, employeeId: string | null | undefined) {
  if (!employeeId) return null;
  const r = (await c.query(`select e.id, ${FULL_NAME} as name from employees e where e.id = $1`, [employeeId])).rows[0];
  if (!r) throw badRequest('ไม่พบหัวหน้าแผนกที่เลือก', { fieldErrors: { managerEmployeeId: ['ไม่พบพนักงาน'] } });
  return r;
}

/** Resolve whose time is being recorded and when. Self check-in uses server time; admins may record for others / a past time. */
async function attendanceTarget(c: Client, a: AuthContext, b: z.infer<typeof CheckInput>) {
  const manage = hasPerm(a, 'hr.attendance.manage');
  if (!manage) requirePerm(a, 'hr.attendance.self');
  let emp: any;
  if (b.employeeId) {
    emp = await loadEmployee(c, b.employeeId, true);
    if (emp.user_id !== a.userId && !manage) throw forbidden('ลงเวลาแทนพนักงานคนอื่นต้องมีสิทธิ์บันทึกเวลาแทนพนักงาน');
  } else {
    emp = await employeeOfUser(c, a.userId);
    if (!emp) throw badRequest('บัญชีผู้ใช้นี้ยังไม่ได้ผูกกับข้อมูลพนักงาน — ให้ฝ่ายบุคคลระบุผู้ใช้ในหน้าพนักงาน');
    await c.query('select 1 from employees where id = $1 for update', [emp.id]);
  }
  // "2026-02-30" must not silently roll over to 2 March
  if (b.date && new Date(`${b.date}T00:00:00Z`).toISOString().slice(0, 10) !== b.date) {
    throw badRequest(`ไม่มีวันที่ ${b.date} ในปฏิทิน`, { fieldErrors: { date: ['วันที่ไม่ถูกต้อง'] } });
  }
  const explicit = b.at ?? (b.time ? `${b.date ?? localDate()}T${b.time}:00+07:00` : undefined);
  if (b.date && !b.time) throw badRequest('ระบุเวลาด้วย (HH:MM)');
  if (explicit && !manage) throw forbidden('ระบุเวลาเองได้เฉพาะผู้มีสิทธิ์บันทึกเวลาแทนพนักงาน');
  if (emp.status === 'resigned') throw conflict(`${emp.full_name} ลาออกแล้ว ลงเวลาไม่ได้`);
  const at = explicit ? new Date(explicit) : new Date();
  if (at.getTime() > Date.now() + 5 * 60000) throw badRequest('ลงเวลาล่วงหน้าไม่ได้');
  const source = explicit || emp.user_id !== a.userId ? 'admin' : 'self';
  return { emp, at, source };
}

async function todayAttendance(c: Client, employeeId: string) {
  return (await c.query(`${ATT_SELECT} where a.employee_id = $1 and a.work_date = $2`, [employeeId, localDate()])).rows[0] ?? null;
}

/** Per-day leave amount (1 or 0.5) for approved leave on working days, keyed `${employeeId}|${date}`. */
async function approvedLeaveDays(c: Client, from: string, to: string, isWorkday: (d: string) => boolean) {
  const map = new Map<string, { amount: number; type: string }>();
  const rows = (await c.query(
    `select r.employee_id, to_char(r.from_date, 'YYYY-MM-DD') as from_date, to_char(r.to_date, 'YYYY-MM-DD') as to_date, r.half_day, t.name as type
     from leave_requests r join leave_types t on t.id = r.leave_type_id
     where r.status = 'approved' and r.from_date <= $2 and r.to_date >= $1`, [from, to])).rows;
  for (const r of rows) {
    for (const d of eachDate(r.from_date > from ? r.from_date : from, r.to_date < to ? r.to_date : to)) {
      if (isWorkday(d)) map.set(`${r.employee_id}|${d}`, { amount: r.half_day ? 0.5 : 1, type: r.type });
    }
  }
  return map;
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  // medical certificates etc. on leave requests: the employee, their approver, HR (same rule as GET /leave-requests/:id)
  attachments: {
    read: ['hr.leave.request', 'hr.leave.approve', 'hr.leave.approve-all', 'hr.employee.read'],
    write: ['hr.leave.request', 'hr.leave.approve', 'hr.leave.approve-all', 'hr.employee.write'],
    entities: {
      leave: {
        table: 'leave_requests',
        access: async (c, a, id) => {
          const lv = await loadLeave(c, id);
          if (!isOwn(a, lv) && lv.approver_user_id !== a.userId && !approveAll(a)) requirePerm(a, 'hr.employee.read');
        },
      },
    },
  },
  routes(app, k) {
    /* ---------------- departments & positions ---------------- */

    app.get('/departments', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      const q = parse(s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select d.*, count(e.id) filter (where e.status <> 'resigned')::int as headcount
         from departments d left join employees e on e.department_id = d.id
         where ($1::text is null or d.code ilike $1 or d.name ilike $1) group by d.id order by d.code limit $2`, [like(q.q), q.limit])).rows);
    });

    app.post('/departments', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.write');
      const b = parse(DepartmentInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await uniqueCode(c, 'departments', b.code, 'แผนก');
        const head = await departmentHead(c, b.managerEmployeeId);
        return (await c.query('insert into departments (code, name, manager_name, active, manager_employee_id) values ($1,$2,$3,$4,$5) returning *',
          [b.code, b.name, head?.name ?? b.managerName ?? null, b.active ?? true, head?.id ?? null])).rows[0];
      });
    });

    app.get('/departments/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const d = await one(c, 'select * from departments where id = $1', [id], 'Department');
        d.employees = (await c.query(`${EMP_SELECT} where e.department_id = $1 and e.status <> 'resigned' order by e.code`, [id])).rows;
        d.headcount = d.employees.length;
        return d;
      });
    });

    app.patch('/departments/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(DepartmentInput.partial(), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        if (b.code) await uniqueCode(c, 'departments', b.code, 'แผนก', id);
        const body: Record<string, unknown> = { ...b };
        if (b.managerEmployeeId !== undefined) {
          const head = await departmentHead(c, b.managerEmployeeId);
          body.managerName = head?.name ?? b.managerName ?? null;
        }
        return patchRow(c, 'departments', id, { code: 'code', name: 'name', managerName: 'manager_name', active: 'active', managerEmployeeId: 'manager_employee_id' }, body, 'Department');
      });
    });

    app.get('/positions', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      const q = parse(s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select p.*, count(e.id) filter (where e.status <> 'resigned')::int as headcount
         from positions p left join employees e on e.position_id = p.id
         where ($1::text is null or p.code ilike $1 or p.name ilike $1) group by p.id order by p.code limit $2`, [like(q.q), q.limit])).rows);
    });

    app.post('/positions', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.write');
      const b = parse(PositionInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await uniqueCode(c, 'positions', b.code, 'ตำแหน่ง');
        return (await c.query('insert into positions (code, name) values ($1,$2) returning *', [b.code, b.name])).rows[0];
      });
    });

    /* ---------------- employees ---------------- */

    app.get('/employees', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      const q = parse(s.listQuery.extend({
        limit: z.coerce.number().int().min(1).max(500).default(200),
        status: z.enum(['active', 'probation', 'resigned', 'current']).optional(),
        departmentId: s.uuid.optional(),
        positionId: s.uuid.optional(),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${EMP_SELECT}
         where ($1::text is null or e.code ilike $1 or e.first_name ilike $1 or e.last_name ilike $1 or e.nickname ilike $1 or (${FULL_NAME}) ilike $1)
           and ($2::text is null or ($2 = 'current' and e.status <> 'resigned') or e.status = $2)
           and ($3::uuid is null or e.department_id = $3) and ($4::uuid is null or e.position_id = $4)
         order by e.code limit $5 offset $6`,
        [like(q.q), q.status ?? null, q.departmentId ?? null, q.positionId ?? null, q.limit, q.offset])).rows);
    });

    app.post('/employees', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.write');
      const b = parse(EmployeeInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await uniqueCode(c, 'employees', b.code, 'พนักงาน');
        await mustExist(c, 'departments', b.departmentId, 'แผนก');
        await mustExist(c, 'positions', b.positionId, 'ตำแหน่ง');
        await checkManager(c, null, b.managerId);
        if (b.userId) {
          const other = (await c.query('select code from employees where user_id = $1', [b.userId])).rows[0];
          if (other) throw conflict(`บัญชีผู้ใช้นี้ผูกกับพนักงาน ${other.code} แล้ว`);
        }
        const row = (await c.query(
          `insert into employees (code, prefix, first_name, last_name, nickname, department_id, position_id, start_date, birth_date, phone, email, status, user_id, manager_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
          [b.code, b.prefix ?? null, b.firstName, b.lastName ?? null, b.nickname ?? null, b.departmentId ?? null, b.positionId ?? null,
            b.startDate, b.birthDate ?? null, b.phone ?? null, b.email ?? null, b.status, b.userId ?? null, b.managerId ?? null])).rows[0];
        return loadEmployee(c, row.id);
      });
    });

    /** Employee card: profile, this year's leave balance, recent leave and attendance. */
    app.get('/employees/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await loadEmployee(c, id);
        e.balance = await balances(c, id, Number(localDate().slice(0, 4)));
        e.leaves = (await c.query(`${LEAVE_SELECT} where r.employee_id = $1 order by r.from_date desc limit 10`, [id])).rows;
        e.attendance = (await c.query(`${ATT_SELECT} where a.employee_id = $1 order by a.work_date desc limit 10`, [id])).rows;
        e.reports = (await c.query(`${EMP_SELECT} where e.manager_id = $1 and e.status <> 'resigned' order by e.code`, [id])).rows;
        e.approver_label = e.approver_name ?? 'ฝ่ายบุคคล';
        return e;
      });
    });

    app.patch('/employees/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(EmployeePatch, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const cur = await loadEmployee(c, id, true);
        if (b.status === cur.status) delete b.status;
        else if (b.status === 'resigned') throw badRequest('บันทึกลาออกด้วยปุ่ม "บันทึกลาออก" เพื่อระบุวันทำงานวันสุดท้าย');
        else if (b.status && cur.status === 'resigned') throw conflict(`${cur.full_name} ลาออกแล้ว เปลี่ยนสถานะไม่ได้`);
        if (b.code) await uniqueCode(c, 'employees', b.code, 'พนักงาน', id);
        await mustExist(c, 'departments', b.departmentId, 'แผนก');
        await mustExist(c, 'positions', b.positionId, 'ตำแหน่ง');
        await checkManager(c, id, b.managerId);
        if (b.userId) {
          const other = (await c.query('select code from employees where user_id = $1 and id <> $2', [b.userId, id])).rows[0];
          if (other) throw conflict(`บัญชีผู้ใช้นี้ผูกกับพนักงาน ${other.code} แล้ว`);
        }
        await patchRow(c, 'employees', id, EMPLOYEE_COLS, b, 'Employee');
        await c.query('update employees set updated_at = now() where id = $1', [id]);
        return loadEmployee(c, id);
      });
    });

    /** probation -> active ("ผ่านทดลองงาน") */
    app.post('/employees/:id/confirm', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await loadEmployee(c, id, true);
        if (e.status !== 'probation') throw conflict(`${e.full_name} ไม่ได้อยู่ระหว่างทดลองงาน`);
        await c.query(`update employees set status = 'active', updated_at = now() where id = $1`, [id]);
        return loadEmployee(c, id);
      });
    });

    app.post('/employees/:id/resign', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ resignedOn: s.isoDate.optional(), note: optText(500) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const e = await loadEmployee(c, id, true);
        if (e.status === 'resigned') throw conflict(`${e.full_name} ลาออกแล้ว`);
        const on = b.resignedOn ?? localDate();
        if (on < e.start_date) throw badRequest('วันที่ลาออกต้องไม่ก่อนวันเริ่มงาน');
        await c.query(`update employees set status = 'resigned', resigned_on = $2, updated_at = now() where id = $1`, [id, on]);
        // pending leave after the last day can no longer be taken
        await c.query(`update leave_requests set status = 'cancelled', decided_by = $3, decided_at = now(), decision_note = 'ยกเลิกอัตโนมัติ: พนักงานลาออก'
                       where employee_id = $1 and status = 'pending' and from_date > $2`, [id, on, a.userId]);
        return loadEmployee(c, id);
      });
    });

    app.get('/employees/:id/balance', async (req) => {
      const a = auth(req);
      const { id } = parse(IdParam, req.params);
      const q = parse(z.object({ year: z.coerce.number().int().min(2000).max(2600).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await loadEmployee(c, id);
        if (!hasPerm(a, 'hr.employee.read') && !isOwn(a, e)) requirePerm(a, 'hr.employee.read');
        // accept a Buddhist-era year too (2569 -> 2026)
        const year = q.year ? (q.year > 2400 ? q.year - 543 : q.year) : Number(localDate().slice(0, 4));
        return { employeeId: e.id, employeeCode: e.code, employeeName: e.full_name, year, rows: await balances(c, id, year) };
      });
    });

    app.get('/employees/:id/attendance', async (req) => {
      const a = auth(req);
      const { id } = parse(IdParam, req.params);
      const q = parse(z.object({ month: month.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await loadEmployee(c, id);
        if (!hasPerm(a, 'hr.attendance.read') && !isOwn(a, e)) requirePerm(a, 'hr.attendance.read');
        const r = monthRange(q.month ?? localDate().slice(0, 7));
        return (await c.query(`${ATT_SELECT} where a.employee_id = $1 and a.work_date between $2 and $3 order by a.work_date`, [id, r.from, r.to])).rows;
      });
    });

    /* ---------------- work calendar ---------------- */

    app.get('/holidays', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      const q = parse(z.object({ year: z.coerce.number().int().min(2000).max(2600).optional(), q: z.string().optional() }), req.query);
      const year = q.year ? (q.year > 2400 ? q.year - 543 : q.year) : null;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select id, to_char(holiday_date, 'YYYY-MM-DD') as date, name, extract(isodow from holiday_date)::int as weekday from holidays
         where ($1::int is null or extract(year from holiday_date) = $1) and ($2::text is null or name ilike $2) order by holiday_date`,
        [year, like(q.q)])).rows);
    });

    app.post('/holidays', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'hr.setup.write');
      const b = parse(HolidayInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const dup = (await c.query('select name from holidays where holiday_date = $1', [b.date])).rows[0];
        if (dup) throw conflict(`วันที่ ${b.date} เป็นวันหยุด "${dup.name}" อยู่แล้ว`);
        return (await c.query(`insert into holidays (holiday_date, name) values ($1,$2) returning id, to_char(holiday_date, 'YYYY-MM-DD') as date, name`, [b.date, b.name])).rows[0];
      });
    });

    app.delete('/holidays/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.setup.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => one(c, `delete from holidays where id = $1 returning id, to_char(holiday_date, 'YYYY-MM-DD') as date, name`, [id], 'Holiday'));
    });

    app.get('/schedule', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      return k.db.tx(a.tenantId, async (c) => {
        const s0 = await loadSchedule(c);
        return { startTime: s0.start_time, endTime: s0.end_time, graceMinutes: s0.grace_minutes, saturdayWorkday: s0.saturday_workday, timezone: TZ };
      });
    });

    app.put('/schedule', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.setup.write');
      const b = parse(ScheduleInput, req.body);
      const end = b.endTime ?? '17:00';
      if (toMinutes(end) <= toMinutes(b.startTime)) throw badRequest('เวลาเลิกงานต้องหลังเวลาเข้างาน');
      return k.db.tx(a.tenantId, async (c) => {
        await c.query(
          `insert into work_settings (start_time, end_time, grace_minutes, saturday_workday) values ($1,$2,$3,$4)
           on conflict (tenant_id) do update set start_time = excluded.start_time, end_time = excluded.end_time,
             grace_minutes = excluded.grace_minutes, saturday_workday = excluded.saturday_workday, updated_at = now()`,
          [b.startTime, end, b.graceMinutes, b.saturdayWorkday]);
        const s0 = await loadSchedule(c);
        return { startTime: s0.start_time, endTime: s0.end_time, graceMinutes: s0.grace_minutes, saturdayWorkday: s0.saturday_workday, timezone: TZ };
      });
    });

    /* ---------------- leave types ---------------- */

    app.get('/leave-types', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'hr.leave.request')) requirePerm(a, 'hr.employee.read');
      const q = parse(z.object({ q: z.string().optional(), all: z.enum(['true', 'false']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from leave_types where ($1::text is null or code ilike $1 or name ilike $1) and ($2 or active) order by sort_order, code`,
        [like(q.q), q.all === 'true'])).rows);
    });

    app.post('/leave-types', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'hr.setup.write');
      const b = parse(LeaveTypeInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await uniqueCode(c, 'leave_types', b.code, 'ประเภทการลา');
        return (await c.query(
          'insert into leave_types (code, name, days_per_year, allow_half_day, active, sort_order) values ($1,$2,$3,$4,$5,$6) returning *',
          [b.code, b.name, b.daysPerYear ?? null, b.allowHalfDay, b.active ?? true, b.sortOrder ?? 100])).rows[0];
      });
    });

    app.get('/leave-types/:id', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'hr.leave.request')) requirePerm(a, 'hr.employee.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from leave_types where id = $1', [id], 'Leave type'));
    });

    app.patch('/leave-types/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.setup.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(LeaveTypeInput.partial(), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        if (b.code) await uniqueCode(c, 'leave_types', b.code, 'ประเภทการลา', id);
        return patchRow(c, 'leave_types', id,
          { code: 'code', name: 'name', daysPerYear: 'days_per_year', allowHalfDay: 'allow_half_day', active: 'active', sortOrder: 'sort_order' }, b, 'Leave type');
      });
    });

    /** One click: the leave types of the Thai Labour Protection Act. Existing codes are kept as they are. */
    app.post('/leave-types/defaults', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.setup.write');
      return k.db.tx(a.tenantId, async (c) => {
        let created = 0;
        for (const t of DEFAULT_LEAVE_TYPES) {
          const r = await c.query(
            `insert into leave_types (code, name, days_per_year, allow_half_day, sort_order) values ($1,$2,$3,$4,$5) on conflict (tenant_id, code) do nothing`,
            [t.code, t.name, t.days, t.half, t.sort]);
          created += r.rowCount ?? 0;
        }
        const types = (await c.query('select * from leave_types order by sort_order, code')).rows;
        return { created, types, message: created ? `เพิ่มประเภทการลา ${created} รายการ` : 'มีประเภทการลาตามกฎหมายครบแล้ว' };
      });
    });

    /* ---------------- leave requests ---------------- */

    app.post('/leave-requests', async (req, reply) => {
      const a = auth(req);
      const approver = hasPerm(a, 'hr.leave.approve');
      if (!approver) requirePerm(a, 'hr.leave.request');
      const b = parse(LeaveInput, req.body);
      const to = b.toDate ?? b.fromDate;
      if (to < b.fromDate) throw badRequest('วันที่สิ้นสุดต้องไม่ก่อนวันที่เริ่มลา');
      if (to.slice(0, 4) !== b.fromDate.slice(0, 4)) throw badRequest('ใบลาหนึ่งใบต้องอยู่ในปีเดียวกัน — กรุณาแยกเป็น 2 ใบ');
      if (b.halfDay && to !== b.fromDate) throw badRequest('ลาครึ่งวันได้เฉพาะการลาวันเดียว');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        let emp: any;
        if (b.employeeId) {
          emp = await loadEmployee(c, b.employeeId, true);
          if (emp.user_id !== a.userId && !approver) throw forbidden('ยื่นลาแทนพนักงานคนอื่นต้องมีสิทธิ์อนุมัติใบลา');
        } else {
          emp = await employeeOfUser(c, a.userId);
          if (!emp) throw badRequest('บัญชีผู้ใช้นี้ยังไม่ได้ผูกกับข้อมูลพนักงาน — ให้ฝ่ายบุคคลระบุผู้ใช้ในหน้าพนักงาน');
          await c.query('select 1 from employees where id = $1 for update', [emp.id]); // serialise balance checks per employee
        }
        if (emp.status === 'resigned') throw conflict(`${emp.full_name} ลาออกแล้ว ยื่นใบลาไม่ได้`);
        if (b.fromDate < String(emp.start_date)) {
          throw badRequest(`ลาก่อนวันเริ่มงาน (${emp.start_date}) ไม่ได้`, { fieldErrors: { fromDate: [`ต้องไม่ก่อนวันเริ่มงาน ${emp.start_date}`] } });
        }
        const type = (await c.query('select * from leave_types where id = $1', [b.leaveTypeId])).rows[0];
        if (!type || !type.active) throw badRequest('ไม่พบประเภทการลาที่เลือก');
        if (b.halfDay && !type.allow_half_day) throw badRequest(`${type.name} ลาครึ่งวันไม่ได้`);

        const cal = await loadCalendar(c, b.fromDate, to);
        const workdays = eachDate(b.fromDate, to).filter((d) => cal.isWorkday(d));
        const days = b.halfDay ? (workdays.length ? 0.5 : 0) : workdays.length;
        if (!days) throw badRequest('ช่วงวันที่เลือกตรงกับวันหยุดทั้งหมด ไม่ต้องยื่นใบลา');

        const clash = (await c.query(
          `select no from leave_requests where employee_id = $1 and status in ('pending', 'approved') and from_date <= $3 and to_date >= $2 limit 1`,
          [emp.id, b.fromDate, to])).rows[0];
        if (clash) throw conflict(`มีใบลา ${clash.no} ในช่วงวันที่นี้แล้ว`);

        const year = Number(b.fromDate.slice(0, 4));
        const bal = (await balances(c, emp.id, year)).find((x: any) => x.leave_type_id === type.id);
        if (bal && bal.remaining !== null && days > bal.remaining) {
          throw badRequest(`วันลาคงเหลือไม่พอ: ${type.name} ปี ${year + 543} คงเหลือ ${Math.max(bal.remaining, 0)} วัน แต่ขอลา ${days} วัน`,
            { quota: bal.quota, used: bal.used, pending: bal.pending, remaining: bal.remaining, requested: days });
        }

        const no = await nextDocNo(c, 'LV');
        const row = (await c.query(
          `insert into leave_requests (no, employee_id, leave_type_id, from_date, to_date, half_day, days, reason, requested_by, requested_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [no, emp.id, type.id, b.fromDate, to, b.halfDay, days, b.reason ?? null, a.userId, a.userName ?? (emp.user_id === a.userId ? emp.full_name : null)])).rows[0];
        const lv = await loadLeave(c, row.id);
        await k.emit(c, 'hr.leave_requested', {
          leaveId: lv.id, no: lv.no, employeeName: lv.employee_name, typeName: lv.leave_type_name, from: String(lv.from_date), to: String(lv.to_date), days: Number(lv.days),
          employeeUserId: lv.employee_user_id ?? null, approverUserId: lv.approver_user_id ?? null, approverName: lv.approver_name ?? null,
        });
        return withLeaveFlags(a)(lv);
      });
    });

    app.get('/leave-requests', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      const q = parse(s.listQuery.extend({
        limit: z.coerce.number().int().min(1).max(500).default(200),
        status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
        employeeId: s.uuid.optional(),
        departmentId: s.uuid.optional(),
        leaveTypeId: s.uuid.optional(),
        from: s.isoDate.optional(),
        to: s.isoDate.optional(),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${LEAVE_SELECT}
         where ($1::text is null or r.no ilike $1 or e.code ilike $1 or e.first_name ilike $1 or e.last_name ilike $1 or e.nickname ilike $1 or t.name ilike $1 or r.reason ilike $1)
           and ($2::text is null or r.status = $2) and ($3::uuid is null or r.employee_id = $3) and ($4::uuid is null or e.department_id = $4)
           and ($5::uuid is null or r.leave_type_id = $5) and ($6::date is null or r.to_date >= $6) and ($7::date is null or r.from_date <= $7)
         order by r.created_at desc limit $8 offset $9`,
        [like(q.q), q.status ?? null, q.employeeId ?? null, q.departmentId ?? null, q.leaveTypeId ?? null, q.from ?? null, q.to ?? null, q.limit, q.offset])).rows.map(withLeaveFlags(a)));
    });

    /**
     * HR approver inbox (mobile): pending leave this user may decide, oldest first.
     * `hr.leave.approve-all` sees everything; `hr.leave.approve` sees employees without a manager (plus their own team).
     */
    app.get('/leave-requests/pending', async (req) => {
      const a = auth(req);
      if (!approveAll(a)) requirePerm(a, 'hr.leave.approve');
      const q = parse(z.object({ q: z.string().optional(), departmentId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${LEAVE_SELECT} where r.status = 'pending' and ($1::text is null or r.no ilike $1 or e.code ilike $1 or e.first_name ilike $1 or e.nickname ilike $1)
           and ($2::uuid is null or e.department_id = $2)
           and ($3::boolean or ap.user_id is null or ap.user_id = $4)
         order by r.from_date, r.created_at limit 200`, [like(q.q), q.departmentId ?? null, approveAll(a), a.userId])).rows.map(withLeaveFlags(a)));
    });

    /** Manager inbox (mobile): pending leave of my team — employees whose manager (or department head) is me. */
    app.get('/leave-requests/inbox', async (req) => {
      const a = auth(req);
      if (!anyLeavePerm(a)) requirePerm(a, 'hr.leave.request');
      const q = parse(z.object({ q: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${LEAVE_SELECT} where r.status = 'pending' and ap.user_id = $1
           and ($2::text is null or r.no ilike $2 or e.code ilike $2 or e.first_name ilike $2 or e.nickname ilike $2)
         order by r.from_date, r.created_at limit 200`, [a.userId, like(q.q)])).rows.map(withLeaveFlags(a)));
    });

    app.get('/leave-requests/:id', async (req) => {
      const a = auth(req);
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const lv = await loadLeave(c, id);
        // the employee, their manager, and HR may read it
        if (!isOwn(a, lv) && lv.approver_user_id !== a.userId && !approveAll(a)) requirePerm(a, 'hr.employee.read');
        const bal = (await balances(c, lv.employee_id, Number(String(lv.from_date).slice(0, 4)))).find((x: any) => x.leave_type_id === lv.leave_type_id);
        return withLeaveFlags(a)({ ...lv, balance: bal ?? null });
      });
    });

    const decideLeave = (decision: 'approved' | 'rejected') => async (req: any) => {
      const a = auth(req);
      if (!anyLeavePerm(a)) requirePerm(a, 'hr.leave.approve');
      const { id } = parse(IdParam, req.params);
      const b = decision === 'approved' ? parse(NoteInput, req.body ?? {}) : parse(RejectInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const lv = await loadLeave(c, id, true);
        assertLeaveStatus(lv, ['pending'], decision === 'approved' ? 'อนุมัติ' : 'ไม่อนุมัติ');
        if (!canDecide(a, lv)) {
          throw forbidden(lv.approver_user_id
            ? `ใบลา ${lv.no} รอ ${lv.approver_name} (หัวหน้าของ ${lv.employee_name}) อนุมัติ — อนุมัติแทนได้เฉพาะฝ่ายบุคคล`
            : 'ไม่มีสิทธิ์อนุมัติใบลานี้');
        }
        if (isOwn(a, lv)) {
          throw conflict(decision === 'approved' ? 'อนุมัติใบลาของตนเองไม่ได้ — ให้หัวหน้าหรือฝ่ายบุคคลอนุมัติ' : 'พิจารณาใบลาของตนเองไม่ได้ — ถ้าไม่ต้องการลาแล้วให้กด "ยกเลิก"');
        }
        await c.query(`update leave_requests set status = $4, decided_by = $2, decided_by_name = $5, decided_at = now(), decision_note = $3 where id = $1`,
          [id, a.userId, b.note ?? null, decision, a.userName ?? null]);
        await k.emit(c, 'hr.leave_decided', {
          leaveId: lv.id, no: lv.no, employeeName: lv.employee_name, typeName: lv.leave_type_name, decision,
          employeeUserId: lv.employee_user_id ?? null, byName: a.userName ?? null, note: b.note ?? null,
        });
        return withLeaveFlags(a)(await loadLeave(c, id));
      });
    };
    app.post('/leave-requests/:id/approve', decideLeave('approved'));
    app.post('/leave-requests/:id/reject', decideLeave('rejected'));

    /** The employee withdraws a pending request; an approver can also cancel an approved one (e.g. came to work after all). */
    app.post('/leave-requests/:id/cancel', async (req) => {
      const a = auth(req);
      const { id } = parse(IdParam, req.params);
      const b = parse(NoteInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const lv = await loadLeave(c, id, true);
        const approver = hasPerm(a, 'hr.leave.approve') || approveAll(a) || (!!lv.approver_user_id && lv.approver_user_id === a.userId);
        if (!approver) {
          requirePerm(a, 'hr.leave.request');
          if (!isOwn(a, lv)) throw forbidden('ยกเลิกได้เฉพาะใบลาของตนเอง');
        }
        assertLeaveStatus(lv, approver ? ['pending', 'approved'] : ['pending'], 'ยกเลิก');
        await c.query(`update leave_requests set status = 'cancelled', decided_by = $2, decided_by_name = $4, decided_at = now(), decision_note = coalesce($3, decision_note) where id = $1`,
          [id, a.userId, b.note ?? null, a.userName ?? null]);
        return withLeaveFlags(a)(await loadLeave(c, id));
      });
    });

    /* ---------------- attendance ---------------- */

    const checkIn = (a: AuthContext, b: z.infer<typeof CheckInput>) =>
      k.db.tx(a.tenantId, async (c) => {
        const { emp, at, source } = await attendanceTarget(c, a, b);
        const workDate = localDate(at);
        const existing = (await c.query('select check_in_at from attendance where employee_id = $1 and work_date = $2', [emp.id, workDate])).rows[0];
        if (existing) throw conflict(`${emp.full_name} ลงเวลาเข้างาน${workDate === localDate() ? 'วันนี้' : `วันที่ ${workDate}`}แล้ว เมื่อ ${hhmm(existing.check_in_at)} น.`);
        const cal = await loadCalendar(c, workDate, workDate);
        const afterStart = localMinutes(at) - toMinutes(cal.schedule.start_time);
        const late = cal.isWorkday(workDate) && afterStart > cal.schedule.grace_minutes ? afterStart : 0;
        const row = (await c.query(
          `insert into attendance (employee_id, work_date, check_in_at, late_minutes, in_lat, in_lng, note, source, recorded_by, recorded_by_name)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [emp.id, workDate, at, late, b.lat ?? null, b.lng ?? null, b.note ?? null, source, a.userId, a.userName ?? (emp.user_id === a.userId ? emp.full_name : null)])).rows[0];
        const rec = (await c.query(`${ATT_SELECT} where a.id = $1`, [row.id])).rows[0];
        rec.message = `ลงเวลาเข้างาน ${hhmm(at)} น.${late ? ` — สาย ${late} นาที` : cal.isWorkday(workDate) ? ' — ตรงเวลา' : ' (วันหยุด)'}`;
        return rec;
      });

    const checkOut = (a: AuthContext, b: z.infer<typeof CheckInput>) =>
      k.db.tx(a.tenantId, async (c) => {
        const { emp, at } = await attendanceTarget(c, a, b);
        // the latest open check-in within 20 hours, so a night shift can check out after midnight
        const open = (await c.query(
          `select * from attendance where employee_id = $1 and check_out_at is null and check_in_at <= $2 and check_in_at > $2::timestamptz - interval '20 hours'
           order by check_in_at desc limit 1 for update`, [emp.id, at])).rows[0];
        if (!open) {
          const done = (await c.query('select check_out_at from attendance where employee_id = $1 and work_date = $2 and check_out_at is not null', [emp.id, localDate(at)])).rows[0];
          const day = localDate(at) === localDate() ? 'วันนี้' : `วันที่ ${localDate(at)}`;
          if (done) throw conflict(`${emp.full_name} ลงเวลาออกงาน${day}แล้ว เมื่อ ${hhmm(done.check_out_at)} น.`);
          throw conflict(`${emp.full_name} ยังไม่ได้ลงเวลาเข้างาน${day} (หรือเวลาออกงานก่อนเวลาเข้างาน)`);
        }
        const cal = await loadCalendar(c, open.work_date, open.work_date);
        const workMinutes = Math.max(0, Math.round((at.getTime() - new Date(open.check_in_at).getTime()) / 60000));
        const sameDay = localDate(at) === open.work_date;
        const early = cal.isWorkday(open.work_date) && sameDay ? Math.max(0, toMinutes(cal.schedule.end_time) - localMinutes(at)) : 0;
        await c.query(
          `update attendance set check_out_at = $2, work_minutes = $3, early_minutes = $4, out_lat = $5, out_lng = $6,
             note = case when $7::text is null then note else concat_ws(' / ', note, $7::text) end where id = $1`,
          [open.id, at, workMinutes, early, b.lat ?? null, b.lng ?? null, b.note ?? null]);
        const rec = (await c.query(`${ATT_SELECT} where a.id = $1`, [open.id])).rows[0];
        const h = Math.floor(workMinutes / 60);
        rec.message = `ลงเวลาออกงาน ${hhmm(at)} น. — ทำงาน ${h} ชม. ${workMinutes % 60} นาที${early ? ` (ออกก่อนเวลา ${early} นาที)` : ''}`;
        return rec;
      });

    app.post('/attendance/check-in', async (req, reply) => {
      const a = auth(req);
      const b = parse(CheckInput, req.body ?? {});
      const rec = await checkIn(a, b);
      reply.code(201);
      return rec;
    });

    app.post('/attendance/check-out', async (req) => {
      const a = auth(req);
      return checkOut(a, parse(CheckInput, req.body ?? {}));
    });

    /** Admin buttons on the employee card: record a forgotten scan for that employee. */
    app.post('/employees/:id/check-in', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'hr.attendance.manage');
      const { id } = parse(IdParam, req.params);
      const rec = await checkIn(a, { ...parse(CheckInput.omit({ employeeId: true }), req.body ?? {}), employeeId: id });
      reply.code(201);
      return rec;
    });

    app.post('/employees/:id/check-out', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.attendance.manage');
      const { id } = parse(IdParam, req.params);
      return checkOut(a, { ...parse(CheckInput.omit({ employeeId: true }), req.body ?? {}), employeeId: id });
    });

    /** Daily board: every current employee on a date with present / late / leave / absent / off. */
    app.get('/attendance', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.attendance.read');
      const q = parse(z.object({
        date: s.isoDate.optional(), departmentId: s.uuid.optional(), q: z.string().optional(),
        status: z.enum(['present', 'late', 'leave', 'absent', 'not_in', 'off']).optional(),
        limit: z.coerce.number().int().min(1).max(1000).default(200),
      }), req.query);
      const date = q.date ?? localDate();
      return k.db.tx(a.tenantId, async (c) => {
        const cal = await loadCalendar(c, date, date);
        const workday = cal.isWorkday(date);
        const leaves = await approvedLeaveDays(c, date, date, () => true);
        const today = localDate();
        const rows = (await c.query(
          `select e.id as employee_id, e.code as employee_code, ${FULL_NAME} as employee_name, e.nickname, d.name as department_name,
                  a.id, a.check_in_at, a.check_out_at, a.late_minutes, a.early_minutes, a.work_minutes, a.note, a.source, a.in_lat, a.in_lng
           from employees e left join departments d on d.id = e.department_id
           left join attendance a on a.employee_id = e.id and a.work_date = $1
           where e.start_date <= $1 and (e.status <> 'resigned' or e.resigned_on >= $1)
             and ($2::uuid is null or e.department_id = $2)
             and ($3::text is null or e.code ilike $3 or e.first_name ilike $3 or e.last_name ilike $3 or e.nickname ilike $3)
           order by e.code limit $4`, [date, q.departmentId ?? null, like(q.q), q.limit])).rows.map((r: any) => {
          const lv = leaves.get(`${r.employee_id}|${date}`);
          let status: string;
          if (r.check_in_at) status = r.late_minutes > 0 ? 'late' : 'present';
          else if (lv) status = 'leave';
          else if (!workday) status = 'off';
          else status = date < today ? 'absent' : 'not_in';
          return { ...r, date, status, leave_type: lv?.type ?? null, holiday: cal.holidays.get(date) ?? null };
        });
        return q.status ? rows.filter((r: any) => r.status === q.status) : rows;
      });
    });

    /** Monthly attendance per employee: working days, present, late count/minutes, leave days, absent (up to today). */
    app.get('/attendance/monthly', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.attendance.read');
      const q = parse(z.object({ month: month.optional(), departmentId: s.uuid.optional(), q: z.string().optional() }), req.query);
      const m = q.month ?? localDate().slice(0, 7);
      const { from, to } = monthRange(m);
      return k.db.tx(a.tenantId, async (c) => {
        const cal = await loadCalendar(c, from, to);
        const today = localDate();
        const upTo = to < today ? to : today;
        const workdays = eachDate(from, to).filter((d) => cal.isWorkday(d));
        const leaves = await approvedLeaveDays(c, from, to, cal.isWorkday);
        const att = (await c.query(
          `select employee_id, to_char(work_date, 'YYYY-MM-DD') as d, late_minutes, work_minutes from attendance where work_date between $1 and $2`, [from, to])).rows;
        const byEmp = new Map<string, any[]>();
        for (const r of att) byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) ?? []), r]);
        const emps = (await c.query(
          `select e.id, e.code, ${FULL_NAME} as full_name, e.nickname, d.name as department_name,
                  to_char(e.start_date, 'YYYY-MM-DD') as start_date, to_char(e.resigned_on, 'YYYY-MM-DD') as resigned_on
           from employees e left join departments d on d.id = e.department_id
           where e.start_date <= $2 and (e.status <> 'resigned' or e.resigned_on >= $1) and ($3::uuid is null or e.department_id = $3)
             and ($4::text is null or e.code ilike $4 or e.first_name ilike $4 or e.last_name ilike $4 or e.nickname ilike $4)
           order by e.code`, [from, to, q.departmentId ?? null, like(q.q)])).rows;
        const rows = emps.map((e: any) => {
          const mine = workdays.filter((d) => d >= e.start_date && (!e.resigned_on || d <= e.resigned_on));
          const recs = byEmp.get(e.id) ?? [];
          const present = new Set(recs.map((r) => r.d));
          let leaveDays = 0;
          let absent = 0;
          for (const d of mine) {
            const lv = leaves.get(`${e.id}|${d}`)?.amount ?? 0;
            leaveDays += lv;
            if (d <= upTo && !present.has(d)) absent += 1 - lv;
          }
          const late = recs.filter((r) => r.late_minutes > 0);
          return {
            employee_id: e.id, employee_code: e.code, employee_name: e.full_name, nickname: e.nickname, department_name: e.department_name, month: m,
            work_days: mine.length, present_days: present.size, late_count: late.length, late_minutes: late.reduce((sum, r) => sum + r.late_minutes, 0),
            leave_days: leaveDays, absent_days: Math.max(0, absent),
            work_hours: Math.round(recs.reduce((sum, r) => sum + (r.work_minutes ?? 0), 0) / 6) / 10,
          };
        });
        return { month: m, workDays: workdays.length, holidays: [...cal.holidays].map(([date, name]) => ({ date, name })), rows };
      });
    });

    /* ---------------- self service & dashboard ---------------- */

    /** The signed-in employee: today's attendance, leave balance and recent leave (mobile home for staff). */
    app.get('/me', async (req) => {
      const a = auth(req);
      if (!hasPerm(a, 'hr.attendance.self') && !hasPerm(a, 'hr.leave.request')) requirePerm(a, 'hr.attendance.self');
      return k.db.tx(a.tenantId, async (c) => {
        const emp = await employeeOfUser(c, a.userId);
        if (!emp) return { employee: null, attendanceState: 'unlinked', balance: [], leaves: [], message: 'บัญชีผู้ใช้นี้ยังไม่ได้ผูกกับข้อมูลพนักงาน — ติดต่อฝ่ายบุคคล' };
        const today = await todayAttendance(c, emp.id);
        const s0 = await loadSchedule(c);
        return {
          employee: emp,
          today,
          schedule: `${s0.start_time}–${s0.end_time} น.`,
          attendanceState: !today ? 'none' : today.check_out_at ? 'out' : 'in',
          /** who approves my leave: my manager (org chart) or HR */
          approverName: emp.approver_name ?? 'ฝ่ายบุคคล',
          teamPending: Number((await c.query(`select count(*)::int as n from leave_requests r join employees e on e.id = r.employee_id left join departments d on d.id = e.department_id ${APPROVER_JOIN} where r.status = 'pending' and ap.user_id = $1`, [a.userId])).rows[0].n),
          balance: await balances(c, emp.id, Number(localDate().slice(0, 4))),
          leaves: (await c.query(`${LEAVE_SELECT} where r.employee_id = $1 order by r.created_at desc limit 10`, [emp.id])).rows,
        };
      });
    });

    app.get('/me/leave-requests', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.leave.request');
      const q = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(), q: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${LEAVE_SELECT} where e.user_id = $1 and ($2::text is null or r.status = $2) and ($3::text is null or r.no ilike $3 or t.name ilike $3 or r.reason ilike $3)
         order by r.from_date desc limit 200`, [a.userId, q.status ?? null, like(q.q)])).rows.map(withLeaveFlags(a)));
    });

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'hr.employee.read');
      return k.db.tx(a.tenantId, async (c) => {
        const today = localDate();
        const n = (await c.query(
          `select (select count(*) from employees where status <> 'resigned')::int as headcount,
                  (select count(*) from employees where status = 'probation')::int as probation,
                  (select count(distinct employee_id) from leave_requests where status = 'approved' and $1::date between from_date and to_date)::int as on_leave,
                  (select count(*) from leave_requests where status = 'pending')::int as pending_leave,
                  (select count(*) from attendance where work_date = $1)::int as present,
                  (select count(*) from attendance where work_date = $1 and late_minutes > 0)::int as late`, [today])).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month,
                  coalesce((select sum(days) from leave_requests r where r.status = 'approved' and date_trunc('month', r.from_date) = m), 0) as "leaveDays",
                  (select count(*) from attendance x where x.late_minutes > 0 and date_trunc('month', x.work_date) = m)::int as "lateCount"
           from generate_series(date_trunc('month', $1::date) - interval '5 months', date_trunc('month', $1::date), interval '1 month') m order by m`, [today])).rows;
        const rows = (await c.query(
          `${LEAVE_SELECT} where r.status <> 'cancelled' order by (r.status = 'pending') desc, r.created_at desc limit 24`)).rows
          .map((r: any) => ({ id: r.id, no: r.no, status: r.status, employee_name: r.employee_name, leave_type_name: r.leave_type_name, days: r.days,
            title: `${r.employee_name} · ${r.leave_type_name}`, subtitle: `${r.from_date === r.to_date ? r.from_date : `${r.from_date} – ${r.to_date}`} (${r.days} วัน)` }));
        return {
          date: today, headcount: n.headcount, probation: n.probation, onLeaveToday: n.on_leave, pendingLeave: n.pending_leave,
          presentToday: n.present, lateToday: n.late, months, rows,
        };
      });
    });
  },
};

