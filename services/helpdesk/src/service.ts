import { auth, conflict, forbidden, hasPerm, loadManifest, nextDocNo, notFound, one, parse, requirePerm, s, z, type AuthContext, type Client, type ServiceDefinition } from '@erp/kernel';
import { round } from '@erp/thai';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const text = (max = 200) => z.string().trim().max(max).optional();
const flag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true');
const ListQuery = s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) });
const IdParam = z.object({ id: s.uuid });
const hours = z.number().finite().positive().max(8760);

const CategoryInput = z.object({
  code: s.code,
  name: s.name,
  slaResponseHours: hours.default(4),
  slaResolveHours: hours.default(24),
  defaultAssigneeId: s.uuid.nullable().optional(),
  defaultAssigneeName: text(),
  active: z.boolean().default(true),
}).refine((v) => v.slaResolveHours >= v.slaResponseHours, { message: 'resolve SLA must not be shorter than response SLA', path: ['slaResolveHours'] });

const TicketInput = z.object({
  title: s.name,
  description: text(5000),
  requesterName: text(),
  requesterContact: text(),
  channel: z.enum(['web', 'phone', 'line', 'email', 'walk_in']).default('web'),
  categoryId: s.uuid.nullable().optional(),
  priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'),
  assigneeId: s.uuid.nullable().optional(),
  assigneeName: text(),
});
const TicketEdit = TicketInput.omit({ assigneeId: true, assigneeName: true, channel: true }).extend({ channel: TicketInput.shape.channel.optional() });

const CommentInput = z.object({ body: z.string().trim().min(1).max(5000), internal: z.boolean().default(false), authorName: text() });
const AssignInput = z.object({ assigneeId: s.uuid, assigneeName: text() });
const ResolveInput = z.object({ resolution: z.string().trim().min(1).max(5000) });
const CloseInput = z.object({ satisfaction: z.coerce.number().int().min(1).max(5).optional(), feedback: text(2000) });
const ReopenInput = z.object({ reason: text(1000) });

const CannedInput = z.object({ title: s.name, body: z.string().trim().min(1).max(5000), categoryId: s.uuid.nullable().optional() });
const ArticleInput = z.object({ title: s.name, body: z.string().trim().min(1).max(50000), categoryId: s.uuid.nullable().optional(), published: z.boolean().default(false) });

/* ---------------- helpers ---------------- */

const ACTIVE = `t.status not in ('resolved', 'closed')`;
const TICKET_SELECT = `select t.*,
  (${ACTIVE} and now() > t.due_at) as overdue,
  (${ACTIVE} and t.first_response_at is null and now() > t.response_due_at) as response_overdue,
  case t.priority when 'low' then 'ต่ำ' when 'normal' then 'ปกติ' when 'high' then 'สูง' else 'ด่วนมาก' end as priority_label,
  case t.channel when 'web' then 'เว็บ' when 'phone' then 'โทรศัพท์' when 'line' then 'LINE' when 'email' then 'อีเมล' else 'มาด้วยตัวเอง' end as channel_label
  from tickets t`;

const DEFAULT_SLA = { response: 4, resolve: 24 };

/** Accept either of two permissions (e.g. requester or technician). */
function requireAny(a: AuthContext, ...perms: string[]) {
  if (!perms.some((p) => hasPerm(a, p))) requirePerm(a, perms[0]);
}

/** SLA hours for a category + priority; urgent halves both. */
async function sla(c: Client, categoryId: string | null | undefined, priority: string) {
  let cat: any = null;
  if (categoryId) cat = await one(c, 'select * from categories where id = $1', [categoryId], 'Category');
  const f = priority === 'urgent' ? 0.5 : 1;
  return {
    cat,
    responseSecs: Math.round(Number(cat?.sla_response_hours ?? DEFAULT_SLA.response) * f * 3600),
    resolveSecs: Math.round(Number(cat?.sla_resolve_hours ?? DEFAULT_SLA.resolve) * f * 3600),
  };
}

/** A requester may see their own tickets; staff with read/work see all. Internal notes only for technicians. */
async function loadTicket(c: Client, a: AuthContext, id: string, lock = false) {
  if (lock) await one(c, 'select id from tickets where id = $1 for update', [id], 'Ticket');
  const t = await one(c, `${TICKET_SELECT} where t.id = $1`, [id], 'Ticket');
  const staff = hasPerm(a, 'helpdesk.ticket.read') || hasPerm(a, 'helpdesk.ticket.work');
  if (!staff && t.created_by !== a.userId) throw notFound('Ticket');
  t.comments = (await c.query(
    `select *, case when internal then 'บันทึกภายใน' else 'ตอบกลับ' end as kind_label from ticket_comments
     where ticket_id = $1 and ($2 or not internal) order by created_at`, [id, hasPerm(a, 'helpdesk.ticket.work')])).rows;
  return t;
}

async function addComment(c: Client, ticketId: string, a: AuthContext, body: string, internal: boolean, authorName?: string | null) {
  await c.query('insert into ticket_comments (ticket_id, internal, body, author_id, author_name) values ($1,$2,$3,$4,$5)', [ticketId, internal, body, a.userId, authorName ?? null]);
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ================= categories ================= */

    app.get('/categories', async (req) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.ticket.create', 'helpdesk.ticket.read', 'helpdesk.kb.read');
      const q = parse(ListQuery.extend({ all: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from categories where ($1 or active) and ($2::text is null or code ilike $2 or name ilike $2) order by code limit $3 offset $4`,
        [q.all, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    app.get('/categories/:id', async (req) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.ticket.create', 'helpdesk.ticket.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from categories where id = $1', [id], 'Category'));
    });

    app.post('/categories', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.setup.write');
      const b = parse(CategoryInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `insert into categories (code, name, sla_response_hours, sla_resolve_hours, default_assignee_id, default_assignee_name, active)
         values ($1,$2,$3,$4,$5,$6,$7) returning *`,
        [b.code, b.name, b.slaResponseHours, b.slaResolveHours, b.defaultAssigneeId ?? null, b.defaultAssigneeName ?? null, b.active])).rows[0]);
    });

    app.put('/categories/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.setup.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(CategoryInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from categories where id = $1', [id], 'Category');
        return (await c.query(
          `update categories set code = $2, name = $3, sla_response_hours = $4, sla_resolve_hours = $5, default_assignee_id = $6, default_assignee_name = $7,
             active = $8, updated_at = now() where id = $1 returning *`,
          [id, b.code, b.name, b.slaResponseHours, b.slaResolveHours, b.defaultAssigneeId ?? null, b.defaultAssigneeName ?? null, b.active])).rows[0];
      });
    });

    /* ================= tickets ================= */

    app.post('/tickets', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.create');
      const b = parse(TicketInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const { cat, responseSecs, resolveSecs } = await sla(c, b.categoryId, b.priority);
        if (cat && !cat.active) throw conflict(`Category ${cat.code} is inactive`);
        // only technicians pick an assignee; otherwise the category's default technician takes it
        const assignId = (hasPerm(a, 'helpdesk.ticket.work') && b.assigneeId) || cat?.default_assignee_id || null;
        const assignName = assignId && assignId === b.assigneeId ? b.assigneeName ?? null : cat?.default_assignee_name ?? null;
        const no = await nextDocNo(c, 'TK');
        const row = (await c.query(
          `insert into tickets (no, title, description, requester_name, requester_contact, channel, category_id, category_name, priority, assignee_id, assignee_name,
             response_due_at, due_at, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11, now() + $12 * interval '1 second', now() + $13 * interval '1 second', $14) returning id`,
          [no, b.title, b.description ?? null, b.requesterName ?? null, b.requesterContact ?? null, b.channel, cat?.id ?? null, cat?.name ?? null, b.priority,
            assignId, assignName, responseSecs, resolveSecs, a.userId],
        )).rows[0];
        await k.emit(c, 'helpdesk.ticket_created', {
          ticketId: row.id, no, title: b.title, priority: b.priority, categoryName: cat?.name ?? null, requesterName: b.requesterName ?? null, assigneeName: assignName,
        });
        return loadTicket(c, a, row.id);
      });
    });

    app.get('/tickets', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.read');
      const q = parse(ListQuery.extend({
        status: z.string().optional(), priority: z.string().optional(), channel: z.string().optional(), categoryId: s.uuid.optional(),
        assigneeId: s.uuid.optional(), unassigned: flag, overdue: flag, active: flag,
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${TICKET_SELECT}
         where ($1::text is null or t.status = $1) and ($2::text is null or t.priority = $2) and ($3::text is null or t.channel = $3)
           and ($4::uuid is null or t.category_id = $4) and ($5::uuid is null or t.assignee_id = $5)
           and (not $6 or (t.assignee_id is null and ${ACTIVE})) and (not $7 or (${ACTIVE} and now() > t.due_at)) and (not $8 or ${ACTIVE})
           and ($9::text is null or t.no ilike $9 or t.title ilike $9 or t.requester_name ilike $9 or t.description ilike $9)
         order by (t.status in ('resolved', 'closed')), t.due_at limit $10 offset $11`,
        [q.status ?? null, q.priority ?? null, q.channel ?? null, q.categoryId ?? null, q.assigneeId ?? null, q.unassigned, q.overdue, q.active,
          q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    /** Technician's queue: open work assigned to me, most urgent due first. */
    app.get('/tickets/mine', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${TICKET_SELECT} where t.assignee_id = $1 and ${ACTIVE} order by t.due_at limit 200`, [a.userId])).rows);
    });

    /** Active tickets past their resolve deadline, most overdue first. */
    app.get('/tickets/overdue', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${TICKET_SELECT} where ${ACTIVE} and now() > t.due_at order by t.due_at limit 200`)).rows);
    });

    /** Requester's own tickets (any status). */
    app.get('/tickets/requested', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.create');
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${TICKET_SELECT} where t.created_by = $1 order by t.created_at desc limit 200`, [a.userId])).rows);
    });

    app.get('/tickets/:id', async (req) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.ticket.read', 'helpdesk.ticket.create');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadTicket(c, a, id));
    });

    /** Change title/description/category/priority while the ticket is still active; SLA due times are recomputed from creation. */
    app.put('/tickets/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      const { id } = parse(IdParam, req.params);
      const b = parse(TicketEdit, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (['resolved', 'closed'].includes(t.status)) throw conflict(`Cannot edit a ${t.status} ticket`);
        const { cat, responseSecs, resolveSecs } = await sla(c, b.categoryId, b.priority);
        await c.query(
          `update tickets set title = $2, description = $3, requester_name = $4, requester_contact = $5, channel = coalesce($6, channel), category_id = $7, category_name = $8,
             priority = $9, response_due_at = created_at + $10 * interval '1 second', due_at = created_at + $11 * interval '1 second', updated_at = now() where id = $1`,
          [id, b.title, b.description ?? null, b.requesterName ?? null, b.requesterContact ?? null, b.channel ?? null, cat?.id ?? null, cat?.name ?? null, b.priority, responseSecs, resolveSecs],
        );
        return loadTicket(c, a, id);
      });
    });

    app.post('/tickets/:id/assign', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      const { id } = parse(IdParam, req.params);
      const b = parse(AssignInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (['resolved', 'closed'].includes(t.status)) throw conflict(`Cannot assign a ${t.status} ticket`);
        await c.query('update tickets set assignee_id = $2, assignee_name = $3, updated_at = now() where id = $1', [id, b.assigneeId, b.assigneeName ?? null]);
        await addComment(c, id, a, `มอบหมายให้ ${b.assigneeName ?? b.assigneeId}`, true);
        return loadTicket(c, a, id);
      });
    });

    /** open/waiting → in_progress. Takes the ticket if nobody has it and counts as the first response. */
    app.post('/tickets/:id/start', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (!['open', 'waiting'].includes(t.status)) throw conflict(`Cannot start a ${t.status} ticket`);
        await c.query(
          `update tickets set status = 'in_progress', assignee_id = coalesce(assignee_id, $2), first_response_at = coalesce(first_response_at, now()), updated_at = now()
           where id = $1`, [id, a.userId]);
        return loadTicket(c, a, id);
      });
    });

    /** in_progress → waiting (for the requester / parts / a vendor). */
    app.post('/tickets/:id/wait', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ reason: text(1000) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (t.status !== 'in_progress') throw conflict(`Cannot put a ${t.status} ticket on hold`);
        await c.query(`update tickets set status = 'waiting', updated_at = now() where id = $1`, [id]);
        if (b.reason) await addComment(c, id, a, `รอ: ${b.reason}`, false);
        return loadTicket(c, a, id);
      });
    });

    app.post('/tickets/:id/comments', async (req, reply) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.ticket.work', 'helpdesk.ticket.create');
      const { id } = parse(IdParam, req.params);
      const b = parse(CommentInput, req.body);
      const tech = hasPerm(a, 'helpdesk.ticket.work');
      if (b.internal) requirePerm(a, 'helpdesk.ticket.work'); // internal notes are for technicians only
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (t.status === 'closed') throw conflict('Cannot comment on a closed ticket');
        await addComment(c, id, a, b.body, b.internal, b.authorName);
        if (tech && !b.internal) await c.query('update tickets set first_response_at = coalesce(first_response_at, now()), updated_at = now() where id = $1', [id]);
        // the requester answered: back to the technician
        if (!b.internal && t.status === 'waiting' && t.created_by === a.userId) await c.query(`update tickets set status = 'in_progress', updated_at = now() where id = $1`, [id]);
        return loadTicket(c, a, id);
      });
    });

    app.post('/tickets/:id/resolve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      const { id } = parse(IdParam, req.params);
      const b = parse(ResolveInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (!['open', 'in_progress', 'waiting'].includes(t.status)) throw conflict(`Cannot resolve a ${t.status} ticket`);
        await c.query(
          `update tickets set status = 'resolved', resolution = $2, resolved_at = now(), first_response_at = coalesce(first_response_at, now()),
             assignee_id = coalesce(assignee_id, $3), updated_at = now() where id = $1`, [id, b.resolution, a.userId]);
        await k.emit(c, 'helpdesk.ticket_resolved', { ticketId: t.id, no: t.no, title: t.title, requesterName: t.requester_name ?? null, resolution: b.resolution });
        return loadTicket(c, a, id);
      });
    });

    /** resolved → open again (the fix did not hold); a new resolve deadline starts now. */
    app.post('/tickets/:id/reopen', async (req) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.ticket.work', 'helpdesk.ticket.create');
      const { id } = parse(IdParam, req.params);
      const b = parse(ReopenInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (t.status !== 'resolved') throw conflict(`Cannot reopen a ${t.status} ticket`);
        const { resolveSecs } = await sla(c, t.category_id, t.priority);
        await c.query(
          `update tickets set status = 'open', resolved_at = null, reopen_count = reopen_count + 1, due_at = now() + $2 * interval '1 second', updated_at = now()
           where id = $1`, [id, resolveSecs]);
        await addComment(c, id, a, `เปิดเรื่องใหม่${b.reason ? `: ${b.reason}` : ''}`, false);
        return loadTicket(c, a, id);
      });
    });

    /** resolved → closed, with the requester's satisfaction (1–5) and feedback. */
    app.post('/tickets/:id/close', async (req) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.ticket.create', 'helpdesk.ticket.work');
      const { id } = parse(IdParam, req.params);
      const b = parse(CloseInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const t = await loadTicket(c, a, id, true);
        if (t.status !== 'resolved') throw conflict(`Cannot close a ${t.status} ticket`);
        // the satisfaction score is the requester's voice: a technician closing someone else's ticket cannot rate their own work
        if ((b.satisfaction !== undefined || b.feedback) && t.created_by !== a.userId) {
          throw forbidden('ให้คะแนนความพึงพอใจได้เฉพาะผู้แจ้งเรื่อง — ปิดเรื่องโดยไม่ต้องให้คะแนน');
        }
        await c.query(`update tickets set status = 'closed', closed_at = now(), satisfaction = $2, feedback = $3, updated_at = now() where id = $1`,
          [id, b.satisfaction ?? null, b.feedback ?? null]);
        return loadTicket(c, a, id);
      });
    });

    /* ================= canned replies ================= */

    app.get('/canned-replies', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      const q = parse(ListQuery.extend({ categoryId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select r.*, c.name as category_name from canned_replies r left join categories c on c.id = r.category_id
         where ($1::text is null or r.title ilike $1 or r.body ilike $1) and ($2::uuid is null or r.category_id = $2 or r.category_id is null)
         order by r.title limit $3 offset $4`, [q.q ? `%${q.q}%` : null, q.categoryId ?? null, q.limit, q.offset])).rows);
    });

    app.get('/canned-replies/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.work');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from canned_replies where id = $1', [id], 'Canned reply'));
    });

    app.post('/canned-replies', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.setup.write');
      const b = parse(CannedInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        'insert into canned_replies (title, body, category_id, created_by) values ($1,$2,$3,$4) returning *', [b.title, b.body, b.categoryId ?? null, a.userId])).rows[0]);
    });

    app.put('/canned-replies/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.setup.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(CannedInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from canned_replies where id = $1', [id], 'Canned reply');
        return (await c.query('update canned_replies set title = $2, body = $3, category_id = $4, updated_at = now() where id = $1 returning *',
          [id, b.title, b.body, b.categoryId ?? null])).rows[0];
      });
    });

    app.delete('/canned-replies/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.setup.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const r = await one(c, 'delete from canned_replies where id = $1 returning id, title', [id], 'Canned reply');
        return { deleted: r.id, message: `ลบ "${r.title}" แล้ว` };
      });
    });

    /* ================= knowledge base ================= */

    app.get('/articles', async (req) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.kb.read', 'helpdesk.kb.write');
      const q = parse(ListQuery.extend({ categoryId: s.uuid.optional() }), req.query);
      const editor = hasPerm(a, 'helpdesk.kb.write');
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select a.id, a.title, left(a.body, 200) as excerpt, a.category_id, c.name as category_name, a.published, a.published_at, a.views, a.updated_at
         from kb_articles a left join categories c on c.id = a.category_id
         where ($1 or a.published) and ($2::text is null or a.title ilike $2 or a.body ilike $2) and ($3::uuid is null or a.category_id = $3)
         order by a.views desc, a.updated_at desc limit $4 offset $5`,
        [editor, q.q ? `%${q.q}%` : null, q.categoryId ?? null, q.limit, q.offset])).rows);
    });

    app.get('/articles/:id', async (req) => {
      const a = auth(req);
      requireAny(a, 'helpdesk.kb.read', 'helpdesk.kb.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const art = await one(c, `select a.*, c.name as category_name from kb_articles a left join categories c on c.id = a.category_id where a.id = $1`, [id], 'Article');
        if (!art.published && !hasPerm(a, 'helpdesk.kb.write')) throw notFound('Article');
        if (art.published) await c.query('update kb_articles set views = views + 1 where id = $1', [id]);
        return art;
      });
    });

    app.post('/articles', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.kb.write');
      const b = parse(ArticleInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        if (b.categoryId) await one(c, 'select id from categories where id = $1', [b.categoryId], 'Category');
        return (await c.query(
          `insert into kb_articles (title, body, category_id, published, published_at, created_by) values ($1,$2,$3,$4, case when $4 then now() end, $5) returning *`,
          [b.title, b.body, b.categoryId ?? null, b.published, a.userId])).rows[0];
      });
    });

    app.put('/articles/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.kb.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ArticleInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from kb_articles where id = $1', [id], 'Article');
        return (await c.query(
          `update kb_articles set title = $2, body = $3, category_id = $4, published = $5,
             published_at = case when $5 then coalesce(published_at, now()) end, updated_at = now() where id = $1 returning *`,
          [id, b.title, b.body, b.categoryId ?? null, b.published])).rows[0];
      });
    });

    const publish = (path: string, published: boolean) =>
      app.post(`/articles/:id/${path}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'helpdesk.kb.write');
        const { id } = parse(IdParam, req.params);
        return k.db.tx(a.tenantId, async (c) => {
          const art = await one(c, 'select * from kb_articles where id = $1 for update', [id], 'Article');
          if (art.published === published) throw conflict(published ? 'Article is already published' : 'Article is not published');
          return (await c.query(
            `update kb_articles set published = $2, published_at = case when $2 then now() end, updated_at = now() where id = $1 returning *`, [id, published])).rows[0];
        });
      });
    publish('publish', true);
    publish('unpublish', false);

    /* ================= dashboard ================= */

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'helpdesk.ticket.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where ${ACTIVE})::int as open,
                  count(*) filter (where ${ACTIVE} and now() > t.due_at)::int as overdue,
                  count(*) filter (where ${ACTIVE} and t.assignee_id is null)::int as unassigned,
                  count(*) filter (where t.resolved_at >= date_trunc('day', now()))::int as resolved_today,
                  avg(extract(epoch from t.resolved_at - t.created_at) / 3600) filter (where t.resolved_at >= now() - interval '90 days') as avg_hours,
                  avg(t.satisfaction) filter (where t.closed_at >= now() - interval '90 days') as satisfaction
           from tickets t`)).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month,
                  (select count(*)::int from tickets where date_trunc('month', created_at) = m) as opened,
                  (select count(*)::int from tickets where date_trunc('month', resolved_at) = m) as resolved
           from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m order by m`)).rows;
        const rows = (await c.query(
          `select t.id, t.no, t.title, t.status, t.priority, t.assignee_name, t.due_at, (${ACTIVE} and now() > t.due_at) as overdue
           from tickets t where t.status <> 'closed' order by t.due_at limit 40`)).rows;
        return {
          open: n.open, overdue: n.overdue, unassigned: n.unassigned, resolvedToday: n.resolved_today,
          avgResolutionHours: n.avg_hours === null ? 0 : round(Number(n.avg_hours), 1),
          satisfactionAvg: n.satisfaction === null ? 0 : round(Number(n.satisfaction), 2),
          months, rows,
        };
      });
    });
  },
};
