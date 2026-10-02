import { auth, badRequest, conflict, forbidden, hasPerm, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type AuthContext, type Client, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const text = (max: number) => z.string().trim().max(max);
const ListQuery = s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) });
const IdParam = z.object({ id: s.uuid });

const MemberInput = z.object({
  userId: s.uuid,
  userName: text(200).optional(),
  role: text(100).optional(),
  hourlyRate: s.money.default(0),
});

const ProjectInput = z.object({
  name: s.name,
  customerId: s.uuid.nullable().optional(),
  customerName: text(200).nullable().optional(),
  managerId: s.uuid.nullable().optional(),
  managerName: text(200).nullable().optional(),
  budget: s.money.default(0),
  startDate: s.isoDate.nullable().optional(),
  endDate: s.isoDate.nullable().optional(),
  description: text(4000).nullable().optional(),
  members: z.array(MemberInput).default([]),
});
const ProjectPatch = ProjectInput.omit({ members: true }).partial().extend({ name: s.name.optional() });

const ProjectList = ListQuery.extend({
  status: z.enum(['planning', 'active', 'on_hold', 'done', 'cancelled']).optional(),
  /** "true" = everything that can still take tasks/time (not done/cancelled) */
  open: z.enum(['true', 'false']).optional(),
  customerId: s.uuid.optional(),
  managerId: s.uuid.optional(),
});

const MilestoneInput = z.object({ name: s.name, dueDate: s.isoDate.nullable().optional() });

const Priority = z.enum(['low', 'normal', 'high', 'urgent']);
const TaskInput = z.object({
  projectId: s.uuid,
  title: s.name,
  description: text(4000).nullable().optional(),
  assigneeId: s.uuid.nullable().optional(),
  assigneeName: text(200).nullable().optional(),
  priority: Priority.default('normal'),
  dueDate: s.isoDate.nullable().optional(),
  estimateHours: z.number().finite().min(0).max(100000).default(0),
  milestoneId: s.uuid.nullable().optional(),
});
const TaskPatch = TaskInput.omit({ projectId: true }).partial().extend({ priority: Priority.optional(), estimateHours: z.number().finite().min(0).max(100000).optional() });
const TaskList = ListQuery.extend({
  projectId: s.uuid.optional(),
  status: z.enum(['todo', 'doing', 'review', 'done']).optional(),
  assigneeId: s.uuid.optional(),
  priority: Priority.optional(),
  overdue: z.enum(['true', 'false']).optional(),
  /** "true" = not done yet */
  open: z.enum(['true', 'false']).optional(),
});

const Hours = z.number().finite().min(0.25, 'อย่างน้อย 0.25 ชั่วโมง').max(24, 'ไม่เกิน 24 ชั่วโมง');
const TimesheetInput = z.object({
  workDate: s.isoDate,
  projectId: s.uuid,
  taskId: s.uuid.nullable().optional(),
  hours: Hours,
  note: text(1000).nullable().optional(),
  userName: text(200).optional(),
});
const WeekQuery = z.object({ start: s.isoDate.optional(), userId: s.uuid.optional() });
const TimesheetList = ListQuery.extend({ projectId: s.uuid.optional(), userId: s.uuid.optional(), from: s.isoDate.optional(), to: s.isoDate.optional() });
const WeekList = ListQuery.extend({ status: z.enum(['draft', 'submitted', 'approved']).optional(), userId: s.uuid.optional() });

/* ---------------- state machines ---------------- */

const PROJECT_MOVES: Record<string, { from: string[]; to: string }> = {
  activate: { from: ['planning', 'on_hold'], to: 'active' },
  hold: { from: ['active'], to: 'on_hold' },
  complete: { from: ['active', 'on_hold'], to: 'done' },
  cancel: { from: ['planning', 'active', 'on_hold'], to: 'cancelled' },
  reopen: { from: ['done'], to: 'active' },
};
const TASK_MOVES: Record<string, { from: string[]; to: string }> = {
  start: { from: ['todo', 'review'], to: 'doing' },
  review: { from: ['doing'], to: 'review' },
  done: { from: ['todo', 'doing', 'review'], to: 'done' },
  reopen: { from: ['done'], to: 'todo' },
};
const CLOSED_PROJECT = ['done', 'cancelled'];

/* ---------------- queries ---------------- */

/** Project row + live numbers: progress %, hours vs estimate, labour cost (hours × member rate) vs budget. */
const PROJECT_SELECT = `
  select p.*,
    coalesce(t.task_count, 0)::int as task_count, coalesce(t.tasks_done, 0)::int as tasks_done, coalesce(t.overdue_tasks, 0)::int as overdue_tasks,
    coalesce(t.est, 0) as hours_estimated, coalesce(h.hours, 0) as hours_logged, round(coalesce(h.cost, 0), 2) as cost,
    case when coalesce(t.est, 0) > 0 then round(t.est_done / t.est * 100, 1)
         when coalesce(t.task_count, 0) > 0 then round(t.tasks_done * 100.0 / t.task_count, 1) else 0 end as progress,
    case when p.budget > 0 then round(coalesce(h.cost, 0) / p.budget * 100, 1) end as budget_used_pct,
    (p.budget > 0 and coalesce(h.cost, 0) > p.budget * 0.9) as budget_at_risk,
    p.budget - coalesce(h.cost, 0) as budget_left
  from projects p
  left join lateral (
    select count(*) as task_count, count(*) filter (where status = 'done') as tasks_done,
           count(*) filter (where status <> 'done' and due_date < current_date) as overdue_tasks,
           sum(estimate_hours) as est, coalesce(sum(estimate_hours) filter (where status = 'done'), 0) as est_done
    from tasks where project_id = p.id) t on true
  left join lateral (
    select sum(e.hours) as hours, sum(e.hours * coalesce(m.hourly_rate, 0)) as cost
    from timesheet_entries e left join project_members m on m.project_id = e.project_id and m.user_id = e.user_id
    where e.project_id = p.id) h on true`;

const TASK_SELECT = `
  select t.*, p.no as project_no, p.name as project_name, m.name as milestone_name,
    (t.status <> 'done' and t.due_date < current_date) as overdue,
    coalesce((select sum(hours) from timesheet_entries e where e.task_id = t.id), 0) as hours_logged
  from tasks t join projects p on p.id = t.project_id left join milestones m on m.id = t.milestone_id`;

const ENTRY_SELECT = `
  select e.*, p.no as project_no, p.name as project_name, t.title as task_title, w.status as week_status, w.week_start
  from timesheet_entries e join projects p on p.id = e.project_id left join tasks t on t.id = e.task_id join timesheet_weeks w on w.id = e.week_id`;

async function loadProject(c: Client, id: string, lock = false) {
  if (lock) await one(c, 'select id from projects where id = $1 for update', [id], 'Project');
  const p = await one(c, `${PROJECT_SELECT} where p.id = $1`, [id], 'Project');
  p.members = (await c.query(
    `select m.*, coalesce((select sum(hours) from timesheet_entries e where e.project_id = m.project_id and e.user_id = m.user_id), 0) as hours_logged
     from project_members m where m.project_id = $1 order by m.created_at`, [id])).rows
    .map((m: any) => ({ ...m, cost: Math.round(m.hours_logged * m.hourly_rate * 100) / 100 }));
  p.milestones = (await c.query(
    `select m.*, (not m.done and m.due_date < current_date) as overdue,
       (select count(*)::int from tasks t where t.milestone_id = m.id) as task_count,
       (select count(*)::int from tasks t where t.milestone_id = m.id and t.status = 'done') as tasks_done
     from milestones m where m.project_id = $1 order by m.due_date nulls last, m.created_at`, [id])).rows;
  p.tasks = (await c.query(`${TASK_SELECT} where t.project_id = $1 order by case t.status when 'doing' then 0 when 'review' then 1 when 'todo' then 2 else 3 end, t.due_date nulls last, t.created_at`, [id])).rows;
  return p;
}

async function loadTask(c: Client, id: string) {
  const t = await one(c, `${TASK_SELECT} where t.id = $1`, [id], 'Task');
  t.timesheets = (await c.query(`${ENTRY_SELECT} where e.task_id = $1 order by e.work_date desc, e.created_at desc`, [id])).rows;
  return t;
}

async function openProject(c: Client, id: string) {
  const p = await one(c, 'select id, no, status from projects where id = $1', [id], 'Project');
  if (CLOSED_PROJECT.includes(p.status)) throw conflict(`Project ${p.no} is ${p.status}`);
  return p;
}

async function checkMilestone(c: Client, projectId: string, milestoneId: string | null | undefined) {
  if (!milestoneId) return;
  const r = await c.query('select 1 from milestones where id = $1 and project_id = $2', [milestoneId, projectId]);
  if (!r.rowCount) throw badRequest('Milestone does not belong to this project', { fieldErrors: { milestoneId: ['milestone นี้ไม่ได้อยู่ในโครงการ'] } });
}

/** The Monday of the week containing `date` (or today), as YYYY-MM-DD. */
async function weekStartOf(c: Client, date?: string): Promise<string> {
  return (await c.query(`select date_trunc('week', coalesce($1::date, current_date))::date as d`, [date ?? null])).rows[0].d;
}

async function loadWeek(c: Client, userId: string, start?: string) {
  const weekStart = await weekStartOf(c, start);
  const week = (await c.query('select * from timesheet_weeks where user_id = $1 and week_start = $2', [userId, weekStart])).rows[0];
  const rows = week ? (await c.query(`${ENTRY_SELECT} where e.week_id = $1 order by e.work_date, e.created_at`, [week.id])).rows : [];
  const days = (await c.query(
    `select d::date::text as date, coalesce(sum(e.hours), 0)::float as hours
     from generate_series($1::date, $1::date + 6, interval '1 day') d
     left join timesheet_entries e on e.work_date = d::date and e.week_id = $2
     group by d order by d`, [weekStart, week?.id ?? null])).rows;
  const byProject = new Map<string, { project_no: string; project_name: string; hours: number }>();
  for (const r of rows) {
    const x = byProject.get(r.project_id) ?? { project_no: r.project_no, project_name: r.project_name, hours: 0 };
    x.hours += r.hours;
    byProject.set(r.project_id, x);
  }
  return {
    id: week?.id ?? null,
    userId, userName: week?.user_name ?? null,
    weekStart, weekEnd: days[6].date,
    status: week ? week.status : 'empty',
    submittedAt: week?.submitted_at ?? null, approvedAt: week?.approved_at ?? null, rejectReason: week?.reject_reason ?? null,
    total: rows.reduce((sum: number, r: any) => sum + r.hours, 0),
    days, byProject: [...byProject.values()], rows,
  };
}

async function loadWeekById(c: Client, a: AuthContext, id: string, lock = false) {
  const w = await one(c, `select * from timesheet_weeks where id = $1 ${lock ? 'for update' : ''}`, [id], 'Timesheet week');
  if (w.user_id !== a.userId && !hasPerm(a, 'projects.timesheet.approve')) throw forbidden('Missing permission: projects.timesheet.approve');
  w.entries = (await c.query(`${ENTRY_SELECT} where e.week_id = $1 order by e.work_date, e.created_at`, [id])).rows;
  w.total_hours = w.entries.reduce((sum: number, r: any) => sum + r.hours, 0);
  return w;
}

const like = (q?: string) => (q ? `%${q}%` : null);

/** Today in Thailand (Asia/Bangkok, UTC+7) as YYYY-MM-DD. */
const bangkokToday = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

/** End date before start date: a clear Thai field error instead of the raw table constraint. */
function checkDates(start: string | null | undefined, end: string | null | undefined) {
  if (start && end && end < start) throw badRequest('วันสิ้นสุดต้องไม่ก่อนวันเริ่มโครงการ', { fieldErrors: { endDate: ['วันสิ้นสุดต้องไม่ก่อนวันเริ่ม'] } });
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ---------------- projects ---------------- */

    app.post('/projects', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.write');
      const b = parse(ProjectInput, req.body);
      checkDates(b.startDate, b.endDate);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'PJ', b.startDate ? new Date(b.startDate) : new Date());
        const p = (await c.query(
          `insert into projects (no, name, customer_id, customer_name, manager_id, manager_name, budget, start_date, end_date, description, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [no, b.name, b.customerId ?? null, b.customerName ?? null, b.managerId ?? null, b.managerName ?? null, b.budget, b.startDate ?? null, b.endDate ?? null, b.description ?? null, a.userId])).rows[0];
        for (const m of b.members) {
          await c.query(
            `insert into project_members (project_id, user_id, user_name, role, hourly_rate) values ($1,$2,$3,$4,$5)
             on conflict (tenant_id, project_id, user_id) do update set user_name = excluded.user_name, role = excluded.role, hourly_rate = excluded.hourly_rate`,
            [p.id, m.userId, m.userName ?? null, m.role ?? null, m.hourlyRate]);
        }
        if (b.managerId) {
          await c.query(
            `insert into project_members (project_id, user_id, user_name, role) values ($1,$2,$3,'ผู้จัดการโครงการ') on conflict (tenant_id, project_id, user_id) do nothing`,
            [p.id, b.managerId, b.managerName ?? null]);
        }
        return loadProject(c, p.id);
      });
    });

    app.get('/projects', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      const q = parse(ProjectList, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${PROJECT_SELECT}
         where ($1::text is null or p.no ilike $1 or p.name ilike $1 or p.customer_name ilike $1)
           and ($2::text is null or p.status = $2)
           and ($3::text is null or ($3 = 'true') = (p.status not in ('done', 'cancelled')))
           and ($4::uuid is null or p.customer_id = $4) and ($5::uuid is null or p.manager_id = $5)
         order by case p.status when 'active' then 0 when 'planning' then 1 when 'on_hold' then 2 else 3 end, p.created_at desc
         limit $6 offset $7`,
        [like(q.q), q.status ?? null, q.open ?? null, q.customerId ?? null, q.managerId ?? null, q.limit, q.offset])).rows);
    });

    /** Dashboard: what is active, late or over budget; hours per month; open tasks for the board widget. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select (select count(*)::int from projects where status = 'active') as active_projects,
                  (select count(*)::int from tasks t join projects p on p.id = t.project_id
                    where t.status <> 'done' and t.due_date < current_date and p.status not in ('done', 'cancelled')) as overdue_tasks,
                  (select count(*)::int from tasks t join projects p on p.id = t.project_id
                    where t.status <> 'done' and t.due_date between date_trunc('week', current_date)::date and date_trunc('week', current_date)::date + 6
                      and p.status not in ('done', 'cancelled')) as due_this_week,
                  (select coalesce(sum(hours), 0) from timesheet_entries where work_date between date_trunc('week', current_date)::date and date_trunc('week', current_date)::date + 6) as hours_week,
                  (select count(*)::int from timesheet_weeks where status = 'submitted') as weeks_to_approve`)).rows[0];
        const projects = (await c.query(`${PROJECT_SELECT} where p.status not in ('done', 'cancelled') order by p.created_at desc`)).rows;
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(e.hours), 0) as hours
           from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m
           left join timesheet_entries e on date_trunc('month', e.work_date) = m
           group by m order by m`)).rows;
        const rows = (await c.query(
          `select t.id, t.title, t.status, t.priority, t.due_date, t.assignee_name, p.no as project_no, p.name as project_name,
                  (t.status <> 'done' and t.due_date < current_date) as overdue
           from tasks t join projects p on p.id = t.project_id
           where p.status not in ('done', 'cancelled') and (t.status <> 'done' or t.completed_at > now() - interval '7 days')
           order by t.due_date nulls last, t.created_at limit 40`)).rows;
        return {
          activeProjects: n.active_projects, overdueTasks: n.overdue_tasks, tasksDueThisWeek: n.due_this_week, hoursThisWeek: n.hours_week,
          weeksToApprove: n.weeks_to_approve, budgetAtRisk: projects.filter((p: any) => p.budget_at_risk).length,
          months, rows,
          budgetRows: projects.filter((p: any) => p.budget > 0).map((p: any) => ({ id: p.id, no: p.no, name: p.name, label: `${p.no} ${p.name}`, budget_used_pct: p.budget_used_pct ?? 0, limit: 90 })),
        };
      });
    });

    app.get('/projects/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadProject(c, id));
    });

    app.patch('/projects/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ProjectPatch, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const p = await one(c, 'select * from projects where id = $1 for update', [id], 'Project');
        if (p.status === 'cancelled') throw conflict(`Cannot edit cancelled project ${p.no}`);
        checkDates(b.startDate === undefined ? p.start_date : b.startDate, b.endDate === undefined ? p.end_date : b.endDate);
        const map: Record<string, string> = { name: 'name', customerId: 'customer_id', customerName: 'customer_name', managerId: 'manager_id', managerName: 'manager_name', budget: 'budget', startDate: 'start_date', endDate: 'end_date', description: 'description' };
        const keys = Object.keys(map).filter((key) => (b as any)[key] !== undefined);
        if (keys.length) {
          await c.query(`update projects set ${keys.map((key, i) => `${map[key]} = $${i + 2}`).join(', ')} where id = $1`, [id, ...keys.map((key) => (b as any)[key])]);
        }
        return loadProject(c, id);
      });
    });

    for (const [move, rule] of Object.entries(PROJECT_MOVES)) {
      app.post(`/projects/:id/${move}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'projects.project.write');
        const { id } = parse(IdParam, req.params);
        return k.db.tx(a.tenantId, async (c) => {
          const p = await one(c, 'select id, no, status from projects where id = $1 for update', [id], 'Project');
          if (!rule.from.includes(p.status)) throw conflict(`Cannot ${move} project ${p.no}: status is ${p.status}`);
          await c.query(
            `update projects set status = $2, completed_at = case when $2 = 'done' then now() when $2 = 'active' then null else completed_at end,
               start_date = case when $2 = 'active' then coalesce(start_date, current_date) else start_date end where id = $1`,
            [id, rule.to]);
          return loadProject(c, id);
        });
      });
    }

    /** Add a member or change their role / hourly cost rate (upsert by user). */
    app.post('/projects/:id/members', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(MemberInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await openProject(c, id);
        await c.query(
          `insert into project_members (project_id, user_id, user_name, role, hourly_rate) values ($1,$2,$3,$4,$5)
           on conflict (tenant_id, project_id, user_id) do update set user_name = coalesce(excluded.user_name, project_members.user_name),
             role = coalesce(excluded.role, project_members.role), hourly_rate = excluded.hourly_rate`,
          [id, b.userId, b.userName ?? null, b.role ?? null, b.hourlyRate]);
        return loadProject(c, id);
      });
    });

    /* ---------------- milestones ---------------- */

    app.post('/projects/:id/milestones', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(MilestoneInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await openProject(c, id);
        await c.query('insert into milestones (project_id, name, due_date) values ($1,$2,$3)', [id, b.name, b.dueDate ?? null]);
        return loadProject(c, id);
      });
    });

    app.get('/milestones', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      const q = parse(ListQuery.extend({ projectId: s.uuid.optional(), done: z.enum(['true', 'false']).optional(), overdue: z.enum(['true', 'false']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from (
           select m.*, p.no as project_no, p.name as project_name, p.status as project_status, (not m.done and m.due_date < current_date) as overdue
           from milestones m join projects p on p.id = m.project_id) x
         where ($1::text is null or name ilike $1 or project_no ilike $1 or project_name ilike $1)
           and ($2::uuid is null or project_id = $2) and ($3::text is null or done = ($3 = 'true')) and ($4::text is null or overdue = ($4 = 'true'))
         order by done, due_date nulls last, created_at limit $5 offset $6`,
        [like(q.q), q.projectId ?? null, q.done ?? null, q.overdue ?? null, q.limit, q.offset])).rows);
    });

    for (const [move, done] of [['done', true], ['undo', false]] as const) {
      app.post(`/milestones/:id/${move}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'projects.project.write');
        const { id } = parse(IdParam, req.params);
        return k.db.tx(a.tenantId, async (c) => {
          const m = await one(c, 'select * from milestones where id = $1 for update', [id], 'Milestone');
          if (m.done === done) throw conflict(done ? 'Milestone is already done' : 'Milestone is not done');
          await c.query('update milestones set done = $2, done_at = case when $2 then now() end where id = $1', [id, done]);
          return (await c.query('select m.*, (not m.done and m.due_date < current_date) as overdue from milestones m where id = $1', [id])).rows[0];
        });
      });
    }

    /* ---------------- tasks ---------------- */

    app.post('/tasks', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'projects.task.write');
      const b = parse(TaskInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await openProject(c, b.projectId);
        await checkMilestone(c, b.projectId, b.milestoneId);
        const t = (await c.query(
          `insert into tasks (project_id, milestone_id, title, description, assignee_id, assignee_name, priority, due_date, estimate_hours, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning id`,
          [b.projectId, b.milestoneId ?? null, b.title, b.description ?? null, b.assigneeId ?? null, b.assigneeName ?? null, b.priority, b.dueDate ?? null, b.estimateHours, a.userId])).rows[0];
        return loadTask(c, t.id);
      });
    });

    app.get('/tasks', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      const q = parse(TaskList, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${TASK_SELECT}
         where ($1::text is null or t.title ilike $1 or p.no ilike $1 or p.name ilike $1 or t.assignee_name ilike $1)
           and ($2::uuid is null or t.project_id = $2) and ($3::text is null or t.status = $3) and ($4::uuid is null or t.assignee_id = $4)
           and ($5::text is null or t.priority = $5)
           and ($6::text is null or ($6 = 'true') = (t.status <> 'done' and coalesce(t.due_date < current_date, false)))
           and ($7::text is null or ($7 = 'true') = (t.status <> 'done'))
         order by t.status = 'done', t.due_date nulls last, t.created_at desc limit $8 offset $9`,
        [like(q.q), q.projectId ?? null, q.status ?? null, q.assigneeId ?? null, q.priority ?? null, q.overdue ?? null, q.open ?? null, q.limit, q.offset])).rows);
    });

    /** Kanban board: counts per status + tasks still open (and those finished in the last 14 days). */
    app.get('/tasks/board', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      const q = parse(z.object({ projectId: s.uuid.optional(), assigneeId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `${TASK_SELECT}
           where p.status not in ('cancelled') and ($1::uuid is null or t.project_id = $1) and ($2::uuid is null or t.assignee_id = $2)
             and (t.status <> 'done' or t.completed_at > now() - interval '14 days')
           order by t.due_date nulls last, t.created_at`, [q.projectId ?? null, q.assigneeId ?? null])).rows;
        const counts = { todo: 0, doing: 0, review: 0, done: 0 } as Record<string, number>;
        for (const r of rows) counts[r.status]++;
        return { counts, rows };
      });
    });

    /** My open tasks (assignee = the caller), soonest due first — the phone's home list. */
    app.get('/tasks/mine', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      const q = parse(ListQuery.extend({ all: z.enum(['true', 'false']).optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${TASK_SELECT}
         where t.assignee_id = $1 and p.status not in ('done', 'cancelled') and ($2 = 'true' or t.status <> 'done')
           and ($3::text is null or t.title ilike $3 or p.no ilike $3 or p.name ilike $3)
         order by t.status = 'done', t.due_date nulls last, case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at
         limit $4 offset $5`,
        [a.userId, q.all ?? 'false', like(q.q), q.limit, q.offset])).rows);
    });

    app.get('/tasks/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.project.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadTask(c, id));
    });

    app.patch('/tasks/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.task.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(TaskPatch, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const t = await one(c, 'select * from tasks where id = $1 for update', [id], 'Task');
        await openProject(c, t.project_id);
        await checkMilestone(c, t.project_id, b.milestoneId);
        const map: Record<string, string> = { title: 'title', description: 'description', assigneeId: 'assignee_id', assigneeName: 'assignee_name', priority: 'priority', dueDate: 'due_date', estimateHours: 'estimate_hours', milestoneId: 'milestone_id' };
        const keys = Object.keys(map).filter((key) => (b as any)[key] !== undefined);
        if (keys.length) {
          await c.query(`update tasks set ${keys.map((key, i) => `${map[key]} = $${i + 2}`).join(', ')}, updated_at = now() where id = $1`, [id, ...keys.map((key) => (b as any)[key])]);
        }
        return loadTask(c, id);
      });
    });

    for (const [move, rule] of Object.entries(TASK_MOVES)) {
      app.post(`/tasks/:id/${move}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'projects.task.write');
        const { id } = parse(IdParam, req.params);
        return k.db.tx(a.tenantId, async (c) => {
          const t = await one(c, 'select t.id, t.status, t.project_id, t.title from tasks t where t.id = $1 for update', [id], 'Task');
          const p = await one(c, 'select no, status from projects where id = $1', [t.project_id], 'Project');
          if (p.status === 'cancelled') throw conflict(`Project ${p.no} is cancelled`);
          if (!rule.from.includes(t.status)) throw conflict(`Cannot ${move} task "${t.title}": status is ${t.status}`);
          await c.query(
            `update tasks set status = $2, updated_at = now(), completed_at = case when $2 = 'done' then now() end where id = $1`, [id, rule.to]);
          return loadTask(c, id);
        });
      });
    }

    /* ---------------- timesheets ---------------- */

    /** Log hours for the caller. The week (Mon–Sun) must still be a draft. */
    app.post('/timesheets', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.log');
      const b = parse(TimesheetInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const p = await one(c, 'select id, no, status from projects where id = $1', [b.projectId], 'Project');
        if (p.status === 'cancelled') throw conflict(`Project ${p.no} is cancelled`);
        if (b.workDate > bangkokToday()) throw badRequest(`ลงชั่วโมงล่วงหน้าไม่ได้ (${b.workDate})`, { fieldErrors: { workDate: ['วันที่ทำงานต้องไม่เกินวันนี้'] } });
        if (b.taskId) {
          const t = await c.query('select 1 from tasks where id = $1 and project_id = $2', [b.taskId, b.projectId]);
          if (!t.rowCount) throw badRequest('Task does not belong to this project', { fieldErrors: { taskId: ['งานนี้ไม่ได้อยู่ในโครงการ'] } });
        }
        const member = (await c.query('select user_name from project_members where project_id = $1 and user_id = $2', [b.projectId, a.userId])).rows[0];
        const userName = b.userName ?? member?.user_name ?? null;
        const weekStart = await weekStartOf(c, b.workDate);
        const week = (await c.query(
          `insert into timesheet_weeks (user_id, user_name, week_start) values ($1,$2,$3)
           on conflict (tenant_id, user_id, week_start) do update set user_name = coalesce(timesheet_weeks.user_name, excluded.user_name)
           returning *`, [a.userId, userName, weekStart])).rows[0];
        if (week.status !== 'draft') throw conflict(`Timesheet week ${weekStart} is ${week.status}`);
        const day = (await c.query('select coalesce(sum(hours), 0) as h from timesheet_entries where user_id = $1 and work_date = $2', [a.userId, b.workDate])).rows[0].h;
        if (day + b.hours > 24) throw badRequest(`More than 24 hours on ${b.workDate}`, { fieldErrors: { hours: [`วันนี้ลงไปแล้ว ${day} ชั่วโมง รวมเกิน 24 ชั่วโมง`] } });
        const e = (await c.query(
          `insert into timesheet_entries (week_id, user_id, user_name, work_date, project_id, task_id, hours, note) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
          [week.id, a.userId, userName, b.workDate, b.projectId, b.taskId ?? null, b.hours, b.note ?? null])).rows[0];
        return (await c.query(`${ENTRY_SELECT} where e.id = $1`, [e.id])).rows[0];
      });
    });

    /** Entries: your own, or anyone's with projects.timesheet.approve. */
    app.get('/timesheets', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.log');
      const q = parse(TimesheetList, req.query);
      const userId = hasPerm(a, 'projects.timesheet.approve') ? q.userId ?? null : a.userId;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${ENTRY_SELECT}
         where ($1::uuid is null or e.user_id = $1) and ($2::uuid is null or e.project_id = $2)
           and ($3::date is null or e.work_date >= $3) and ($4::date is null or e.work_date <= $4)
           and ($5::text is null or p.no ilike $5 or p.name ilike $5 or e.note ilike $5 or t.title ilike $5 or e.user_name ilike $5)
         order by e.work_date desc, e.created_at desc limit $6 offset $7`,
        [userId, q.projectId ?? null, q.from ?? null, q.to ?? null, like(q.q), q.limit, q.offset])).rows);
    });

    /** One user's week (Mon–Sun): entries, hours per day and per project, status. Default = the caller, this week. */
    app.get('/timesheets/week', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.log');
      const q = parse(WeekQuery, req.query);
      const userId = q.userId ?? a.userId;
      if (userId !== a.userId) requirePerm(a, 'projects.timesheet.approve');
      return k.db.tx(a.tenantId, (c) => loadWeek(c, userId, q.start));
    });

    /** Submit the caller's week for approval (draft -> submitted). */
    app.post('/timesheets/week/submit', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.log');
      const b = parse(z.object({ start: s.isoDate.optional() }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const weekStart = await weekStartOf(c, b.start);
        const w = (await c.query('select * from timesheet_weeks where user_id = $1 and week_start = $2 for update', [a.userId, weekStart])).rows[0];
        if (!w) throw conflict(`No hours logged in week ${weekStart}`);
        if (w.status !== 'draft') throw conflict(`Timesheet week ${weekStart} is already ${w.status}`);
        const n = (await c.query('select count(*)::int as n from timesheet_entries where week_id = $1', [w.id])).rows[0].n;
        if (!n) throw conflict(`No hours logged in week ${weekStart}`);
        await c.query(`update timesheet_weeks set status = 'submitted', submitted_at = now(), reject_reason = null where id = $1`, [w.id]);
        return loadWeek(c, a.userId, weekStart);
      });
    });

    app.delete('/timesheets/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.log');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const e = await one(c, `${ENTRY_SELECT} where e.id = $1`, [id], 'Timesheet entry');
        if (e.user_id !== a.userId) throw forbidden('You can only delete your own hours');
        if (e.week_status !== 'draft') throw conflict(`Timesheet week ${e.week_start} is ${e.week_status}`);
        await c.query('delete from timesheet_entries where id = $1', [id]);
        return { deleted: true, id };
      });
    });

    /** Weeks for the approver (default: everything submitted). */
    app.get('/timesheet-weeks', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.approve');
      const q = parse(WeekList, req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select w.*, (w.week_start + 6) as week_end, coalesce(sum(e.hours), 0) as total_hours, count(e.id)::int as entries
         from timesheet_weeks w left join timesheet_entries e on e.week_id = w.id
         where ($1::text is null or w.status = $1) and ($2::uuid is null or w.user_id = $2) and ($3::text is null or w.user_name ilike $3)
         group by w.id having count(e.id) > 0
         order by case w.status when 'submitted' then 0 when 'draft' then 1 else 2 end, w.week_start desc limit $4 offset $5`,
        [q.status ?? null, q.userId ?? null, like(q.q), q.limit, q.offset])).rows);
    });

    app.get('/timesheet-weeks/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.log');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadWeekById(c, a, id));
    });

    app.post('/timesheet-weeks/:id/approve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.approve');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const w = await loadWeekById(c, a, id, true);
        if (w.status !== 'submitted') throw conflict(`Cannot approve a ${w.status} timesheet week`);
        if (w.user_id === a.userId) throw forbidden('อนุมัติชั่วโมงทำงานของตนเองไม่ได้ — ให้ผู้อนุมัติคนอื่นอนุมัติ');
        await c.query(`update timesheet_weeks set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [id, a.userId]);
        return loadWeekById(c, a, id);
      });
    });

    /** Send a submitted week back to the user as draft, with a reason. */
    app.post('/timesheet-weeks/:id/reject', async (req) => {
      const a = auth(req);
      requirePerm(a, 'projects.timesheet.approve');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ reason: z.string().trim().min(1).max(1000) }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const w = await loadWeekById(c, a, id, true);
        if (w.status !== 'submitted') throw conflict(`Cannot reject a ${w.status} timesheet week`);
        await c.query(`update timesheet_weeks set status = 'draft', submitted_at = null, reject_reason = $2 where id = $1`, [id, b.reason]);
        return loadWeekById(c, a, id);
      });
    });
  },
};
