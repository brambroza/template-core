import { conflict, notFound, type Client, type HandlerContext } from '@erp/kernel';

/** emit(type, data) bound to the current transaction */
export type Emit = HandlerContext['emit'];

export interface MoveInput {
  itemId: string;
  itemCode: string;
  itemName?: string;
  warehouseCode: string;
  /** signed: + into the warehouse, - out of it */
  qty: number;
  kind: 'receive' | 'issue' | 'transfer_in' | 'transfer_out' | 'adjust';
  unitCost?: number | null;
  refType?: string | null;
  refId?: string | null;
  note?: string | null;
  userId?: string | null;
}

export interface MoveOptions {
  /** create the warehouse if its code is unknown (used for events from other modules) */
  autoCreateWarehouse?: boolean;
  /**
   * Skip the negative-stock check. Used when reacting to events: the delivery/consumption already
   * happened in the real world, so we record it and let the negative balance surface in reports.
   */
  force?: boolean;
}

export async function warehouseId(c: Client, code: string, autoCreate = false): Promise<string> {
  const found = await c.query<{ id: string }>('select id from warehouses where code = $1', [code]);
  if (found.rowCount) return found.rows[0].id;
  if (!autoCreate) throw notFound(`Warehouse ${code}`);
  return (await c.query<{ id: string }>('insert into warehouses (code, name) values ($1, $1) returning id', [code])).rows[0].id;
}

export async function onHand(c: Client, itemId: string, whId: string): Promise<number> {
  const r = await c.query<{ q: number }>('select coalesce(sum(qty), 0) as q from stock_moves where item_id = $1 and warehouse_id = $2', [itemId, whId]);
  return Number(r.rows[0].q);
}

/** The single write path for stock. Every movement goes through here (and emits inventory.stock_changed). */
export async function postMove(emit: Emit, c: Client, m: MoveInput, opts: MoveOptions = {}): Promise<{ id: string; onHand: number }> {
  const whId = await warehouseId(c, m.warehouseCode, opts.autoCreateWarehouse);
  // serialize concurrent moves of the same item+warehouse
  await c.query('select pg_advisory_xact_lock(hashtext($1))', [`${m.itemId}:${whId}`]);
  const before = await onHand(c, m.itemId, whId);
  const after = before + m.qty;
  if (m.qty < 0 && after < 0 && !opts.force) {
    const allow = (await c.query('select allow_negative from settings')).rows[0]?.allow_negative ?? false;
    if (!allow) throw conflict(`สต็อกไม่พอ: ${m.itemCode} ที่คลัง ${m.warehouseCode} คงเหลือ ${before} ต้องการจ่าย ${-m.qty}`);
  }
  const row = (await c.query<{ id: string }>(
    `insert into stock_moves (item_id, item_code, item_name, warehouse_id, qty, unit_cost, kind, ref_type, ref_id, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [m.itemId, m.itemCode, m.itemName ?? null, whId, m.qty, m.unitCost ?? null, m.kind, m.refType ?? null, m.refId ?? null, m.note ?? null, m.userId ?? null],
  )).rows[0];
  await emit('inventory.stock_changed', {
    itemId: m.itemId, itemCode: m.itemCode, warehouseCode: m.warehouseCode, qtyDelta: m.qty, onHand: after,
    refType: m.refType ?? null, refId: m.refId ?? null,
  });
  // publish once when stock crosses below the reorder point (not on every move while already low)
  if (m.qty < 0) {
    const rp = (await c.query<{ min_qty: number }>('select min_qty from reorder_points where item_id = $1 and warehouse_code = $2', [m.itemId, m.warehouseCode])).rows[0];
    if (rp && before >= rp.min_qty && after < rp.min_qty) {
      await emit('inventory.low_stock', { itemId: m.itemId, itemCode: m.itemCode, itemName: m.itemName, warehouseCode: m.warehouseCode, onHand: after, minQty: rp.min_qty });
    }
  }
  return { id: row.id, onHand: after };
}
