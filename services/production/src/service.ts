import { auth, conflict, loadManifest, nextDocNo, notFound, one, parse, requirePerm, s, z, type Client, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';
import { bomTree, depthOf, directComponents, explode, leafTotals, loadAllBoms, loadBom, whereUsed } from './bom.ts';
import { statusTh } from '@erp/ui-schema';

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
      return k.db.tx(a.tenantId, async (c) => {
        const all = await loadAllBoms(c);
        const used = new Set([...all.values()].flatMap((bm) => bm.lines.map((l) => l.item_id)));
        const { q } = parse(z.object({ q: z.string().trim().max(100).optional() }), req.query);
        const rows = (await c.query(`select * from boms where ($1::text is null or item_code ilike '%' || $1 || '%' or item_name ilike '%' || $1 || '%') order by item_code`, [q || null])).rows;
        return rows.map((r) => ({
          ...r,
          components: all.get(r.item_id)?.lines.length ?? 0,
          levels: depthOf(all, r.item_id),
          // a sub-assembly is listed on another BOM; a top item is what gets sold or shipped
          role: used.has(r.item_id) ? 'sub' : 'top',
          role_label: used.has(r.item_id) ? 'ชิ้นส่วนประกอบย่อย' : 'สินค้าหลัก',
        }));
      });
    });

    app.get('/boms/:itemId', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.bom.read');
      const { itemId } = parse(z.object({ itemId: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const bom = await loadBom(c, itemId);
        if (!bom) throw notFound('BOM');
        const all = await loadAllBoms(c);
        const tree = bomTree(all, itemId);
        return {
          ...bom,
          // the whole structure for one recipe (output_qty), depth first, with level / has_bom for the indented view
          tree,
          levels: tree.reduce((m, r) => Math.max(m, r.level), 0),
          // bought materials across every level for one recipe (sub-assemblies replaced by their own components)
          requirements: leafTotals(tree).map((r) => ({ item_id: r.itemId, item_code: r.itemCode, item_name: r.itemName ?? null, qty: r.qty })),
          used_in: whereUsed(all, itemId),
        };
      });
    });

    /** Indented multi-level BOM for `qty` units (default one recipe). */
    app.get('/boms/:itemId/tree', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.bom.read');
      const { itemId } = parse(z.object({ itemId: s.uuid }), req.params);
      const { qty } = parse(z.object({ qty: z.coerce.number().positive().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => bomTree(await loadAllBoms(c), itemId, qty));
    });

    /** Which BOMs use this item, directly (level 1) and further up. Works for any item, with or without its own BOM. */
    app.get('/boms/:itemId/where-used', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.bom.read');
      const { itemId } = parse(z.object({ itemId: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => whereUsed(await loadAllBoms(c), itemId));
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
        if (!(await loadBom(c, b.itemId))) throw conflict(`ยังไม่มีสูตรการผลิต (BOM) ของ ${b.itemCode} — สร้าง BOM ก่อน`);
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

    /** Dashboard numbers: orders by stage and output this month. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.order.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status = 'planned')::int as planned, count(*) filter (where status = 'released')::int as released,
                  coalesce(sum(completed_qty) filter (where date_trunc('month', created_at) = date_trunc('month', now())), 0) as output_month,
                  count(*) filter (where status in ('planned', 'released') and due_date < current_date)::int as late
           from production_orders`)).rows[0];
        const rows = (await c.query(
          `(select id, no, item_code, qty, completed_qty, status, due_date from production_orders where status in ('planned', 'released') order by due_date nulls last, created_at)
           union all
           (select id, no, item_code, qty, completed_qty, status, due_date from production_orders where status = 'completed' order by created_at desc limit 8)`)).rows;
        return { planned: n.planned, released: n.released, outputMonth: n.output_month, late: n.late, rows };
      });
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
        if (o.status !== 'planned') throw conflict(`ปล่อยงาน ${o.no} ไม่ได้ — อยู่ในสถานะ "${statusTh(o.status)}"`);
        return (await c.query(`update production_orders set status = 'released' where id = $1 returning *`, [id])).rows[0];
      });
    });

    app.post('/orders/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'production.order.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        if (!['planned', 'released'].includes(o.status)) throw conflict(`ยกเลิก ${o.no} ไม่ได้ — อยู่ในสถานะ "${statusTh(o.status)}"`);
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
        if (o.status !== 'released') throw conflict(`ปิดงาน ${o.no} ไม่ได้ — อยู่ในสถานะ "${statusTh(o.status)}"`);
        const qty = b.qty ?? o.qty - o.completed_qty;
        const bom = await loadBom(c, o.item_id);
        if (!bom) throw conflict(`สูตรการผลิต (BOM) ของ ${o.item_code} ถูกลบไปแล้ว`);
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
