import { auth, conflict, forbidden, hasPerm, loadManifest, notFound, parse, requirePerm, s, z, type AuthContext, type Client, type ServiceDefinition } from '@erp/kernel';
import { fileURLToPath } from 'node:url';
import { ensureHoldWarehouse, fmtQty, postMove, reduceHold, warehouse, type Emit, type MoveInput, type MoveOptions } from './stock.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const Line = s.itemLine.extend({ unitCost: s.money.optional() });
const Ref = { refType: z.string().max(50).optional(), refId: z.string().max(100).optional(), note: z.string().max(500).optional() };
/** wave 8: admin override for taking stock out of a hold warehouse outside the hold flow (perm inventory.hold.override) — the reason is recorded */
const Override = { overrideHoldReason: z.string().trim().min(5, 'ระบุเหตุผลอย่างน้อย 5 ตัวอักษร').max(500).optional().or(z.literal('').transform(() => undefined)) };
const ReceiptInput = z.object({ warehouseCode: s.code, lines: z.array(Line).min(1), ...Ref });
const IssueInput = z.object({ warehouseCode: s.code, lines: z.array(s.itemLine).min(1), ...Ref, ...Override });
const TransferInput = z.object({ fromWarehouseCode: s.code, toWarehouseCode: s.code, lines: z.array(s.itemLine).min(1), note: Ref.note, ...Override })
  .refine((v) => v.fromWarehouseCode !== v.toWarehouseCode, 'from and to warehouse must differ');
const AdjustInput = z.object({
  warehouseCode: s.code,
  lines: z.array(s.itemLine.extend({ qty: z.number().finite().refine((n) => n !== 0, 'qty must not be 0') })).min(1),
  note: z.string().min(1).max(500),
  ...Override,
});

const SettingsInput = z.object({ allowNegative: z.boolean().optional(), receiveIntoHoldWhenInspected: z.boolean().optional() })
  .refine((v) => v.allowNegative !== undefined || v.receiveIntoHoldWhenInspected !== undefined, 'nothing to change');
const ReleaseInput = z.object({ qty: s.positiveQty.optional(), toWarehouseCode: s.code.optional(), note: z.string().trim().min(1).max(500) });
const IdParam = z.object({ id: s.uuid });

type Item = Pick<MoveInput, 'itemId' | 'itemCode' | 'itemName'>;

/**
 * Stock in a hold warehouse (QC-HOLD) leaves only through the hold flow — "ปล่อยเข้าคลัง" (`POST /holds/:id/release`, QC decision + note)
 * or a return to the supplier — never by a normal issue / transfer / negative adjustment, whatever the user's permissions (wave 8,
 * round-2 N2: a store clerk issued rejected steel). The one exception is an admin override: perm `inventory.hold.override` + a reason,
 * written on the stock card and in the hold log (the holds are reduced so the hold list keeps matching the stock).
 * Returns the move options to use for moves out of `code` (undefined = not a hold warehouse).
 */
async function guardHold(c: Client, a: AuthContext, code: string, reason: string | undefined): Promise<MoveOptions | undefined> {
  const wh = await warehouse(c, code);
  if (!wh.isHold) return undefined;
  if (!reason) {
    throw forbidden(`คลัง ${code} เป็นคลังกักกัน QC — ของที่รอตัดสิน/ไม่ผ่าน QC ออกจากคลังนี้ได้เฉพาะ "ปล่อยเข้าคลัง" ในหน้ากักกัน QC (ผลตัดสินพร้อมเหตุผล) หรือ "ส่งคืนผู้ขาย" เท่านั้น — จ่าย/โอน/ปรับลดตรงไม่ได้`);
  }
  if (!hasPerm(a, 'inventory.hold.override')) {
    throw forbidden(`บังคับจ่ายออกจากคลังกักกัน ${code} ได้เฉพาะผู้มีสิทธิ์ "บังคับจ่ายออกจากคลังกักกัน" (inventory.hold.override) — ให้ใช้ "ปล่อยเข้าคลัง" ในหน้ากักกัน QC`);
  }
  return { holdLog: { kind: 'override', userName: a.userName ?? null } };
}
const overrideNote = (reason: string | undefined, note: string | undefined | null) =>
  reason ? [`บังคับออกจากคลังกักกัน: ${reason}`, note].filter(Boolean).join(' · ') : note;

/** transfer_out + transfer_in with the same reference (both through postMove). */
async function transfer(em: Emit, c: Client, item: Item, from: string, to: string, qty: number, ref: { refType: string; refId: string; note?: string | null; userId?: string | null }, force = false) {
  // the hold flow itself (release, QC verdict) keeps qc_holds in step
  await postMove(em, c, { ...item, qty: -qty, warehouseCode: from, kind: 'transfer_out', ...ref }, { autoCreateWarehouse: force, force, holdManaged: true });
  await postMove(em, c, { ...item, qty, warehouseCode: to, kind: 'transfer_in', ...ref }, { autoCreateWarehouse: force });
}

async function readSettings(c: Client) {
  const r = (await c.query('select allow_negative, receive_into_hold from settings')).rows[0];
  return { allowNegative: r?.allow_negative ?? false, receiveIntoHoldWhenInspected: r?.receive_into_hold ?? false };
}

const HOLD_STATUS_TH: Record<string, string> = { pending: 'รอผล QC', rejected: 'ไม่ผ่าน รอตัดสิน', released: 'ปล่อยแล้ว', returned: 'ส่งคืนผู้ขายแล้ว', forced_out: 'ถูกจ่ายออกนอกขั้นตอน (ดูเหตุผล)' };
const LOG_TH: Record<string, string> = { release: 'ปล่อยเข้าคลัง (ผลตัดสิน)', return: 'ส่งคืนผู้ขาย', override: 'บังคับจ่ายออก (ผู้ดูแลระบบ)', external: 'ตัดออกโดยเอกสารโมดูลอื่น' };
const thHold = (h: any) => ({ ...h, status_th: HOLD_STATUS_TH[h.status] ?? h.status });
const REF_TH: Record<string, string> = {
  sales_order: 'ส่งของตามใบสั่งขาย', production_order: 'ผลิต (ตัดวัตถุดิบ)', work_order: 'ใบสั่งซ่อม (อะไหล่)', purchase_order: 'รับตามใบสั่งซื้อ',
  purchase_return: 'ส่งคืนผู้ขาย', sales_note: 'รับคืนตามใบลดหนี้', qc_inspection: 'QC กักกัน/ปล่อย', qc_release: 'ปล่อยจากคลังกักกัน', transfer: 'โอนย้าย', adjustment: 'ปรับปรุงยอด',
};

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
      const body = parse(z.object({ code: s.code, name: s.name, isHold: z.boolean().optional() }), req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into warehouses (code, name, is_hold) values ($1, $2, $3) returning *', [body.code, body.name, body.isHold ?? false])).rows[0]);
    });

    app.get('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      return k.db.tx(a.tenantId, readSettings);
    });

    app.put('/settings', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.settings.write');
      const body = parse(SettingsInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await c.query(
          `insert into settings (tenant_id, allow_negative, receive_into_hold) values (nullif(current_setting('app.tenant_id', true), '')::uuid, coalesce($1, false), coalesce($2, false))
           on conflict (tenant_id) do update set allow_negative = coalesce($1, settings.allow_negative), receive_into_hold = coalesce($2, settings.receive_into_hold)`,
          [body.allowNegative ?? null, body.receiveIntoHoldWhenInspected ?? null]);
        return readSettings(c);
      });
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
        const hold = await guardHold(c, a, b.warehouseCode, b.overrideHoldReason);
        const em: Emit = (t, d) => k.emit(c, t, d);
        const out = [];
        const note = hold ? overrideNote(b.overrideHoldReason, b.note) : b.note;
        for (const l of b.lines) out.push(await postMove(em, c, { ...l, qty: -l.qty, warehouseCode: b.warehouseCode, kind: 'issue', refType: b.refType, refId: b.refId, note, userId: a.userId }, hold));
        return { moves: out };
      });
    });

    app.post('/transfers', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'inventory.move.write');
      const b = parse(TransferInput, req.body);
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const hold = await guardHold(c, a, b.fromWarehouseCode, b.overrideHoldReason);
        const em: Emit = (t, d) => k.emit(c, t, d);
        const out = [];
        const note = hold ? overrideNote(b.overrideHoldReason, b.note) : b.note;
        for (const l of b.lines) {
          out.push(await postMove(em, c, { ...l, qty: -l.qty, warehouseCode: b.fromWarehouseCode, kind: 'transfer_out', refType: 'transfer', note, userId: a.userId }, hold));
          out.push(await postMove(em, c, { ...l, warehouseCode: b.toWarehouseCode, kind: 'transfer_in', refType: 'transfer', note, userId: a.userId }));
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
        const hold = b.lines.some((l) => l.qty < 0) ? await guardHold(c, a, b.warehouseCode, b.overrideHoldReason) : undefined;
        const em: Emit = (t, d) => k.emit(c, t, d);
        const out = [];
        const note = hold ? overrideNote(b.overrideHoldReason, b.note)! : b.note;
        for (const l of b.lines) out.push(await postMove(em, c, { ...l, warehouseCode: b.warehouseCode, kind: 'adjust', refType: 'adjustment', note, userId: a.userId }, hold));
        return { moves: out };
      });
    });

    app.get('/balances', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      const q = parse(z.object({ itemId: s.uuid.optional(), warehouseCode: z.string().optional(), nonZero: z.coerce.boolean().default(true) }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select m.item_id as "itemId", m.item_code as "itemCode", max(m.item_name) as "itemName", w.code as "warehouseCode", sum(m.qty) as "onHand",
                case when w.is_hold then 0 else sum(m.qty) end as "available", w.is_hold as "isHold"
         from stock_moves m join warehouses w on w.id = m.warehouse_id
         where ($1::uuid is null or m.item_id = $1) and ($2::text is null or w.code = $2)
         group by m.item_id, m.item_code, w.code, w.is_hold ${q.nonZero ? 'having sum(m.qty) <> 0' : ''}
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
        const neg = (await c.query(
          `select m.item_code as "itemCode", max(m.item_name) as "itemName", w.code as "warehouseCode", sum(m.qty) as "onHand",
                  -sum(m.qty) as "shortQty", m.item_code || ' @ ' || w.code as "label"
           from stock_moves m join warehouses w on w.id = m.warehouse_id
           group by m.item_id, m.item_code, w.code having sum(m.qty) < 0 order by sum(m.qty) limit 12`)).rows;
        const negCount = (await c.query(
          `select count(*)::int as n from (select 1 from stock_moves group by item_id, warehouse_id having sum(qty) < 0) x`)).rows[0].n;
        const hold = (await c.query(
          `select count(*)::int as n from (select 1 from stock_moves m join warehouses w on w.id = m.warehouse_id where w.is_hold
             group by m.item_id, w.id having sum(m.qty) > 0) x`)).rows[0].n;
        const anomalies = (await c.query('select count(*)::int as n from stock_anomalies where acknowledged_at is null')).rows[0].n;
        return {
          skus: totals.skus, warehouses: totals.warehouses, movesToday: totals.moves_today, lowStock: low, rows,
          negative: negCount, negativeRows: neg, onHold: hold, openAnomalies: anomalies,
        };
      });
    });

    /** Moves that left stock below zero (from other modules' events, or allowed by settings). `open=true` = not yet acknowledged. */
    app.get('/anomalies', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      const q = parse(z.object({ open: z.enum(['true', 'false']).optional(), itemId: s.uuid.optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }), req.query);
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select x.*, coalesce((select sum(m.qty) from stock_moves m join warehouses w on w.id = m.warehouse_id
                                where m.item_id = x.item_id and w.code = x.warehouse_code), 0) as on_hand_now
         from stock_anomalies x
         where ($1::boolean is null or (x.acknowledged_at is null) = $1) and ($2::uuid is null or x.item_id = $2)
         order by x.created_at desc limit $3`,
        [q.open === undefined ? null : q.open === 'true', q.itemId ?? null, q.limit])).rows
        .map((r) => ({ ...r, ref_th: r.ref_type ? REF_TH[r.ref_type] ?? r.ref_type : 'บันทึกเอง', source_th: r.source === 'event' ? 'จากโมดูลอื่น' : 'ผู้ใช้ (อนุญาตติดลบ)' })));
    });

    app.post('/anomalies/:id/acknowledge', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.settings.write');
      const { id } = parse(IdParam, req.params);
      const b = parse(z.object({ note: z.string().trim().min(1).max(500) }), req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const r = (await c.query(
          `update stock_anomalies set acknowledged_at = now(), acknowledged_by = $2, acknowledged_note = $3 where id = $1 and acknowledged_at is null returning *`,
          [id, a.userId, b.note])).rows[0];
        if (r) return r;
        if ((await c.query('select 1 from stock_anomalies where id = $1', [id])).rowCount) throw conflict('รายการนี้รับทราบไปแล้ว');
        throw notFound('Anomaly');
      });
    });

    /** QC quarantine log: what each inspection put on hold and what is still there. */
    app.get('/holds', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      const q = parse(z.object({ status: z.string().optional(), itemId: s.uuid.optional() }), req.query);
      const statuses = q.status ? q.status.split(',') : null;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select h.*, coalesce((select sum(m.qty) from stock_moves m join warehouses w on w.id = m.warehouse_id
                                where m.item_id = h.item_id and w.code = h.hold_warehouse_code), 0) as hold_on_hand
         from qc_holds h where ($1::text[] is null or h.status = any($1)) and ($2::uuid is null or h.item_id = $2) order by h.created_at desc limit 500`,
        [statuses, q.itemId ?? null])).rows.map(thHold));
    });

    app.get('/holds/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.stock.read');
      const { id } = parse(IdParam, req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const h = (await c.query('select * from qc_holds where id = $1', [id])).rows[0];
        if (!h) throw notFound('QC hold');
        h.log = (await c.query('select * from qc_hold_log where hold_id = $1 order by created_at, id', [id])).rows.map((r) => ({ ...r, kind_th: LOG_TH[r.kind] ?? r.kind }));
        return thHold(h);
      });
    });

    /** Release (part of) a hold back to stock after a decision (use as is / sorted / re-inspected). Needs inventory.hold.release + a note for the audit trail. */
    app.post('/holds/:id/release', async (req) => {
      const a = auth(req);
      requirePerm(a, 'inventory.hold.release');
      const { id } = parse(IdParam, req.params);
      const b = parse(ReleaseInput, req.body ?? {});
      return k.db.tx(a.tenantId, async (c) => {
        const h = (await c.query('select * from qc_holds where id = $1 for update', [id])).rows[0];
        if (!h) throw notFound('QC hold');
        if (!['pending', 'rejected'].includes(h.status) || !(Number(h.qty) > 0)) throw conflict(`ปล่อยไม่ได้: ${h.inspection_no} ${h.item_code} สถานะ ${HOLD_STATUS_TH[h.status]}`);
        const qty = b.qty ?? Number(h.qty);
        if (qty > Number(h.qty) + 1e-9) throw conflict(`ปล่อยได้ไม่เกิน ${fmtQty(h.qty)} (ที่กักไว้จาก ${h.inspection_no})`);
        const to = b.toWarehouseCode ?? h.warehouse_code;
        if ((await warehouse(c, to)).isHold) throw conflict(`คลังปลายทาง ${to} เป็นคลังกักกัน`);
        const em: Emit = (t, d) => k.emit(c, t, d);
        await transfer(em, c, { itemId: h.item_id, itemCode: h.item_code, itemName: h.item_name ?? undefined }, h.hold_warehouse_code, to, qty,
          { refType: 'qc_release', refId: h.inspection_no, note: b.note, userId: a.userId });
        await reduceHold(c, id, qty, 'released', { kind: 'release', refType: 'qc_release', refId: h.inspection_no, note: `ไป ${to}: ${b.note}`, userId: a.userId, userName: a.userName ?? null });
        return thHold((await c.query('select * from qc_holds where id = $1', [id])).rows[0]);
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
    /**
     * wave 9: a sales credit note (ใบลดหนี้) with goods returned → receive them back into the note's warehouse (auto-created).
     * Idempotent beyond the kernel's event-id de-duplication: a note already on the stock card (ref sales_note + note no.) is skipped.
     * Never throws for business reasons — debit notes, service lines and lines without a return qty are ignored.
     */
    'sales.note_issued': async (e, { client, emit }) => {
      if (e.kind !== 'credit' || !e.warehouseCode) return;
      const lines = e.lines.filter((l) => l.itemId && l.itemCode && (l.returnToStock ?? 0) > 0);
      if (!lines.length) return;
      if ((await client.query(`select 1 from stock_moves where ref_type = 'sales_note' and ref_id = $1 limit 1`, [e.noteNo])).rowCount) return;
      const note = `รับคืนจากลูกค้า ${e.customerName} ตามใบลดหนี้ ${e.noteNo} (ใบกำกับ ${e.invoiceNo}): ${e.reason}`.slice(0, 500);
      for (const l of lines) {
        await postMove(emit, client, { itemId: l.itemId!, itemCode: l.itemCode!, qty: l.returnToStock!, warehouseCode: e.warehouseCode, kind: 'receive',
          refType: 'sales_note', refId: e.noteNo, note }, { autoCreateWarehouse: true });
      }
    },
    'production.completed': async (e, { client, emit }) => {
      for (const l of e.components) await postMove(emit, client, { ...l, qty: -l.qty, warehouseCode: e.warehouseCode, kind: 'issue', refType: 'production_order', refId: e.orderNo }, { autoCreateWarehouse: true, force: true });
      await postMove(emit, client, { ...e.item, qty: e.qty, warehouseCode: e.warehouseCode, kind: 'receive', refType: 'production_order', refId: e.orderNo }, { autoCreateWarehouse: true });
    },
    'maintenance.parts_used': async (e, { client, emit }) => {
      for (const l of e.parts) await postMove(emit, client, { ...l, qty: -l.qty, warehouseCode: e.warehouseCode, kind: 'issue', refType: 'work_order', refId: e.workOrderNo }, { autoCreateWarehouse: true, force: true });
    },

    /** Setting receiveIntoHoldWhenInspected: an incoming lot waiting for QC goes into QC-HOLD until the inspection is completed. */
    'quality.inspection_created': async (e, { client, emit }) => {
      if (e.stage !== 'incoming' || !e.warehouseCode || !(e.qty > 0)) return;
      if (!(await readSettings(client)).receiveIntoHoldWhenInspected) return;
      if ((await client.query('select 1 from qc_holds where inspection_id = $1', [e.inspectionId])).rowCount) return;
      if ((await warehouse(client, e.warehouseCode, true)).isHold) return;
      const hold = await ensureHoldWarehouse(client);
      await transfer(emit, client, { itemId: e.itemId, itemCode: e.itemCode, itemName: e.itemName ?? undefined }, e.warehouseCode, hold, e.qty,
        { refType: 'qc_inspection', refId: e.no, note: 'กักรอผลตรวจรับ QC' }, true);
      await client.query(
        `insert into qc_holds (inspection_id, inspection_no, stage, item_id, item_code, item_name, lot_no, warehouse_code, hold_warehouse_code, source_ref, held_qty, qty, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,'pending')`,
        [e.inspectionId, e.no, e.stage, e.itemId, e.itemCode, e.itemName, e.lotNo, e.warehouseCode, hold, e.sourceRef, e.qty]);
    },

    /**
     * QC verdict. Lot already on hold → accepted qty goes back to its warehouse, rejected stays in QC-HOLD.
     * Not on hold → the rejected qty moves from its warehouse into QC-HOLD. Never throws: stock that is no longer there goes negative and is recorded as an anomaly.
     */
    'quality.inspection_completed': async (e, { client, emit }) => {
      if (!e.itemId || !e.warehouseCode) return; // older publisher: no location, nothing to quarantine
      const item = { itemId: e.itemId, itemCode: e.itemCode, itemName: e.itemName ?? undefined };
      const ref = { refType: 'qc_inspection', refId: e.no };
      const h = (await client.query('select * from qc_holds where inspection_id = $1 for update', [e.inspectionId])).rows[0];
      if (h) {
        if (h.status !== 'pending') return; // already judged (duplicate / replay)
        const rejected = Math.min(Math.max(e.rejectedQty, 0), Number(h.qty));
        const release = Number(h.qty) - rejected;
        if (release > 0) await transfer(emit, client, item, h.hold_warehouse_code, h.warehouse_code, release, { ...ref, note: 'QC ผ่าน ปล่อยเข้าคลัง' }, true);
        await client.query(
          `update qc_holds set qty = $2, rejected_qty = $3, status = $4, updated_at = now() where id = $1`,
          [h.id, rejected, e.rejectedQty, rejected > 0 ? 'rejected' : 'released']);
        return;
      }
      if (!(e.rejectedQty > 0)) return;
      if ((await warehouse(client, e.warehouseCode, true)).isHold) return;
      const hold = await ensureHoldWarehouse(client);
      await transfer(emit, client, item, e.warehouseCode, hold, e.rejectedQty, { ...ref, note: 'QC ไม่ผ่าน กักรอตัดสิน' }, true);
      await client.query(
        `insert into qc_holds (inspection_id, inspection_no, stage, item_id, item_code, item_name, lot_no, warehouse_code, hold_warehouse_code, source_ref,
           held_qty, qty, rejected_qty, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$11,'rejected')`,
        [e.inspectionId, e.no, e.stage, e.itemId, e.itemCode, e.itemName, e.lotNo, e.warehouseCode, hold, e.sourceRef ?? null, e.rejectedQty]);
    },

    /** Return to supplier: issue the qty from the warehouse it left from (QC-HOLD for rejected material). */
    'purchasing.goods_returned': async (e, { client, emit }) => {
      const wh = await warehouse(client, e.warehouseCode, true);
      for (const l of e.lines) {
        await postMove(emit, client, { ...l, qty: -l.qty, warehouseCode: e.warehouseCode, kind: 'issue', unitCost: l.unitPrice, refType: 'purchase_return', refId: e.returnNo,
          note: l.reason ? `ส่งคืนผู้ขาย ${e.supplierName}: ${l.reason}` : `ส่งคืนผู้ขาย ${e.supplierName}` }, { autoCreateWarehouse: true, force: true, holdManaged: wh.isHold });
        if (!wh.isHold) continue;
        // settle the QC holds of this item: rejected first (that is what goes back), then pending, oldest first
        let left = l.qty;
        const holds = (await client.query(
          `select id, qty from qc_holds where item_id = $1 and hold_warehouse_code = $2 and status in ('rejected', 'pending') and qty > 0
           order by (status = 'rejected') desc, created_at for update`,
          [l.itemId, e.warehouseCode])).rows;
        for (const h of holds) {
          if (left <= 1e-9) break;
          const take = Math.min(left, Number(h.qty));
          left -= take;
          await reduceHold(client, h.id, take, 'returned', { kind: 'return', refType: 'purchase_return', refId: e.returnNo, note: l.reason ?? null });
        }
      }
    },
  },
};
