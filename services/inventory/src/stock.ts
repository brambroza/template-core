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
  /**
   * The caller keeps `qc_holds` in step itself (hold release, QC verdict, return to supplier). Otherwise a move out of a hold warehouse
   * reduces that item's holds there (rejected first, oldest first) so the hold list never shows more than is on hand, and logs it.
   */
  holdManaged?: boolean;
  /** how such an automatic hold reduction is logged: `override` = admin forced it out with a reason, `external` (default) = another module's document */
  holdLog?: { kind: 'override' | 'external'; userName?: string | null };
}

/** Code of the quarantine warehouse that QC holds go to (auto-created per tenant, flagged `is_hold`). */
export const HOLD_WAREHOUSE = 'QC-HOLD';

export async function warehouseId(c: Client, code: string, autoCreate = false): Promise<string> {
  return (await warehouse(c, code, autoCreate)).id;
}

export async function warehouse(c: Client, code: string, autoCreate = false): Promise<{ id: string; isHold: boolean }> {
  const found = await c.query<{ id: string; is_hold: boolean }>('select id, is_hold from warehouses where code = $1', [code]);
  if (found.rowCount) return { id: found.rows[0].id, isHold: found.rows[0].is_hold };
  if (!autoCreate) throw notFound(`Warehouse ${code}`);
  const isHold = code === HOLD_WAREHOUSE;
  const row = (await c.query<{ id: string }>(
    `insert into warehouses (code, name, is_hold) values ($1, $2, $3)
     on conflict (tenant_id, code) do update set code = excluded.code returning id`, [code, isHold ? 'คลังกักกัน QC (รอตัดสิน)' : code, isHold])).rows[0];
  return { id: row.id, isHold };
}

/** The tenant's QC-HOLD warehouse, created (and flagged as hold) on first use. */
export async function ensureHoldWarehouse(c: Client): Promise<string> {
  const id = await warehouseId(c, HOLD_WAREHOUSE, true);
  await c.query('update warehouses set is_hold = true where id = $1 and not is_hold', [id]);
  return HOLD_WAREHOUSE;
}

/** Thai number for messages: 12763.5 -> "12,763.5" (at most 4 decimals). */
export const fmtQty = (n: number) => Number(n).toLocaleString('en-US', { maximumFractionDigits: 4 });

export async function onHand(c: Client, itemId: string, whId: string): Promise<number> {
  const r = await c.query<{ q: number }>('select coalesce(sum(qty), 0) as q from stock_moves where item_id = $1 and warehouse_id = $2', [itemId, whId]);
  return Number(r.rows[0].q);
}

/** The single write path for stock. Every movement goes through here (and emits inventory.stock_changed). */
export async function postMove(emit: Emit, c: Client, m: MoveInput, opts: MoveOptions = {}): Promise<{ id: string; onHand: number }> {
  const wh = await warehouse(c, m.warehouseCode, opts.autoCreateWarehouse);
  const whId = wh.id;
  // serialize concurrent moves of the same item+warehouse
  await c.query('select pg_advisory_xact_lock(hashtext($1))', [`${m.itemId}:${whId}`]);
  const before = await onHand(c, m.itemId, whId);
  const after = before + m.qty;
  if (m.qty < 0 && after < 0 && !opts.force) {
    const allow = (await c.query('select allow_negative from settings')).rows[0]?.allow_negative ?? false;
    if (!allow) {
      throw conflict(`สต็อกไม่พอ: ${m.itemCode} ที่คลัง ${m.warehouseCode} คงเหลือ ${fmtQty(before)} ต้องการจ่าย ${fmtQty(-m.qty)} (ขาด ${fmtQty(-after)}${m.itemName ? ` · ${m.itemName}` : ''}) — ตรวจว่าเลือกคลังถูกต้อง หรือรับของเข้าก่อน`);
    }
  }
  const row = (await c.query<{ id: string }>(
    `insert into stock_moves (item_id, item_code, item_name, warehouse_id, qty, unit_cost, kind, ref_type, ref_id, note, created_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id`,
    [m.itemId, m.itemCode, m.itemName ?? null, whId, m.qty, m.unitCost ?? null, m.kind, m.refType ?? null, m.refId ?? null, m.note ?? null, m.userId ?? null],
  )).rows[0];
  // never silent: every move that leaves the balance below zero is recorded as an anomaly (event-driven or allowed by settings)
  if (m.qty < 0 && after < 0) {
    await c.query(
      `insert into stock_anomalies (item_id, item_code, item_name, warehouse_code, qty_delta, on_hand_before, on_hand_after, ref_type, ref_id, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [m.itemId, m.itemCode, m.itemName ?? null, m.warehouseCode, m.qty, before, after, m.refType ?? null, m.refId ?? null, opts.force ? 'event' : 'user']);
  }
  if (m.qty < 0 && wh.isHold && !opts.holdManaged) {
    await trimHolds(c, m.itemId, m.warehouseCode, after, {
      kind: opts.holdLog?.kind ?? 'external', refType: m.refType ?? null, refId: m.refId ?? null, note: m.note ?? null, userId: m.userId ?? null, userName: opts.holdLog?.userName ?? null,
    });
  }
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

export type HoldLogKind = 'release' | 'return' | 'override' | 'external';
export interface HoldLogEntry { kind: HoldLogKind; refType?: string | null; refId?: string | null; note?: string | null; userId?: string | null; userName?: string | null }

const HOLD_LOG_TH: Record<HoldLogKind, string> = { release: 'ปล่อย', return: 'ส่งคืน', override: 'บังคับจ่ายออก', external: 'ตัดออกโดยเอกสารอื่น' };

/** Reduce one hold by `qty` (never below 0), set its status when emptied, and write the log row + the Thai note trail. */
export async function reduceHold(c: Client, holdId: string, qty: number, emptyStatus: 'released' | 'returned' | 'forced_out', e: HoldLogEntry): Promise<void> {
  const h = (await c.query('update qc_holds set qty = greatest(qty - $2::numeric, 0), status = case when qty - $2::numeric <= 0 then $3 else status end, ' +
    `note = concat_ws(' · ', note, $4::text), updated_at = now() where id = $1 returning qty`,
  [holdId, qty, emptyStatus, `${HOLD_LOG_TH[e.kind]} ${fmtQty(qty)}${e.refId ? ` (${e.refId})` : ''}${e.note ? `: ${e.note}` : ''}`])).rows[0];
  await c.query(
    `insert into qc_hold_log (hold_id, kind, qty, qty_after, ref_type, ref_id, note, user_id, user_name) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [holdId, e.kind, qty, h.qty, e.refType ?? null, e.refId ?? null, e.note ?? null, e.userId ?? null, e.userName ?? null]);
}

/**
 * Keep the hold list consistent with the stock: when the item's open holds in this hold warehouse add up to more than is on hand now,
 * reduce them (rejected first, then pending, oldest first) by the difference — status `forced_out` when emptied — and log each change.
 */
export async function trimHolds(c: Client, itemId: string, holdCode: string, onHandNow: number, e: HoldLogEntry): Promise<number> {
  const holds = (await c.query<{ id: string; qty: number }>(
    `select id, qty from qc_holds where item_id = $1 and hold_warehouse_code = $2 and status in ('pending', 'rejected') and qty > 0
     order by (status = 'rejected') desc, created_at for update`, [itemId, holdCode])).rows;
  let excess = holds.reduce((t, h) => t + Number(h.qty), 0) - Math.max(onHandNow, 0);
  let trimmed = 0;
  for (const h of holds) {
    if (excess <= 1e-9) break;
    const take = Math.min(excess, Number(h.qty));
    await reduceHold(c, h.id, take, 'forced_out', e);
    excess -= take;
    trimmed += take;
  }
  return trimmed;
}
