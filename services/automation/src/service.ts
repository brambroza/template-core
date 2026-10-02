import { auth, badRequest, loadManifest, notFound, one, parse, requirePerm, s, z, type AuthContext, type Client, type EventHandlers, type HandlerContext, type ServiceDefinition } from '@erp/kernel';
import type { EventType } from '@erp/contracts';
import { fileURLToPath } from 'node:url';
import { EVENTS, MODULE_TH, TEMPLATES, eventInfo, type ActionSpec, type Condition } from './catalog.ts';
import { describe, describeTo, matches, parseTo, render, renderLink, resolveRecipients, sendLine, sendWebhook, webhookProblem } from './engine.ts';
import { lineRoutes, pushToUsers } from './line.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const ConditionInput = z.object({ field: z.string().min(1), op: z.enum(['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'contains']), value: z.union([z.string(), z.number()]) });
const ActionInput = z.object({
  type: z.enum(['notify', 'line', 'webhook']), target: z.string().max(500).optional(), message: z.string().max(1000).optional(),
  /** notify: 'all' (default) | 'field:<userField>[,<userField>]' | 'user:<uuid>'; line: 'field:…' | 'user:…' = personal LINE (instead of target) */
  to: z.string().max(200).optional(),
});
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
  /** recipients: 'all' | 'field:<userField>' | 'user:<uuid>' — in-app alert, or personal LINE when actionType = line and no target */
  to: z.string().max(200).optional(),
  /** shortcut for to = user:<id> (picked from identity /users) */
  toUserId: s.uuid.optional(),
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
    if (a.to !== undefined && a.to !== '') {
      if (a.type === 'webhook') throw badRequest('ระบุผู้รับ (to) ได้เฉพาะการแจ้งเตือนในแอปและ LINE ส่วนตัว — webhook ใช้ target');
      const to = parseTo(a.to);
      if (typeof to === 'string') throw badRequest(to, { fieldErrors: { to: [to] } });
      if (a.type === 'line') {
        if (to.kind === 'all') throw badRequest('LINE ถึงทุกคนไม่ได้ — ใส่ LINE group ID ใน target หรือเลือกผู้รับเป็นรายคน', { fieldErrors: { to: ['เลือกผู้รับ LINE เป็นรายคน'] } });
        if (a.target) throw badRequest('LINE ส่วนตัว (ผู้รับ) กับ LINE กลุ่ม (target) ต้องแยกเป็นคนละการกระทำ', { fieldErrors: { target: ['เว้นว่างเมื่อส่ง LINE ส่วนตัว'] } });
      }
      if (to.kind === 'fields') {
        for (const f of to.fields) {
          if (!ev.userFields?.some((x) => x.key === f)) {
            const ok = ev.userFields?.map((x) => `field:${x.key} (${x.label})`).join(', ') || 'ไม่มี — เหตุการณ์นี้ส่งถึงทุกคนเท่านั้น';
            throw badRequest(`"${f}" ไม่ใช่ช่องผู้ใช้ของเหตุการณ์ ${ev.label} (ใช้ได้: ${ok})`, { fieldErrors: { to: ['ช่องผู้รับไม่ถูกต้อง'] } });
          }
        }
      }
    }
    if (a.type === 'line' && !a.target && !a.to) throw badRequest('ต้องระบุ LINE group id (หรือเลือกผู้รับเพื่อส่ง LINE ส่วนตัว)');
    if (a.type === 'webhook') { const p = webhookProblem(a.target, env); if (p) throw badRequest(p); }
  }
}

/**
 * Actions with their effective recipients. Rules applied from a template before `to` existed keep following the
 * template's current recipients (e.g. approval-approved → the requester), so old installations stop broadcasting personal news.
 */
function effectiveActions(rule: { template_id?: string | null; actions: ActionSpec[] }): ActionSpec[] {
  const t = rule.template_id ? TEMPLATES.find((x) => x.id === rule.template_id) : undefined;
  const actions = rule.actions.map((a, i) => (a.type === 'notify' && a.to === undefined && t?.actions[i]?.type === 'notify' && t.actions[i].to ? { ...a, to: t.actions[i].to } : a));
  // personal LINE added to a template later also reaches rules applied before (only people who linked their own LINE get it)
  for (const x of t?.actions ?? []) {
    if (x.type === 'line' && x.to && !actions.some((a) => a.type === 'line' && a.to === x.to)) actions.push(x);
  }
  return actions;
}

const withSummary = (r: any) => {
  const actions = effectiveActions(r);
  const notify = actions.find((a) => a.type === 'notify');
  return { ...r, actions, summary: describe({ ...r, actions }), recipients: notify ? describeTo(notify.to, r.event_type) : null };
};

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
      for (const a of effectiveActions(rule)) {
        const text = render(a.message || ev.message, data);
        if (a.type === 'notify') {
          const link = ev.link ? renderLink(ev.link, data) : null;
          const users = resolveRecipients(a.to, data);
          if (users === null) {
            await ctx.client.query('insert into notifications (rule_id, level, title, body, link) values ($1,$2,$3,$4,$5)', [rule.id, ev.level, rule.name, text, link]);
            results.push('แจ้งในแอปแล้ว');
          } else if (!users.length) {
            // a personal alert with nobody to address (e.g. leave without a manager): never fall back to everyone
            results.push(`ไม่ได้แจ้งในแอป: เหตุการณ์ไม่มีผู้รับ (${describeTo(a.to, type)})`);
          } else {
            for (const u of users) {
              await ctx.client.query('insert into notifications (rule_id, level, title, body, link, recipient_user_id) values ($1,$2,$3,$4,$5,$6)', [rule.id, ev.level, rule.name, text, link, u]);
            }
            results.push(`แจ้งในแอปแล้ว (ถึง${describeTo(a.to, type)} ${users.length} คน)`);
          }
        } else if (a.type === 'line' && a.to) {
          // personal LINE: each recipient's linked LINE account
          const users = resolveRecipients(a.to, data) ?? [];
          const who = describeTo(a.to, type);
          if (!users.length) {
            results.push(`LINE ส่วนตัว: เหตุการณ์ไม่มีผู้รับ (${who})`);
          } else {
            const link = ev.link ? renderLink(ev.link, data) : null;
            const app = env.PUBLIC_APP_URL?.replace(/\/+$/, '');
            const r = await pushToUsers(ctx.client, users, `${rule.name}\n${text}${app && link ? `\nเปิดดู: ${app}${link}` : ''}`, env);
            const parts = [
              ...(r.sent ? [`ส่งแล้ว ${r.sent} คน`] : []),
              ...(r.notLinked ? [`ผู้รับยังไม่ได้ผูก LINE ${r.notLinked} คน`] : []),
              ...(r.failed.length ? [`ไม่สำเร็จ ${r.failed.length} คน (${r.failed[0]})`] : []),
            ];
            results.push(`LINE ส่วนตัว (ถึง${who}): ${parts.join(', ')}`);
            if (r.failed.length) failed = true;
          }
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

/**
 * The notifications a user sees ($1 = user id): addressed to them, or broadcast. `read_at` is their own read state
 * (broadcast: their notification_reads row; a broadcast read before per-user state existed stays read for everyone).
 */
const MY_NOTES = `select x.id, x.rule_id, x.level, x.title, x.body, x.link, x.created_at, x.recipient_user_id,
    (x.recipient_user_id is not null) as personal,
    case when x.recipient_user_id is null then coalesce(x.read_at, (select r.read_at from notification_reads r where r.notification_id = x.id and r.user_id = $1)) else x.read_at end as read_at
  from notifications x where x.recipient_user_id is null or x.recipient_user_id = $1`;

async function markRead(c: Client, a: AuthContext, notes: { id: string; personal: boolean; read_at: string | null }[]) {
  for (const n of notes) {
    if (n.read_at) continue;
    if (n.personal) await c.query('update notifications set read_at = now() where id = $1 and read_at is null', [n.id]);
    else await c.query('insert into notification_reads (notification_id, user_id) values ($1,$2) on conflict (notification_id, user_id) do nothing', [n.id, a.userId]);
  }
}

const handlers = Object.fromEntries(manifest.subscribes.map((t) => [t, handlerFor(t)])) as EventHandlers;

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  handlers,
  routes(app, k) {
    lineRoutes(app, k);

    app.get('/event-types', async (req) => {
      requirePerm(auth(req), 'automation.rule.read');
      return EVENTS;
    });

    app.get('/templates', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      return k.db.tx(a.tenantId, async (c) => {
        const used = new Set((await c.query('select template_id from rules where template_id is not null')).rows.map((r) => r.template_id));
        return TEMPLATES.map((t) => {
          const module = eventInfo(t.eventType)!.module;
          const notify = t.actions.find((x) => x.type === 'notify');
          return {
            ...t, module, module_label: MODULE_TH[module] ?? module, summary: describe({ event_type: t.eventType, conditions: t.conditions, actions: t.actions }),
            recipients: notify ? describeTo(notify.to, t.eventType) : null, applied: used.has(t.id),
          };
        });
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
      // personal LINE (to) needs no target; group LINE / webhook take the target given here or are left out
      const actions = t.actions.map((x) => (x.to ? x : { ...x, target: x.target || b.target })).filter((x) => x.type === 'notify' || x.to || x.target);
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
      // recipients only apply to in-app alerts; the form always sends its default 'all'
      // in-app: the chosen recipients · LINE: personal only when no group target is given · webhook: never
      const picked = b.toUserId ? `user:${b.toUserId}` : b.to && b.to !== 'all' ? b.to : undefined;
      const to = b.actionType === 'notify' || (b.actionType === 'line' && !b.target) ? picked : undefined;
      const rule = { name: b.name, eventType: b.eventType, conditions, actions: [{ type: b.actionType, target: b.target, message: b.message, ...(to ? { to } : {}) }] as ActionSpec[] };
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
        const messages = effectiveActions(r).map((x) => ({ type: x.type, text: render(x.message || ev.message, data), ...(x.type === 'notify' || x.to ? { to: describeTo(x.to, r.event_type) } : {}) }));
        const preview = matched ? `ตรงเงื่อนไข — จะส่ง: ${messages.map((m) => m.text).join(' / ')}` : 'ข้อมูลตัวอย่างไม่ตรงเงื่อนไข — กฎนี้จะไม่ทำงาน';
        return { matched, messages, preview };
      });
    });

    app.get('/runs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from runs order by created_at desc limit 100')).rows);
    });

    /** Mine + broadcast, with my own read state. */
    app.get('/notifications', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.notify.read');
      const q = parse(z.object({ unread: z.enum(['true', 'false', '1', '0', '']).optional().transform((v) => v === 'true' || v === '1') }), req.query);
      return k.db.tx(a.tenantId, async (c) => {
        const items = (await c.query(
          `select * from (${MY_NOTES}) n ${q.unread ? 'where n.read_at is null' : ''} order by n.created_at desc limit 30`, [a.userId])).rows;
        const unread = (await c.query(`select count(*)::int as n from (${MY_NOTES}) n where n.read_at is null`, [a.userId])).rows[0].n;
        return { unread, items };
      });
    });

    app.post('/notifications/:id/read', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.notify.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const n = await one(c, `select * from (${MY_NOTES}) n where n.id = $2`, [a.userId, id], 'Notification');
        await markRead(c, a, [n]);
        return one(c, `select * from (${MY_NOTES}) n where n.id = $2`, [a.userId, id], 'Notification');
      });
    });

    app.post('/notifications/read-all', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.notify.read');
      return k.db.tx(a.tenantId, async (c) => {
        const mine = (await c.query('update notifications set read_at = now() where recipient_user_id = $1 and read_at is null', [a.userId])).rowCount ?? 0;
        const shared = (await c.query(
          `insert into notification_reads (notification_id, user_id)
           select x.id, $1 from notifications x where x.recipient_user_id is null and x.read_at is null
           on conflict (notification_id, user_id) do nothing`, [a.userId])).rowCount ?? 0;
        return { updated: mine + shared };
      });
    });

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'automation.rule.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select (select count(*)::int from rules where enabled) as active,
                  (select count(*)::int from runs where status = 'done' and created_at > now() - interval '1 day') as fired_today,
                  (select count(*)::int from runs where status = 'failed' and created_at > now() - interval '1 day') as failed_today,
                  (select count(*)::int from (${MY_NOTES}) n where n.read_at is null) as unread`, [a.userId])).rows[0];
        return { activeRules: n.active, firedToday: n.fired_today, failedToday: n.failed_today, unread: n.unread };
      });
    });
  },
};
