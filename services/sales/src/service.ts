import { auth, conflict, loadManifest, nextDocNo, one, parse, requirePerm, s, z, type Client, type ServiceDefinition } from '@erp/kernel';
import { bahtText, documentTotals, formatThaiDate, isValidThaiTaxId, promptPayPayload } from '@erp/thai';
import { fileURLToPath } from 'node:url';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const OrderInput = z.object({
  customerId: s.uuid.nullable().optional(),
  customerName: s.name,
  customerTaxId: z.string().refine(isValidThaiTaxId, 'invalid Thai tax ID').optional(),
  customerBranch: z.string().regex(/^\d{5}$/).optional(),
  customerAddress: z.string().max(500).optional(),
  warehouseCode: s.code.default('MAIN'),
  orderDate: s.isoDate.optional(),
  vatMode: z.enum(['exclusive', 'inclusive']).default('exclusive'),
  note: z.string().max(1000).optional(),
  lines: z.array(s.pricedItemLine).min(1),
});
const IdParam = z.object({ id: s.uuid });

async function loadOrder(c: Client, id: string, lock = false) {
  const o = await one(c, `select * from sales_orders where id = $1 ${lock ? 'for update' : ''}`, [id], 'Sales order');
  o.lines = (await c.query('select * from so_lines where order_id = $1 order by line_no', [id])).rows;
  return o;
}

function assertStatus(o: { status: string; no: string }, allowed: string[], action: string) {
  if (!allowed.includes(o.status)) throw conflict(`Cannot ${action} ${o.no}: status is ${o.status}`);
}

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    app.post('/orders', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.write');
      const b = parse(OrderInput, req.body);
      const t = documentTotals(b.lines, b.vatMode);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const no = await nextDocNo(c, 'SO', b.orderDate ? new Date(b.orderDate) : new Date());
        const o = (await c.query(
          `insert into sales_orders (no, customer_id, customer_name, customer_tax_id, customer_branch, customer_address, warehouse_code, order_date, vat_mode, net, vat, gross, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,coalesce($8::date, current_date),$9,$10,$11,$12,$13,$14) returning id`,
          [no, b.customerId ?? null, b.customerName, b.customerTaxId ?? null, b.customerBranch ?? null, b.customerAddress ?? null, b.warehouseCode, b.orderDate ?? null, b.vatMode, t.net, t.vat, t.gross, b.note ?? null, a.userId],
        )).rows[0];
        for (const [i, l] of b.lines.entries()) {
          await c.query(
            'insert into so_lines (order_id, line_no, item_id, item_code, item_name, qty, unit_price, amount) values ($1,$2,$3,$4,$5,$6,$7,$8)',
            [o.id, i + 1, l.itemId, l.itemCode, l.itemName ?? null, l.qty, l.unitPrice, t.amounts[i]],
          );
        }
        return loadOrder(c, o.id);
      });
    });

    app.get('/orders', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.read');
      const q = parse(s.listQuery.extend({ status: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select * from sales_orders where ($1::text is null or status = $1) and ($2::text is null or no ilike $2 or customer_name ilike $2)
         order by created_at desc limit $3 offset $4`, [q.status ?? null, q.q ? `%${q.q}%` : null, q.limit, q.offset])).rows);
    });

    app.get('/orders/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => loadOrder(c, id));
    });

    app.post('/orders/:id/confirm', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['draft'], 'confirm');
        await c.query(`update sales_orders set status = 'confirmed' where id = $1`, [id]);
        await k.emit(c, 'sales.order_confirmed', {
          orderId: o.id, orderNo: o.no, customerId: o.customer_id, customerName: o.customer_name, total: o.gross,
          lines: o.lines.map((l: any) => ({ itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name ?? undefined, qty: l.qty, unitPrice: l.unit_price })),
        });
        return loadOrder(c, id);
      });
    });

    app.post('/orders/:id/deliver', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.deliver');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['confirmed'], 'deliver');
        await c.query(`update sales_orders set status = 'delivered' where id = $1`, [id]);
        await k.emit(c, 'sales.delivered', {
          orderId: o.id, orderNo: o.no, warehouseCode: o.warehouse_code,
          lines: o.lines.map((l: any) => ({ itemId: l.item_id, itemCode: l.item_code, itemName: l.item_name ?? undefined, qty: l.qty })),
        });
        return loadOrder(c, id);
      });
    });

    app.post('/orders/:id/cancel', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.write');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['draft', 'confirmed'], 'cancel');
        await c.query(`update sales_orders set status = 'cancelled' where id = $1`, [id]);
        return loadOrder(c, id);
      });
    });

    app.post('/orders/:id/invoice', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'sales.invoice.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ issueDate: s.isoDate.optional() }), req.body ?? {});
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const o = await loadOrder(c, id, true);
        assertStatus(o, ['confirmed', 'delivered'], 'invoice');
        const no = await nextDocNo(c, 'INV', b.issueDate ? new Date(b.issueDate) : new Date());
        const inv = (await c.query(
          `insert into invoices (no, order_id, issue_date, net, vat, gross) values ($1, $2, coalesce($3::date, current_date), $4, $5, $6) returning id`,
          [no, o.id, b.issueDate ?? null, o.net, o.vat, o.gross],
        )).rows[0];
        await c.query(`update sales_orders set status = 'invoiced' where id = $1`, [id]);
        await k.emit(c, 'sales.invoiced', { invoiceId: inv.id, invoiceNo: no, orderId: o.id, net: o.net, vat: o.vat, gross: o.gross });
        return printableInvoice(c, inv.id, k.env);
      });
    });

    app.get('/invoices/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'sales.order.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, (c) => printableInvoice(c, id, k.env));
    });
  },
};

/** Everything a Thai tax invoice template needs, already formatted. */
async function printableInvoice(c: Client, id: string, env: NodeJS.ProcessEnv) {
  const inv = await one(c, 'select * from invoices where id = $1', [id], 'Invoice');
  const order = await loadOrder(c, inv.order_id);
  return {
    ...inv,
    issueDateTh: formatThaiDate(inv.issue_date),
    amountText: bahtText(inv.gross),
    customer: { id: order.customer_id, name: order.customer_name, taxId: order.customer_tax_id, branch: order.customer_branch, address: order.customer_address },
    orderNo: order.no,
    lines: order.lines,
    promptPay: env.PROMPTPAY_ID ? promptPayPayload(env.PROMPTPAY_ID, inv.gross) : null,
  };
}
