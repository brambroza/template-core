import { auth, conflict, loadManifest, nextDocNo, notFound, one, parse, requirePerm, s, z, type Client, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';
import { directComponents, explode, loadBom } from './bom.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const BomInput = z.object({
  itemId: s.uuid,
  itemCode: s.code,
  itemName: z.string().optional(),
  outputQty: s.positiveQty.default(1),
  lines: z.array(s.itemLine.extend({ scrapPct: z.number().min(0).max(99.999).default(0) })).min(1),
}).refine((b) => !b.lines.some((l) => l.itemId === b.itemId), 'an item cannot be its own component');

const OrderInput = z.object({
  itemId: s.uuid, itemCode: s.code, itemName: z.string().optional(),
  qty: s.positiveQty, warehouseCode: s.code.default('MAIN'), dueDate: s.isoDate.optional(),
});
const IdParam = z.object({ id: s.uuid });

async function loadOrder(c: Client, id: string, lock = false) {
  return one(c, `select * from production_orders where id = $1 ${lock ? 'for update' : ''}`, [id], 'Production order');
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    /** Create or replace the BOM of an item. */
    app.put('/boms', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.bom.write');
      const b = parse(BomInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const bom = (await c.query(
          `insert into boms (item_id, item_code, item_name, output_qty) values ($1,$2,$3,$4)
           on conflict (tenant_id, item_id) do update set item_code = excluded.item_code, item_name = excluded.item_name, output_qty = excluded.output_qty, updated_at = now()
           returning id`, [b.itemId, b.itemCode, b.itemName ?? null, b.outputQty])).rows[0];
        await c.query('delete from bom_lines where bom_id = $1', [bom.id]);
        for (const [i, l] of b.lines.entries()) {
          await c.query('insert into bom_lines (bom_id, line_no, item_id, item_code, item_name, qty, scrap_pct) values ($1,$2,$3,$4,$5,$6,$7)',
            [bom.id, i + 1, l.itemId, l.itemCode, l.itemName ?? null, l.qty, l.scrapPct]);
        }
        // reject edits that would make the structure circular
        await explode(c, b.itemId, 1);
        return loadBom(c, b.itemId);
      });
    });

    app.get('/boms', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.bom.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from boms order by item_code')).rows);
    });

    app.get('/boms/:itemId', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.bom.read');
      const { itemId } = parse(z.object({ itemId: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => (await loadBom(c, itemId)) ?? Promise.reject(notFound('BOM')));
    });

    app.get('/boms/:itemId/explode', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.bom.read');
      const { itemId } = parse(z.object({ itemId: s.uuid }), req.params);
      const { qty } = parse(z.object({ qty: z.coerce.number().positive().default(1) }), req.query);
      return k.db.tx(a.tenantId, (c) => explode(c, itemId, qty));
    });

    app.post('/orders', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'production.order.write');
      const b = parse(OrderInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        if (!(await loadBom(c, b.itemId))) throw conflict(`No BOM for ${b.itemCode}; create one first`);
        const no = await nextDocNo(c, 'MO');
        return (await c.query(
          `insert into production_orders (no, item_id, item_code, item_name, qty, warehouse_code, due_date, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
          [no, b.itemId, b.itemCode, b.itemName ?? null, b.qty, b.warehouseCode, b.dueDate ?? null, a.userId])).rows[0];
      });
    });

    app.get('/orders', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.order.read');
      const q = parse(s.listQuery.extend({ status: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from production_orders where ($1::text is null or status = $1) order by created_at desc limit $2 offset $3`,
        [q.status ?? null, q.limit, q.offset])).rows);
    });

    /** Order + its material requirements (MRP view for the planner / shop floor). */
    app.get('/orders/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.order.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id);
        const open = Math.max(o.qty - o.completed_qty, 0);
        return { ...o, requirements: open > 0 ? await explode(c, o.item_id, open) : [] };
      });
    });

    app.post('/orders/:id/release', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.order.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        if (o.status !== 'planned') throw conflict(`Cannot release ${o.no}: status is ${o.status}`);
        return (await c.query(`update production_orders set status = 'released' where id = $1 returning *`, [id])).rows[0];
      });
    });

    app.post('/orders/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.order.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        if (!['planned', 'released'].includes(o.status)) throw conflict(`Cannot cancel ${o.no}: status is ${o.status}`);
        return (await c.query(`update production_orders set status = 'cancelled' where id = $1 returning *`, [id])).rows[0];
      });
    });

    /** Report output. Consumes direct components (sub-assemblies are consumed as items). */
    app.post('/orders/:id/complete', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.order.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ qty: s.positiveQty.optional() }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        if (o.status !== 'released') throw conflict(`Cannot complete ${o.no}: status is ${o.status}`);
        const qty = b.qty ?? o.qty - o.completed_qty;
        const bom = await loadBom(c, o.item_id);
        if (!bom) throw conflict(`BOM for ${o.item_code} was removed`);
        const doneQty = o.completed_qty + qty;
        const updated = (await c.query(
          `update production_orders set completed_qty = $2, status = case when $2 >= qty then 'completed' else status end where id = $1 returning *`,
          [id, doneQty])).rows[0];
        await k.emit(c, 'production.completed', {
          orderId: o.id, orderNo: o.no, item: { itemId: o.item_id, itemCode: o.item_code, itemName: o.item_name ?? undefined },
          qty, warehouseCode: o.warehouse_code, components: directComponents(bom, qty),
        });
        return updated;
      });
    });
  },
};
