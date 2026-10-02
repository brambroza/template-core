import { auth, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type Client, type ServiceDefinition } from '@erp/kernel';
import { round } from '@erp/thai';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const SheetInput = z.object({
  itemId: s.uuid, itemCode: s.code, itemName: z.string().optional(),
  qty: s.positiveQty.default(1),
  materials: z.array(s.itemLine).min(1),
  laborHours: z.number().min(0).default(0),
  laborRatePerHour: s.money.default(0),
  /** overhead as % of (material + labour) */
  overheadPct: z.number().min(0).max(1000).default(0),
});

interface Priced { itemId: string; itemCode: string; qty: number; unitCost: number | null; amount: number }

/** Price material lines from the cost table; unknown items are reported, not guessed. */
async function priceMaterials(c: Client, lines: { itemId: string; itemCode: string; qty: number }[]) {
  const ids = lines.map((l) => l.itemId);
  const costs = new Map((await c.query('select item_id, avg_cost from item_costs where item_id = any($1)', [ids])).rows.map((r) => [r.item_id, r.avg_cost as number]));
  const priced: Priced[] = lines.map((l) => {
    const unitCost = costs.get(l.itemId) ?? null;
    return { itemId: l.itemId, itemCode: l.itemCode, qty: l.qty, unitCost, amount: unitCost === null ? 0 : round(unitCost * l.qty, 4) };
  });
  return { priced, total: round(priced.reduce((a, p) => a + p.amount, 0), 4), missing: priced.filter((p) => p.unitCost === null).map((p) => p.itemCode) };
}

async function setCost(c: Client, itemId: string, itemCode: string, cost: number, qty: number, source: 'purchase' | 'manual') {
  if (source === 'manual') {
    await c.query(
      `insert into item_costs (item_id, item_code, avg_cost, last_cost, qty_basis, source) values ($1,$2,$3,$3,0,'manual')
       on conflict (tenant_id, item_id) do update set item_code = $2, avg_cost = $3, last_cost = $3, qty_basis = 0, source = 'manual', updated_at = now()`,
      [itemId, itemCode, cost]);
    return;
  }
  // moving average weighted by quantity received so far
  await c.query(
    `insert into item_costs (item_id, item_code, avg_cost, last_cost, qty_basis, source) values ($1,$2,$3,$3,$4,'purchase')
     on conflict (tenant_id, item_id) do update set
       item_code = $2,
       avg_cost = round(((item_costs.avg_cost * item_costs.qty_basis) + ($3 * $4)) / nullif(item_costs.qty_basis + $4, 0), 4),
       last_cost = $3, qty_basis = item_costs.qty_basis + $4, source = 'purchase', updated_at = now()`,
    [itemId, itemCode, cost, qty]);
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    app.get('/item-costs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'costing.cost.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from item_costs order by item_code')).rows);
    });

    app.put('/item-costs/:itemId', async (req) => {
      const a = auth(req);
      requirePerm(a, 'costing.cost.write');
      const { itemId } = parse(z.object({ itemId: s.uuid }), req.params);
      const b = parse(z.object({ itemCode: s.code, cost: s.money }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await setCost(c, itemId, b.itemCode, b.cost, 0, 'manual');
        return one(c, 'select * from item_costs where item_id = $1', [itemId]);
      });
    });

    app.post('/cost-sheets', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'costing.cost.write');
      const b = parse(SheetInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const m = await priceMaterials(c, b.materials);
        if (m.missing.length) {
          reply.code(422);
          return { error: { code: 'missing_costs', message: `No cost for: ${m.missing.join(', ')}`, details: m.missing } };
        }
        const labor = round(b.laborHours * b.laborRatePerHour, 4);
        const overhead = round(((m.total + labor) * b.overheadPct) / 100, 4);
        const total = round(m.total + labor + overhead, 4);
        const no = await nextDocNo(c, 'CS');
        reply.code(201);
        return (await c.query(
          `insert into cost_sheets (no, item_id, item_code, item_name, qty, material_cost, labor_cost, overhead_cost, total_cost, unit_cost, detail, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
          [no, b.itemId, b.itemCode, b.itemName ?? null, b.qty, m.total, labor, overhead, total, round(total / b.qty, 4),
            JSON.stringify({ materials: m.priced, laborHours: b.laborHours, laborRatePerHour: b.laborRatePerHour, overheadPct: b.overheadPct }), a.userId])).rows[0];
      });
    });

    app.get('/cost-sheets', async (req) => {
      const a = auth(req);
      requirePerm(a, 'costing.cost.read');
      const q = parse(z.object({ itemId: s.uuid.optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from cost_sheets where ($1::uuid is null or item_id = $1) order by created_at desc', [q.itemId ?? null])).rows);
    });

    app.get('/cost-sheets/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'costing.cost.read');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, (c) => one(c, 'select * from cost_sheets where id = $1', [id], 'Cost sheet'));
    });

    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'costing.cost.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select (select count(*)::int from item_costs) as items, (select count(*)::int from cost_sheets) as sheets,
                  (select count(*)::int from job_costs where cardinality(missing_costs) > 0) as jobs_missing,
                  (select coalesce(sum(material_cost), 0) from job_costs where date_trunc('month', created_at) = date_trunc('month', now())) as material_month`)).rows[0];
        const rows = (await c.query(`select item_code, avg_cost from item_costs order by avg_cost desc limit 10`)).rows;
        return { itemsCosted: n.items, sheets: n.sheets, jobsMissingCost: n.jobs_missing, materialMonth: n.material_month, rows };
      });
    });

    app.get('/job-costs', async (req) => {
      const a = auth(req);
      requirePerm(a, 'costing.cost.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from job_costs order by created_at desc')).rows);
    });
  },

  handlers: {
    'purchasing.goods_received': async (e, { client }) => {
      for (const l of e.lines) await setCost(client, l.itemId, l.itemCode, l.unitPrice, l.qty, 'purchase');
    },
    'production.completed': async (e, { client }) => {
      const m = await priceMaterials(client, e.components);
      await client.query(
        `insert into job_costs (production_order_id, order_no, item_id, item_code, qty, material_cost, unit_cost, missing_costs, detail)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [e.orderId, e.orderNo, e.item.itemId, e.item.itemCode, e.qty, m.total, round(m.total / e.qty, 4), m.missing, JSON.stringify({ materials: m.priced })]);
    },
  },
};
