import { auth, badRequest, conflict, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type Client, type ServiceDefinition } from '@erp/kernel';
import { documentTotals } from '@erp/thai';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const PoInput = z.object({
  supplierId: s.uuid.nullable().optional(),
  supplierName: s.name,
  warehouseCode: s.code.default('MAIN'),
  orderDate: s.isoDate.optional(),
  expectedDate: s.isoDate.optional(),
  vatMode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  note: z.string().max(1000).optional(),
  lines: z.array(s.pricedItemLine).min(1),
});
const ReceiveInput = z.object({
  /** omit to receive everything still outstanding */
  lines: z.array(z.object({ lineId: s.uuid, qty: s.positiveQty })).min(1).optional(),
});
const IdParam = z.object({ id: s.uuid });

async function loadPo(c: Client, id: string, lock = false) {
  const po = await one(c, `select * from purchase_orders where id = $1 ${lock ? 'for update' : ''}`, [id], 'Purchase order');
  po.lines = (await c.query('select * from po_lines where po_id = $1 order by line_no', [id])).rows;
  return po;
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    app.post('/purchase-orders', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.write');
      const b = parse(PoInput, req.body);
      const t = documentTotals(b.lines, b.vatMode);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'PO', b.orderDate ? new Date(b.orderDate) : new Date());
        const po = (await c.query(
          `insert into purchase_orders (no, supplier_id, supplier_name, warehouse_code, order_date, expected_date, vat_mode, net, vat, gross, note, created_by)
           values ($1,$2,$3,$4,coalesce($5::date, current_date),$6,$7,$8,$9,$10,$11,$12) returning id`,
          [no, b.supplierId ?? null, b.supplierName, b.warehouseCode, b.orderDate ?? null, b.expectedDate ?? null, b.vatMode, t.net, t.vat, t.gross, b.note ?? null, a.userId],
        )).rows[0];
        for (const [i, l] of b.lines.entries()) {
          await c.query(
            `insert into po_lines (po_id, line_no, item_id, item_code, item_name, qty, unit_price, amount) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
            [po.id, i + 1, l.itemId, l.itemCode, l.itemName ?? null, l.qty, l.unitPrice, t.amounts[i]],
          );
        }
        await k.emit(c, 'purchasing.po_created', { poId: po.id, poNo: no, supplierName: b.supplierName, gross: t.gross });
        return loadPo(c, po.id);
      });
    });

    app.get('/purchase-orders', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const q = parse(s.listQuery.extend({ status: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from purchase_orders where ($1::text is null or status = $1) and ($2::text is null or no ilike $2 or supplier_name ilike $2)
         order by created_at desc limit $3 offset $4`, [q.status ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    /** Dashboard numbers: what needs action, spend per month, recent orders. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      return k.db.tx(a.tenantId, async (c) => {
        const n = (await c.query(
          `select count(*) filter (where status = 'draft')::int as to_approve,
                  count(*) filter (where status in ('approved', 'partially_received'))::int as to_receive,
                  coalesce(sum(gross) filter (where status <> 'cancelled' and status <> 'draft' and date_trunc('month', order_date) = date_trunc('month', current_date)), 0) as spend_month
           from purchase_orders`)).rows[0];
        const months = (await c.query(
          `select to_char(m, 'YYYY-MM') as month, coalesce(sum(p.gross), 0) as total
           from generate_series(date_trunc('month', current_date) - interval '5 months', date_trunc('month', current_date), interval '1 month') m
           left join purchase_orders p on date_trunc('month', p.order_date) = m and p.status not in ('draft', 'cancelled')
           group by m order by m`)).rows;
        const rows = (await c.query(`select id, no, supplier_name, status, gross from purchase_orders where status <> 'cancelled' order by created_at desc limit 24`)).rows;
        return { toApprove: n.to_approve, toReceive: n.to_receive, spendMonth: n.spend_month, months, rows };
      });
    });

    app.get('/purchase-orders/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadPo(c, id));
    });

    app.post('/purchase-orders/:id/approve', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.approve');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const po = await loadPo(c, id, true);
        if (po.status !== 'draft') throw conflict(`Cannot approve a ${po.status} purchase order`);
        await c.query(`update purchase_orders set status = 'approved', approved_by = $2, approved_at = now() where id = $1`, [id, a.userId]);
        await k.emit(c, 'purchasing.po_approved', { poId: po.id, poNo: po.no, supplierName: po.supplier_name, gross: po.gross });
        return loadPo(c, id);
      });
    });

    app.post('/purchase-orders/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const po = await loadPo(c, id, true);
        if (!['draft', 'approved'].includes(po.status)) throw conflict(`Cannot cancel a ${po.status} purchase order`);
        await c.query(`update purchase_orders set status = 'cancelled' where id = $1`, [id]);
        return loadPo(c, id);
      });
    });

    app.post('/purchase-orders/:id/receive', async (req) => {
      const a = auth(req);
      requirePerm(a, 'purchasing.po.receive');
      const { id } = parse(IdParam, req.params);
      const b = parse(ReceiveInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const po = await loadPo(c, id, true);
        if (!['approved', 'partially_received'].includes(po.status)) throw conflict(`Cannot receive a ${po.status} purchase order`);
        const wanted = b.lines ?? po.lines.map((l: any) => ({ lineId: l.id, qty: l.qty - l.received_qty })).filter((l: any) => l.qty > 0);
        const received = [];
        for (const w of wanted) {
          const line = po.lines.find((l: any) => l.id === w.lineId);
          if (!line) throw badRequest(`Line ${w.lineId} is not on ${po.no}`);
          if (line.received_qty + w.qty > line.qty) throw conflict(`Line ${line.line_no} (${line.item_code}): receiving ${w.qty} exceeds outstanding ${line.qty - line.received_qty}`);
          await c.query('update po_lines set received_qty = received_qty + $2 where id = $1', [line.id, w.qty]);
          received.push({ itemId: line.item_id, itemCode: line.item_code, itemName: line.item_name ?? undefined, qty: w.qty, unitPrice: line.unit_price });
        }
        const done = (await c.query('select bool_and(received_qty >= qty) as all from po_lines where po_id = $1', [id])).rows[0].all;
        await c.query('update purchase_orders set status = $2 where id = $1', [id, done ? 'received' : 'partially_received']);
        await k.emit(c, 'purchasing.goods_received', {
          poId: po.id, poNo: po.no, supplierId: po.supplier_id, supplierName: po.supplier_name, warehouseCode: po.warehouse_code, lines: received,
        });
        return loadPo(c, id);
      });
    });
  },
};
