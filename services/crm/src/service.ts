import { auth, conflict, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type Client, type ServiceDefinition } from '@erp/kernel';
import { bahtText, documentTotals, round } from '@erp/thai';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

/* ---------------- input schemas ---------------- */

const text = (max = 200) => z.string().trim().max(max).optional();
const flag = z.enum(['1', 'true', '0', 'false']).optional().transform((v) => v === '1' || v === 'true');
const ListQuery = s.listQuery.extend({ limit: z.coerce.number().int().min(1).max(500).default(200) });
const IdParam = z.object({ id: s.uuid });

const SOURCES = ['website', 'line', 'phone', 'expo', 'referral', 'other'] as const;
const OPEN_LEAD = ['new', 'contacted', 'qualified'];
const OPEN_STAGES = ['prospect', 'proposal', 'negotiation'];
/** probability suggested when an opportunity enters a stage (never lowers a higher manual value) */
const STAGE_PROBABILITY: Record<string, number> = { prospect: 10, proposal: 40, negotiation: 70 };

const Owner = { ownerId: s.uuid.nullable().optional(), ownerName: text() };

const LeadInput = z.object({
  company: s.name,
  contactName: text(),
  phone: text(50),
  email: z.string().trim().email().max(200).optional().or(z.literal('')),
  lineId: text(100),
  source: z.enum(SOURCES).default('other'),
  interest: text(500),
  note: text(2000),
  ...Owner,
});

const ConvertInput = z.object({
  name: text(),
  partnerId: s.uuid.nullable().optional(),
  customerName: text(),
  value: s.money.default(0),
  probability: z.number().int().min(0).max(100).optional(),
  expectedClose: s.isoDate.optional(),
});

const OpportunityInput = z.object({
  name: s.name,
  partnerId: s.uuid.nullable().optional(),
  customerName: s.name,
  value: s.money.default(0),
  probability: z.number().int().min(0).max(100).optional(),
  expectedClose: s.isoDate.optional(),
  note: text(2000),
  ...Owner,
});

const Reason = z.object({ reason: z.string().trim().min(1).max(500) });

const ActivityBase = z.object({
  type: z.enum(['call', 'meeting', 'email', 'visit', 'task']),
  subject: s.name,
  dueAt: z.string().datetime({ offset: true }).or(s.isoDate).optional(),
  note: text(2000),
  done: z.boolean().default(false),
  ...Owner,
});
const ActivityInput = ActivityBase.extend({ leadId: s.uuid.optional(), opportunityId: s.uuid.optional() })
  .refine((v) => v.leadId || v.opportunityId, { message: 'leadId or opportunityId is required', path: ['leadId'] });

const QuoteLine = z.object({
  itemId: s.uuid.nullable().optional(),
  itemCode: text(50),
  itemName: text(),
  description: text(1000),
  qty: s.positiveQty,
  unitPrice: s.money,
  discountPct: z.number().min(0).max(100).default(0),
}).refine((l) => l.itemId || l.description || l.itemName, { message: 'item or description is required', path: ['description'] });

const QuoteInput = z.object({
  partnerId: s.uuid.nullable().optional(),
  customerName: s.name,
  customerTaxId: text(20),
  customerBranch: text(50),
  customerAddress: text(1000),
  contactName: text(),
  opportunityId: s.uuid.nullable().optional(),
  issueDate: s.isoDate.optional(),
  validUntil: s.isoDate.optional(),
  vatMode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  note: text(2000),
  lines: z.array(QuoteLine).min(1),
});

/* ---------------- helpers ---------------- */

/** Line amounts after discount, document totals via @erp/thai (VAT exclusive/inclusive). */
function quoteTotals(lines: z.infer<typeof QuoteLine>[], vatMode: 'exclusive' | 'inclusive') {
  const t = documentTotals(lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice * (1 - l.discountPct / 100) })), vatMode);
  const subtotal = round(lines.reduce((sum, l) => sum + round(l.qty * l.unitPrice), 0));
  const afterDiscount = round(t.amounts.reduce((a, b) => a + b, 0));
  return { ...t, subtotal, discount: round(subtotal - afterDiscount) };
}

/** Thai labels for codes the shared renderer has no translation for. */
const TYPE_TH = `case a.type when 'call' then 'โทร' when 'meeting' then 'ประชุม' when 'email' then 'อีเมล' when 'visit' then 'เยี่ยมลูกค้า' else 'งานติดตาม' end`;
const SOURCE_TH = `case source when 'website' then 'เว็บไซต์' when 'line' then 'LINE' when 'phone' then 'โทรเข้า' when 'expo' then 'งานแสดงสินค้า' when 'referral' then 'ลูกค้าแนะนำ' else 'อื่นๆ' end`;

const ACTIVITY_SELECT = `select a.*, ${TYPE_TH} as type_label, coalesce(l.no, o.no) as related_no, coalesce(l.company, o.name) as related_name,
  (not a.done and a.due_at is not null and a.due_at < now()) as overdue
  from activities a left join leads l on l.id = a.lead_id left join opportunities o on o.id = a.opportunity_id`;

const OPP_SELECT = `select o.*, round(o.value * o.probability / 100.0, 2) as weighted_value from opportunities o`;

async function loadLead(c: Client, id: string, lock = false) {
  const lead = await one(c, `select *, ${SOURCE_TH} as source_label from leads where id = $1 ${lock ? 'for update' : ''}`, [id], 'Lead');
  lead.activities = (await c.query(`${ACTIVITY_SELECT} where a.lead_id = $1 order by a.done, a.due_at nulls last, a.created_at desc`, [id])).rows;
  return lead;
}

async function loadOpportunity(c: Client, id: string, lock = false) {
  if (lock) await one(c, 'select id from opportunities where id = $1 for update', [id], 'Opportunity');
  const o = await one(c, `${OPP_SELECT} where o.id = $1`, [id], 'Opportunity');
  o.activities = (await c.query(`${ACTIVITY_SELECT} where a.opportunity_id = $1 order by a.done, a.due_at nulls last, a.created_at desc`, [id])).rows;
  o.quotations = (await c.query('select id, no, issue_date, valid_until, status, gross from quotations where opportunity_id = $1 order by created_at desc', [id])).rows;
  return o;
}

async function loadQuote(c: Client, id: string, lock = false) {
  const q = await one(c, `select q.*, o.no as opportunity_no, o.name as opportunity_name, r.no as revision_of_no
    from quotations q left join opportunities o on o.id = q.opportunity_id left join quotations r on r.id = q.revision_of
    where q.id = $1 ${lock ? 'for update of q' : ''}`, [id], 'Quotation');
  q.lines = (await c.query('select * from quotation_lines where quotation_id = $1 order by line_no', [id])).rows;
  q.gross_text = bahtText(Number(q.gross));
  return q;
}

async function insertActivity(c: Client, userId: string, b: z.infer<typeof ActivityBase>, leadId: string | null, opportunityId: string | null) {
  const row = (await c.query(
    `insert into activities (type, subject, due_at, note, done, done_at, lead_id, opportunity_id, owner_id, owner_name, created_by)
     values ($1,$2,$3,$4,$5, case when $5 then now() end, $6,$7,$8,$9,$10) returning id`,
    [b.type, b.subject, b.dueAt ?? null, b.note ?? null, b.done, leadId, opportunityId, b.ownerId ?? userId, b.ownerName ?? null, userId],
  )).rows[0];
  return one(c, `${ACTIVITY_SELECT} where a.id = $1`, [row.id], 'Activity');
}

async function insertLines(c: Client, quoteId: string, lines: z.infer<typeof QuoteLine>[], amounts: number[]) {
  for (const [i, l] of lines.entries()) {
    await c.query(
      `insert into quotation_lines (quotation_id, line_no, item_id, item_code, item_name, description, qty, unit_price, discount_pct, amount)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [quoteId, i + 1, l.itemId ?? null, l.itemCode ?? null, l.itemName ?? null, l.description ?? null, l.qty, l.unitPrice, l.discountPct, amounts[i]],
    );
  }
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /* ================= leads ================= */

    app.post('/leads', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const b = parse(LeadInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'LD');
        const row = (await c.query(
          `insert into leads (no, company, contact_name, phone, email, line_id, source, interest, note, owner_id, owner_name, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [no, b.company, b.contactName ?? null, b.phone ?? null, b.email || null, b.lineId ?? null, b.source, b.interest ?? null, b.note ?? null, b.ownerId ?? a.userId, b.ownerName ?? null, a.userId],
        )).rows[0];
        return loadLead(c, row.id);
      });
    });

    app.get('/leads', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.read');
      const q = parse(ListQuery.extend({ status: z.string().optional(), source: z.string().optional(), open: flag, mine: flag }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select *, ${SOURCE_TH} as source_label from leads
         where ($1::text is null or status = $1) and ($2::text is null or source = $2)
           and ($3::text is null or no ilike $3 or company ilike $3 or contact_name ilike $3 or phone ilike $3 or interest ilike $3)
           and (not $4 or status in ('new', 'contacted', 'qualified')) and (not $5 or owner_id = $6)
         order by created_at desc limit $7 offset $8`,
        [q.status ?? null, q.source ?? null, q.q ? `%${q.q}%` : null, q.open, q.mine, a.userId, q.limit, q.offset])).rows);
    });

    app.get('/leads/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadLead(c, id));
    });

    app.put('/leads/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(LeadInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const lead = await loadLead(c, id, true);
        if (!OPEN_LEAD.includes(lead.status)) throw conflict(`Cannot edit a ${lead.status} lead`);
        await c.query(
          `update leads set company = $2, contact_name = $3, phone = $4, email = $5, line_id = $6, source = $7, interest = $8, note = $9,
             owner_id = coalesce($10, owner_id), owner_name = coalesce($11, owner_name), updated_at = now() where id = $1`,
          [id, b.company, b.contactName ?? null, b.phone ?? null, b.email || null, b.lineId ?? null, b.source, b.interest ?? null, b.note ?? null, b.ownerId ?? null, b.ownerName ?? null],
        );
        return loadLead(c, id);
      });
    });

    const leadStep = (path: string, to: string, from: string[]) =>
      app.post(`/leads/:id/${path}`, async (req) => {
        const a = auth(req);
        requirePerm(a, 'crm.lead.write');
        const { id } = parse(IdParam, req.params);
        return k.db.tx(a.tenantId, async (c) => {
          const lead = await loadLead(c, id, true);
          if (!from.includes(lead.status)) throw conflict(`Cannot move a ${lead.status} lead to ${to}`);
          await c.query('update leads set status = $2, updated_at = now() where id = $1', [id, to]);
          return loadLead(c, id);
        });
      });
    leadStep('contact', 'contacted', ['new']);
    leadStep('qualify', 'qualified', ['new', 'contacted']);

    app.post('/leads/:id/lose', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(Reason, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const lead = await loadLead(c, id, true);
        if (!OPEN_LEAD.includes(lead.status)) throw conflict(`Cannot close a ${lead.status} lead`);
        await c.query(`update leads set status = 'lost', lost_reason = $2, updated_at = now() where id = $1`, [id, b.reason]);
        return loadLead(c, id);
      });
    });

    /** Turns a lead into an opportunity (optionally linked to a master-data customer) and returns the opportunity. */
    app.post('/leads/:id/convert', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ConvertInput, req.body ?? {});
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const lead = await loadLead(c, id, true);
        if (!OPEN_LEAD.includes(lead.status)) throw conflict(`Cannot convert a ${lead.status} lead`);
        const no = await nextDocNo(c, 'OP');
        const opp = (await c.query(
          `insert into opportunities (no, name, lead_id, partner_id, customer_name, value, probability, expected_close, owner_id, owner_name, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
          [no, b.name || (lead.interest ? `${lead.interest} — ${lead.company}` : lead.company).slice(0, 200), id, b.partnerId ?? null, b.customerName || lead.company,
            b.value, b.probability ?? STAGE_PROBABILITY.prospect, b.expectedClose ?? null, lead.owner_id, lead.owner_name, lead.note, a.userId],
        )).rows[0];
        await c.query(`update leads set status = 'converted', opportunity_id = $2, converted_at = now(), updated_at = now() where id = $1`, [id, opp.id]);
        // open follow-ups move with the deal
        await c.query('update activities set opportunity_id = $2 where lead_id = $1 and not done', [id, opp.id]);
        return loadOpportunity(c, opp.id);
      });
    });

    app.post('/leads/:id/activities', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.activity.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ActivityBase, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from leads where id = $1', [id], 'Lead');
        await insertActivity(c, a.userId, b, id, null);
        return loadLead(c, id);
      });
    });

    /* ================= opportunities ================= */

    app.post('/opportunities', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const b = parse(OpportunityInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'OP');
        const row = (await c.query(
          `insert into opportunities (no, name, partner_id, customer_name, value, probability, expected_close, owner_id, owner_name, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
          [no, b.name, b.partnerId ?? null, b.customerName, b.value, b.probability ?? STAGE_PROBABILITY.prospect, b.expectedClose ?? null, b.ownerId ?? a.userId, b.ownerName ?? null, b.note ?? null, a.userId],
        )).rows[0];
        return loadOpportunity(c, row.id);
      });
    });

    app.get('/opportunities', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.read');
      const q = parse(ListQuery.extend({ stage: z.string().optional(), open: flag, mine: flag, partnerId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${OPP_SELECT}
         where ($1::text is null or o.stage = $1) and ($2::text is null or o.no ilike $2 or o.name ilike $2 or o.customer_name ilike $2)
           and (not $3 or o.stage in ('prospect', 'proposal', 'negotiation')) and (not $4 or o.owner_id = $5)
           and ($6::uuid is null or o.partner_id = $6)
         order by o.expected_close nulls last, o.created_at desc limit $7 offset $8`,
        [q.stage ?? null, q.q ? `%${q.q}%` : null, q.open, q.mine, a.userId, q.partnerId ?? null, q.limit, q.offset])).rows);
    });

    app.get('/opportunities/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadOpportunity(c, id));
    });

    app.put('/opportunities/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(OpportunityInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOpportunity(c, id, true);
        if (!OPEN_STAGES.includes(o.stage)) throw conflict(`Cannot edit a ${o.stage} opportunity`);
        await c.query(
          `update opportunities set name = $2, partner_id = $3, customer_name = $4, value = $5, probability = coalesce($6, probability), expected_close = $7,
             note = $8, owner_id = coalesce($9, owner_id), owner_name = coalesce($10, owner_name), updated_at = now() where id = $1`,
          [id, b.name, b.partnerId ?? null, b.customerName, b.value, b.probability ?? null, b.expectedClose ?? null, b.note ?? null, b.ownerId ?? null, b.ownerName ?? null],
        );
        return loadOpportunity(c, id);
      });
    });

    /** prospect → proposal → negotiation */
    app.post('/opportunities/:id/advance', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOpportunity(c, id, true);
        const next = { prospect: 'proposal', proposal: 'negotiation' }[o.stage as string];
        if (!next) throw conflict(`Cannot advance a ${o.stage} opportunity`);
        await c.query('update opportunities set stage = $2, probability = greatest(probability, $3), updated_at = now() where id = $1', [id, next, STAGE_PROBABILITY[next]]);
        return loadOpportunity(c, id);
      });
    });

    app.post('/opportunities/:id/win', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOpportunity(c, id, true);
        if (!OPEN_STAGES.includes(o.stage)) throw conflict(`Cannot win a ${o.stage} opportunity`);
        await c.query(`update opportunities set stage = 'won', probability = 100, won_at = now(), closed_at = now(), updated_at = now() where id = $1`, [id]);
        return loadOpportunity(c, id);
      });
    });

    app.post('/opportunities/:id/lose', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(Reason, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOpportunity(c, id, true);
        if (!OPEN_STAGES.includes(o.stage)) throw conflict(`Cannot lose a ${o.stage} opportunity`);
        await c.query(`update opportunities set stage = 'lost', probability = 0, lost_reason = $2, closed_at = now(), updated_at = now() where id = $1`, [id, b.reason]);
        return loadOpportunity(c, id);
      });
    });

    app.post('/opportunities/:id/activities', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.activity.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(ActivityBase, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from opportunities where id = $1', [id], 'Opportunity');
        await insertActivity(c, a.userId, b, null, id);
        return loadOpportunity(c, id);
      });
    });

    /* ================= activities ================= */

    app.post('/activities', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.activity.write');
      const b = parse(ActivityInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        if (b.leadId) await one(c, 'select id from leads where id = $1', [b.leadId], 'Lead');
        if (b.opportunityId) await one(c, 'select id from opportunities where id = $1', [b.opportunityId], 'Opportunity');
        return insertActivity(c, a.userId, b, b.leadId ?? null, b.opportunityId ?? null);
      });
    });

    app.get('/activities', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.read');
      const q = parse(ListQuery.extend({
        type: z.string().optional(), mine: flag, open: flag, overdue: flag, leadId: s.uuid.optional(), opportunityId: s.uuid.optional(),
      }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${ACTIVITY_SELECT}
         where ($1::text is null or a.type = $1) and (not $2 or a.owner_id = $3) and (not $4 or not a.done)
           and (not $5 or (not a.done and a.due_at < now())) and ($6::uuid is null or a.lead_id = $6) and ($7::uuid is null or a.opportunity_id = $7)
           and ($8::text is null or a.subject ilike $8 or l.company ilike $8 or o.name ilike $8 or l.no ilike $8 or o.no ilike $8)
         order by a.done, a.due_at nulls last, a.created_at desc limit $9 offset $10`,
        [q.type ?? null, q.mine, a.userId, q.open, q.overdue, q.leadId ?? null, q.opportunityId ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    /** My open follow-ups, overdue first — the salesperson's to-do list (web + mobile). */
    app.get('/activities/mine', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `${ACTIVITY_SELECT} where a.owner_id = $1 and not a.done order by a.due_at nulls last, a.created_at limit 200`, [a.userId])).rows);
    });

    app.post('/activities/:id/done', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.activity.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ note: text(2000) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const act = await one(c, 'select * from activities where id = $1 for update', [id], 'Activity');
        if (act.done) throw conflict('Activity is already done');
        await c.query('update activities set done = true, done_at = now(), note = coalesce($2, note) where id = $1', [id, b.note ?? null]);
        return one(c, `${ACTIVITY_SELECT} where a.id = $1`, [id], 'Activity');
      });
    });

    /* ================= quotations ================= */

    app.post('/quotations', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.write');
      const b = parse(QuoteInput, req.body);
      const t = quoteTotals(b.lines, b.vatMode);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        if (b.opportunityId) await one(c, 'select id from opportunities where id = $1', [b.opportunityId], 'Opportunity');
        const no = await nextDocNo(c, 'QT', b.issueDate ? new Date(b.issueDate) : new Date());
        const q = (await c.query(
          `insert into quotations (no, base_no, opportunity_id, partner_id, customer_name, customer_tax_id, customer_branch, customer_address, contact_name,
             issue_date, valid_until, vat_mode, subtotal, discount, net, vat, gross, note, created_by)
           values ($1,$1,$2,$3,$4,$5,$6,$7,$8, coalesce($9::date, current_date), coalesce($10::date, coalesce($9::date, current_date) + 30), $11,$12,$13,$14,$15,$16,$17,$18) returning id`,
          [no, b.opportunityId ?? null, b.partnerId ?? null, b.customerName, b.customerTaxId ?? null, b.customerBranch ?? null, b.customerAddress ?? null, b.contactName ?? null,
            b.issueDate ?? null, b.validUntil ?? null, b.vatMode, t.subtotal, t.discount, t.net, t.vat, t.gross, b.note ?? null, a.userId],
        )).rows[0];
        await insertLines(c, q.id, b.lines, t.amounts);
        return loadQuote(c, q.id);
      });
    });

    app.get('/quotations', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.read');
      const q = parse(ListQuery.extend({ status: z.string().optional(), opportunityId: s.uuid.optional(), partnerId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select q.*, (q.status = 'sent' and q.valid_until < current_date) as past_validity from quotations q
         where ($1::text is null or q.status = $1) and ($2::text is null or q.no ilike $2 or q.customer_name ilike $2)
           and ($3::uuid is null or q.opportunity_id = $3) and ($4::uuid is null or q.partner_id = $4)
         order by q.created_at desc limit $5 offset $6`,
        [q.status ?? null, q.q ? `%${q.q}%` : null, q.opportunityId ?? null, q.partnerId ?? null, q.limit, q.offset])).rows);
    });

    app.get('/quotations/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadQuote(c, id));
    });

    app.put('/quotations/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(QuoteInput, req.body);
      const t = quoteTotals(b.lines, b.vatMode);
      return k.db.tx(a.tenantId, async (c) => {
        const q = await loadQuote(c, id, true);
        if (q.status !== 'draft') throw conflict(`Cannot edit a ${q.status} quotation`);
        if (b.opportunityId) await one(c, 'select id from opportunities where id = $1', [b.opportunityId], 'Opportunity');
        await c.query(
          `update quotations set opportunity_id = $2, partner_id = $3, customer_name = $4, customer_tax_id = $5, customer_branch = $6, customer_address = $7,
             contact_name = $8, issue_date = coalesce($9::date, issue_date), valid_until = coalesce($10::date, valid_until), vat_mode = $11,
             subtotal = $12, discount = $13, net = $14, vat = $15, gross = $16, note = $17, updated_at = now() where id = $1`,
          [id, b.opportunityId ?? null, b.partnerId ?? null, b.customerName, b.customerTaxId ?? null, b.customerBranch ?? null, b.customerAddress ?? null,
            b.contactName ?? null, b.issueDate ?? null, b.validUntil ?? null, b.vatMode, t.subtotal, t.discount, t.net, t.vat, t.gross, b.note ?? null],
        );
        await c.query('delete from quotation_lines where quotation_id = $1', [id]);
        await insertLines(c, id, b.lines, t.amounts);
        return loadQuote(c, id);
      });
    });

    /** draft → sent; a linked opportunity still in prospect moves to proposal. */
    app.post('/quotations/:id/send', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const q = await loadQuote(c, id, true);
        if (q.status !== 'draft') throw conflict(`Cannot send a ${q.status} quotation`);
        await c.query(`update quotations set status = 'sent', sent_at = now(), updated_at = now() where id = $1`, [id]);
        if (q.opportunity_id) {
          await c.query(`update opportunities set stage = 'proposal', probability = greatest(probability, $2), updated_at = now() where id = $1 and stage = 'prospect'`,
            [q.opportunity_id, STAGE_PROBABILITY.proposal]);
        }
        return loadQuote(c, id);
      });
    });

    /** sent → accepted; the linked opportunity is won at the quotation's net value. */
    app.post('/quotations/:id/accept', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.decide');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const q = await loadQuote(c, id, true);
        if (q.status !== 'sent') throw conflict(`Cannot accept a ${q.status} quotation`);
        await c.query(`update quotations set status = 'accepted', decided_at = now(), updated_at = now() where id = $1`, [id]);
        if (q.opportunity_id) {
          await c.query(
            `update opportunities set stage = 'won', probability = 100, value = $2, won_at = now(), closed_at = now(), lost_reason = null, updated_at = now()
             where id = $1 and stage <> 'won'`, [q.opportunity_id, q.net]);
        }
        return loadQuote(c, id);
      });
    });

    app.post('/quotations/:id/reject', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.decide');
      const { id } = parse(IdParam, req.params);
      const b = parse(Reason, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const q = await loadQuote(c, id, true);
        if (q.status !== 'sent') throw conflict(`Cannot reject a ${q.status} quotation`);
        await c.query(`update quotations set status = 'rejected', reject_reason = $2, decided_at = now(), updated_at = now() where id = $1`, [id, b.reason]);
        return loadQuote(c, id);
      });
    });

    app.post('/quotations/:id/expire', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const q = await loadQuote(c, id, true);
        if (!['draft', 'sent'].includes(q.status)) throw conflict(`Cannot expire a ${q.status} quotation`);
        await c.query(`update quotations set status = 'expired', decided_at = now(), updated_at = now() where id = $1`, [id]);
        return loadQuote(c, id);
      });
    });

    /** Expire every sent quotation whose validity ended before `asOf` (default today) — safe to run daily. */
    app.post('/quotations/expire-due', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.write');
      const b = parse(z.object({ asOf: s.isoDate.optional() }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = await c.query(
          `update quotations set status = 'expired', decided_at = now(), updated_at = now()
           where status = 'sent' and valid_until < coalesce($1::date, current_date) returning id, no`, [b.asOf ?? null]);
        return { expired: r.rows, message: r.rowCount ? `หมดอายุ ${r.rowCount} ใบ: ${r.rows.map((x) => x.no).join(', ')}` : 'ไม่มีใบเสนอราคาที่หมดอายุ' };
      });
    });

    /** Copy a sent/rejected/expired quotation to a new draft "<base>-R<n>" linked by revision_of. */
    app.post('/quotations/:id/revise', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'crm.quote.write');
      const { id } = parse(IdParam, req.params);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const q = await loadQuote(c, id, true);
        if (!['sent', 'rejected', 'expired'].includes(q.status)) throw conflict(`Cannot revise a ${q.status} quotation`);
        if (q.revised_by) throw conflict(`${q.no} was already revised`);
        const rev = (await c.query('select coalesce(max(revision), 0) + 1 as n from quotations where base_no = $1', [q.base_no])).rows[0].n;
        const days = q.valid_until ? Math.max(0, Math.round((Date.parse(q.valid_until) - Date.parse(q.issue_date)) / 86400000)) : 30;
        const copy = (await c.query(
          `insert into quotations (no, base_no, revision, revision_of, opportunity_id, partner_id, customer_name, customer_tax_id, customer_branch, customer_address,
             contact_name, issue_date, valid_until, vat_mode, subtotal, discount, net, vat, gross, note, created_by)
           select $2::text || '-R' || $3::int, base_no, $3::int, id, opportunity_id, partner_id, customer_name, customer_tax_id, customer_branch, customer_address,
             contact_name, current_date, current_date + $4::int, vat_mode, subtotal, discount, net, vat, gross, note, $5
           from quotations where id = $1 returning id`,
          [id, q.base_no, rev, days, a.userId],
        )).rows[0];
        await c.query(
          `insert into quotation_lines (quotation_id, line_no, item_id, item_code, item_name, description, qty, unit_price, discount_pct, amount)
           select $2, line_no, item_id, item_code, item_name, description, qty, unit_price, discount_pct, amount from quotation_lines where quotation_id = $1`,
          [id, copy.id],
        );
        await c.query('update quotations set revised_by = $2, updated_at = now() where id = $1', [id, copy.id]);
        return loadQuote(c, copy.id);
      });
    });

    /* ================= dashboard ================= */

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'crm.lead.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select (select count(*)::int from leads where status in ('new', 'contacted', 'qualified')) as open_leads,
                  coalesce(sum(value) filter (where stage in ('prospect', 'proposal', 'negotiation')), 0) as pipeline_value,
                  coalesce(round(sum(value * probability / 100.0) filter (where stage in ('prospect', 'proposal', 'negotiation')), 2), 0) as weighted,
                  coalesce(sum(value) filter (where stage = 'won' and date_trunc('month', won_at) = date_trunc('month', now())), 0) as won_month,
                  count(*) filter (where stage = 'won')::int as won, count(*) filter (where stage = 'lost')::int as lost,
                  (select count(*)::int from quotations where status = 'sent') as quotes_sent,
                  (select count(*)::int from activities where not done and due_at < now()) as overdue_activities,
                  (select count(*)::int from activities where not done and owner_id = $1) as my_open_activities
           from opportunities`, [a.userId])).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(o.value), 0) as total, count(o.id)::int as deals
           from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m
           left join opportunities o on o.stage = 'won' and date_trunc('month', o.won_at) = m
           group by m order by m`)).rows;
        const rows = (await c.query(
          `select id, no, name, customer_name, stage, value, probability, expected_close from opportunities
           where stage in ('prospect', 'proposal', 'negotiation') order by expected_close nulls last, created_at desc limit 40`)).rows;
        const closed = n.won + n.lost;
        return {
          openLeads: n.open_leads, pipelineValue: n.pipeline_value, weightedForecast: n.weighted, wonThisMonth: n.won_month,
          quotesSent: n.quotes_sent, winRate: closed ? round((n.won / closed) * 100, 1) : 0,
          overdueActivities: n.overdue_activities, myOpenActivities: n.my_open_activities, months, rows,
        };
      });
    });
  },
};
