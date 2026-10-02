import { auth, loadManifest, parse, requirePerm, s, z, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';
import { postMove, type Emit } from './stock.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const Line = s.itemLine.extend({ unitCost: s.money.optional() });
const Ref = { refType: z.string().max(50).optional(), refId: z.string().max(100).optional(), note: z.string().max(500).optional() };
const ReceiptInput = z.object({ warehouseCode: s.code, lines: z.array(Line).min(1), ...Ref });
const IssueInput = z.object({ warehouseCode: s.code, lines: z.array(s.itemLine).min(1), ...Ref });
const TransferInput = z.object({ fromWarehouseCode: s.code, toWarehouseCode: s.code, lines: z.array(s.itemLine).min(1), note: Ref.note })
  .refine((v) => v.fromWarehouseCode !== v.toWarehouseCode, 'from and to warehouse must differ');
const AdjustInput = z.object({
  warehouseCode: s.code,
  lines: z.array(s.itemLine.extend({ qty: z.number().finite().refine((n) => n !== 0, 'qty must not be 0') })).min(1),
  note: z.string().min(1).max(500),
});

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),

  routes(app, k) {
    app.get('/warehouses', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from warehouses order by code')).rows);
    });

    app.post('/warehouses', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'inventory.settings.write');
      const body = parse(z.object({ code: s.code, name: s.name }), req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into warehouses (code, name) values ($1, $2) returning *', [body.code, body.name])).rows[0]);
    });

    app.put('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.settings.write');
      const body = parse(z.object({ allowNegative: z.boolean() }), req.body);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `insert into settings (tenant_id, allow_negative) values (nullif(current_setting('app.tenant_id', true), '')::uuid, $1)
         on conflict (tenant_id) do update set allow_negative = excluded.allow_negative returning *`, [body.allowNegative])).rows[0]);
    });

    app.post('/receipts', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'inventory.move.write');
      const b = parse(ReceiptInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const em: Emit = (t, d) => k.emit(c, t, d);
        const out = [];
        for (const l of b.lines) out.push(await postMove(em, c, { ...l, warehouseCode: b.warehouseCode, kind: 'receive', refType: b.refType, refId: b.refId, note: b.note, userId: a.userId }));
        return { moves: out };
      });
    });

    app.post('/issues', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'inventory.move.write');
      const b = parse(IssueInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const em: Emit = (t, d) => k.emit(c, t, d);
        const out = [];
        for (const l of b.lines) out.push(await postMove(em, c, { ...l, qty: -l.qty, warehouseCode: b.warehouseCode, kind: 'issue', refType: b.refType, refId: b.refId, note: b.note, userId: a.userId }));
        return { moves: out };
      });
    });

    app.post('/transfers', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'inventory.move.write');
      const b = parse(TransferInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const em: Emit = (t, d) => k.emit(c, t, d);
        const out = [];
        for (const l of b.lines) {
          out.push(await postMove(em, c, { ...l, qty: -l.qty, warehouseCode: b.fromWarehouseCode, kind: 'transfer_out', refType: 'transfer', note: b.note, userId: a.userId }));
          out.push(await postMove(em, c, { ...l, warehouseCode: b.toWarehouseCode, kind: 'transfer_in', refType: 'transfer', note: b.note, userId: a.userId }));
        }
        return { moves: out };
      });
    });

    app.post('/adjustments', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'inventory.move.write');
      const b = parse(AdjustInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const em: Emit = (t, d) => k.emit(c, t, d);
        const out = [];
        for (const l of b.lines) out.push(await postMove(em, c, { ...l, warehouseCode: b.warehouseCode, kind: 'adjust', refType: 'adjustment', note: b.note, userId: a.userId }));
        return { moves: out };
      });
    });

    app.get('/balances', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      const q = parse(z.object({ itemId: s.uuid.optional(), warehouseCode: z.string().optional(), nonZero: z.coerce.boolean().default(true) }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select m.item_id as "itemId", m.item_code as "itemCode", max(m.item_name) as "itemName", w.code as "warehouseCode", sum(m.qty) as "onHand"
         from stock_moves m join warehouses w on w.id = m.warehouse_id
         where ($1::uuid is null or m.item_id = $1) and ($2::text is null or w.code = $2)
         group by m.item_id, m.item_code, w.code ${q.nonZero ? 'having sum(m.qty) <> 0' : ''}
         order by m.item_code, w.code`, [q.itemId ?? null, q.warehouseCode ?? null])).rows);
    });

    app.get('/reorder-points', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from reorder_points order by item_code, warehouse_code')).rows);
    });

    app.put('/reorder-points', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.settings.write');
      const b = parse(z.object({ itemId: s.uuid, itemCode: s.code, itemName: z.string().optional(), warehouseCode: s.code, minQty: s.money }), req.body);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `insert into reorder_points (item_id, item_code, item_name, warehouse_code, min_qty) values ($1,$2,$3,$4,$5)
         on conflict (tenant_id, item_id, warehouse_code) do update set item_code = $2, item_name = $3, min_qty = $5, updated_at = now() returning *`,
        [b.itemId, b.itemCode, b.itemName ?? null, b.warehouseCode, b.minQty])).rows[0]);
    });

    /** Dashboard numbers: stock levels against reorder points. */
    app.get('/summary', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      return k.db.tx(a.tenantId, async (c) => {
        const rows = (await c.query(
          `with bal as (
             select m.item_id, m.item_code, max(m.item_name) as item_name, w.code as warehouse_code, sum(m.qty) as on_hand
             from stock_moves m join warehouses w on w.id = m.warehouse_id group by m.item_id, m.item_code, w.code)
           select b.item_code as "itemCode", b.item_name as "itemName", b.warehouse_code as "warehouseCode", b.on_hand as "onHand",
                  r.min_qty as "minQty", (r.min_qty is not null and b.on_hand < r.min_qty) as "low"
           from bal b left join reorder_points r on r.item_id = b.item_id and r.warehouse_code = b.warehouse_code
           order by (r.min_qty is not null and b.on_hand < r.min_qty) desc, b.on_hand desc limit 12`)).rows;
        const totals = (await c.query(
          `select count(distinct item_id)::int as skus, count(distinct warehouse_id)::int as warehouses,
                  count(*) filter (where created_at > now() - interval '1 day')::int as moves_today from stock_moves`)).rows[0];
        const low = (await c.query(
          `select count(*)::int as n from reorder_points r where r.min_qty > coalesce((select sum(m.qty) from stock_moves m join warehouses w on w.id = m.warehouse_id
             where m.item_id = r.item_id and w.code = r.warehouse_code), 0)`)).rows[0].n;
        return { skus: totals.skus, warehouses: totals.warehouses, movesToday: totals.moves_today, lowStock: low, rows };
      });
    });

    app.get('/items/:itemId/stock-card', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      const { itemId } = parse(z.object({ itemId: s.uuid }), req.params);
      const q = parse(z.object({ warehouseCode: z.string().optional() }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select m.created_at as "at", w.code as "warehouseCode", m.kind, m.qty, m.unit_cost as "unitCost", m.ref_type as "refType", m.ref_id as "refId", m.note,
                sum(m.qty) over (partition by m.warehouse_id order by m.created_at, m.id) as "balance"
         from stock_moves m join warehouses w on w.id = m.warehouse_id
         where m.item_id = $1 and ($2::text is null or w.code = $2)
         order by w.code, m.created_at, m.id`, [itemId, q.warehouseCode ?? null])).rows);
    });
  },

  handlers: {
    'purchasing.goods_received': async (e, { client, emit }) => {
      for (const l of e.lines) await postMove(emit, client, { ...l, warehouseCode: e.warehouseCode, kind: 'receive', unitCost: l.unitPrice, refType: 'purchase_order', refId: e.poNo }, { autoCreateWarehouse: true });
    },
    'sales.delivered': async (e, { client, emit }) => {
      for (const l of e.lines) await postMove(emit, client, { ...l, qty: -l.qty, warehouseCode: e.warehouseCode, kind: 'issue', refType: 'sales_order', refId: e.orderNo }, { autoCreateWarehouse: true, force: true });
    },
    'production.completed': async (e, { client, emit }) => {
      for (const l of e.components) await postMove(emit, client, { ...l, qty: -l.qty, warehouseCode: e.warehouseCode, kind: 'issue', refType: 'production_order', refId: e.orderNo }, { autoCreateWarehouse: true, force: true });
      await postMove(emit, client, { ...e.item, qty: e.qty, warehouseCode: e.warehouseCode, kind: 'receive', refType: 'production_order', refId: e.orderNo }, { autoCreateWarehouse: true });
    },
    'maintenance.parts_used': async (e, { client, emit }) => {
      for (const l of e.parts) await postMove(emit, client, { ...l, qty: -l.qty, warehouseCode: e.warehouseCode, kind: 'issue', refType: 'work_order', refId: e.workOrderNo }, { autoCreateWarehouse: true, force: true });
    },
  },
};
