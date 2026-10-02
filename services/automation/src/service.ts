import { auth, badRequest, loadManifest, notFound, one, parse, requirePerm, s, z, type Client, type EventHandlers, type HandlerContext, type ServiceDefinition } from '@erp/kernel';
import type { EventType } from '@erp/contracts';
import { fileURLToPath } from 'node:url';
import { EVENTS, TEMPLATES, eventInfo, type ActionSpec, type Condition } from './catalog.ts';
import { describe, matches, render, renderLink, sendLine, sendWebhook, webhookProblem } from './engine.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const ConditionInput = z.object({ field: z.string().min(1), op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains']), value: z.union([z.string(), z.number()]) });
const ActionInput = z.object({ type: z.enum(['notify', 'line', 'webhook']), target: z.string().max(500).optional(), message: z.string().max(1000).optional() });
const RuleInput = z.object({
  name: s.name,
  eventType: z.string(),
  conditions: z.array(ConditionInput).max(10).default([]),
  actions: z.array(ActionInput).min(1).max(5),
  enabled: z.boolean().default(true),
});
/** One-condition, one-action rule as the generic form sends it. */
const SimpleRuleInput = z.object({
  name: s.name,
  eventType: z.string(),
  conditionField: z.string().optional(),
  conditionOp: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains']).optional(),
  conditionValue: z.union([z.string(), z.number()]).optional(),
  actionType: z.enum(['notify', 'line', 'webhook']).default('notify'),
  target: z.string().max(500).optional(),
  message: z.string().max(1000).optional(),
});
const IdParam = z.object({ id: s.uuid });

function validateRule(r: { eventType: string; conditions: Condition[]; actions: ActionSpec[] }, env: NodeJS.ProcessEnv) {
  const ev = eventInfo(r.eventType);
  if (!ev) throw badRequest(`ไม่รู้จักเหตุการณ์ ${r.eventType}`);
  for (const c of r.conditions) {
    const f = ev.fields.find((x) => x.key === c.field);
    if (!f) throw badRequest(`"${c.field}" ไม่ใช่ข้อมูลของเหตุการณ์ ${ev.label} (ใช้ได้: ${ev.fields.map((x) => x.key).join(', ')})`);
    if (['gt', 'gte', 'lt', 'lte'].includes(c.op) && !f.numeric) throw badRequest(`${f.label} ไม่ใช่ตัวเลข ใช้ = หรือ มีคำว่า แทน`);
    if (f.numeric && ['gt', 'gte', 'lt', 'lte'].includes(c.op)) c.value = Number(c.value);
  }
  for (const a of r.actions) {
    if (a.type === 'line' && !a.target) throw badRequest('ต้องระบุ LINE user id หรือ group id');
    if (a.type === 'webhook') { const p = webhookProblem(a.target, env); if (p) throw badRequest(p); }
  }
}

const withSummary = (r: any) => ({ ...r, summary: describe(r) });

async function createRule(c: Client, body: { name: string; eventType: string; conditions: Condition[]; actions: ActionSpec[]; enabled?: boolean }, userId: string, templateId?: string) {
  const row = (await c.query(
    `insert into rules (name, event_type, conditions, actions, enabled, template_id, created_by) values ($1,$2,$3,$4,$5,$6,$7) returning *`,
    [body.name, body.eventType, JSON.stringify(body.conditions), JSON.stringify(body.actions), body.enabled ?? true, templateId ?? null, userId])).rows[0];
  return withSummary(row);
}

/** Runs every enabled rule for one event. Never throws: failures are recorded as runs. */
function handlerFor(type: EventType) {
  return async (data: unknown, ctx: HandlerContext) => {
    const env = ctx.env;
    const ev = eventInfo(type)!;
    const rules = (await ctx.client.query('select * from rules where enabled and event_type = $1', [type])).rows;
    for (const rule of rules) {
      if (!matches(rule.conditions, data)) continue;
      const results: string[] = [];
      let failed = false;
      for (const a of rule.actions as ActionSpec[]) {
        const text = render(a.message || ev.message, data);
        if (a.type === 'notify') {
          await ctx.client.query('insert into notifications (rule_id, level, title, body, link) values ($1,$2,$3,$4,$5)',
            [rule.id, ev.level, rule.name, text, ev.link ? renderLink(ev.link, data) : null]);
          results.push('แจ้งในแอปแล้ว');
        } else {
          const d = a.type === 'line' ? await sendLine(a.target, `${rule.name}\n${text}`, env) : await sendWebhook(a.target, { rule: rule.name, event: type, eventId: ctx.event.id, message: text, data }, env);
          results.push(`${a.type === 'line' ? 'LINE' : 'webhook'}: ${d.ok ? 'ส่งแล้ว' : `ไม่สำเร็จ (${d.detail})`}`);
          if (!d.ok) failed = true;
        }
      }
      await ctx.client.query('insert into runs (rule_id, rule_name, event_type, event_id, status, detail) values ($1,$2,$3,$4,$5,$6)',
        [rule.id, rule.name, type, ctx.event.id, failed ? 'failed' : 'done', results.join(', ')]);
      await ctx.client.query('update rules set fire_count = fire_count + 1, last_fired_at = now() where id = $1', [rule.id]);
    }
  };
}

const handlers = Object.fromEntries(manifest.subscribes.map((t) => [t, handlerFor(t)])) as EventHandlers;

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  handlers,
  routes(app, k) {

    app.get('/event-types', async (req) => {
      requirePerm(auth(req), 'automation.rule.read');
      return EVENTS;
    });

    app.get('/templates', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      return k.db.tx(a.tenantId, async (c) => {
        const used = new Set((await c.query('select template_id from rules where template_id is not null')).rows.map((r) => r.template_id));
        return TEMPLATES.map((t) => ({ ...t, module: eventInfo(t.eventType)!.module, summary: describe({ event_type: t.eventType, conditions: t.conditions, actions: t.actions }), applied: used.has(t.id) }));
      });
    });

    /** One click: turn a template into an active rule. LINE/webhook actions without a target are left out. */
    app.post('/templates/:id/apply', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.write');
      const { id } = parse(z.object({ id: z.string() }), req.params);
      const b = parse(z.object({ target: z.string().max(500).optional() }), req.body ?? {});
      const t = TEMPLATES.find((x) => x.id === id);
      if (!t) throw notFound('Template');
      const actions = t.actions.map((x) => ({ ...x, target: x.target || b.target })).filter((x) => x.type === 'notify' || x.target);
      validateRule({ eventType: t.eventType, conditions: structuredClone(t.conditions), actions }, k.env);
      reply.code(201);
      return k.db.tx(a.tenantId, (c) => createRule(c, { name: t.name, eventType: t.eventType, conditions: t.conditions, actions }, a.userId, t.id));
    });

    app.get('/rules', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from rules order by created_at desc')).rows.map(withSummary));
    });

    app.post('/rules', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.write');
      const b = parse(RuleInput, req.body);
      validateRule(b, k.env);
      reply.code(201);
      return k.db.tx(a.tenantId, (c) => createRule(c, b, a.userId));
    });

    app.post('/rules/simple', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.write');
      const b = parse(SimpleRuleInput, req.body);
      const conditions: Condition[] = b.conditionField && b.conditionOp && b.conditionValue !== undefined && b.conditionValue !== ''
        ? [{ field: b.conditionField, op: b.conditionOp, value: b.conditionValue }] : [];
      const rule = { name: b.name, eventType: b.eventType, conditions, actions: [{ type: b.actionType, target: b.target, message: b.message }] as ActionSpec[] };
      validateRule(rule, k.env);
      reply.code(201);
      return k.db.tx(a.tenantId, (c) => createRule(c, rule, a.userId));
    });

    app.get('/rules/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const r = withSummary(await one(c, 'select * from rules where id = $1', [id], 'Rule'));
        r.runs = (await c.query('select * from runs where rule_id = $1 order by created_at desc limit 20', [id])).rows;
        r.event_label = eventInfo(r.event_type)?.label;
        return r;
      });
    });

    app.post('/rules/:id/enable', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => withSummary(await one(c, 'update rules set enabled = true where id = $1 returning *', [id], 'Rule')));
    });

    app.post('/rules/:id/disable', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => withSummary(await one(c, 'update rules set enabled = false where id = $1 returning *', [id], 'Rule')));
    });

    app.delete('/rules/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => { await one(c, 'delete from rules where id = $1 returning id', [id], 'Rule'); return { deleted: id }; });
    });

    /** Dry run with example data: does it match, and what would the message say? No side effects. */
    app.post('/rules/:id/test', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ data: z.record(z.unknown()).optional() }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = await one(c, 'select * from rules where id = $1', [id], 'Rule');
        const ev = eventInfo(r.event_type)!;
        const data = b.data ?? Object.fromEntries(ev.fields.map((f) => [f.key, f.numeric ? 999999 : `(${f.label})`]));
        const matched = matches(r.conditions, data);
        const messages = (r.actions as ActionSpec[]).map((x) => ({ type: x.type, text: render(x.message || ev.message, data) }));
        const preview = matched ? `ตรงเงื่อนไข — จะส่ง: ${messages.map((m) => m.text).join(' / ')}` : 'ข้อมูลตัวอย่างไม่ตรงเงื่อนไข — กฎนี้จะไม่ทำงาน';
        return { matched, messages, preview };
      });
    });

    app.get('/runs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from runs order by created_at desc limit 100')).rows);
    });

    app.get('/notifications', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.notify.read');
      const q = parse(z.object({ unread: z.coerce.boolean().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const items = (await c.query(`select * from notifications ${q.unread ? 'where read_at is null' : ''} order by created_at desc limit 30`)).rows;
        const unread = (await c.query('select count(*)::int as n from notifications where read_at is null')).rows[0].n;
        return { unread, items };
      });
    });

    app.post('/notifications/:id/read', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.notify.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'update notifications set read_at = coalesce(read_at, now()) where id = $1 returning *', [id], 'Notification'));
    });

    app.post('/notifications/read-all', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.notify.read');
      return k.db.tx(a.tenantId, async (c) => ({ updated: (await c.query('update notifications set read_at = now() where read_at is null')).rowCount }));
    });

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select (select count(*)::int from rules where enabled) as active,
                  (select count(*)::int from runs where status = 'done' and created_at > now() - interval '1 day') as fired_today,
                  (select count(*)::int from runs where status = 'failed' and created_at > now() - interval '1 day') as failed_today,
                  (select count(*)::int from notifications where read_at is null) as unread`)).rows[0];
        return { activeRules: n.active, firedToday: n.fired_today, failedToday: n.failed_today, unread: n.unread };
      });
    });
  },
};
