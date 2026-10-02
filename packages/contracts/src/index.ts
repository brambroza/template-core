/**
 * Event contracts — the ONLY coupling between modules.
 *
 * Modules never read another module's database and never call each other synchronously.
 * They publish the events below and react to the ones they care about. That is what lets a
 * customer buy any subset of modules: a missing publisher simply means the event never arrives.
 *
 * Rules (see docs/events.md):
 *  - Adding an optional field = compatible. Removing/renaming a field = new event type (e.g. `.v2`).
 *  - Event names: `<module>.<past_tense_fact>`.
 */
import { z } from 'zod';

const id = z.string().uuid();
const qty = z.number().finite();
const money = z.number().finite();

export const ItemRef = z.object({ itemId: id, itemCode: z.string(), itemName: z.string().optional() });
export type ItemRef = z.infer<typeof ItemRef>;

const ItemQty = ItemRef.extend({ qty });
const ItemQtyPrice = ItemQty.extend({ unitPrice: money });

export const events = {
  'master.item_upserted': z.object({ itemId: id, code: z.string(), name: z.string(), type: z.string(), uom: z.string() }),
  'master.partner_upserted': z.object({ partnerId: id, code: z.string(), name: z.string(), kind: z.string(), taxId: z.string().nullable() }),

  'inventory.stock_changed': z.object({
    itemId: id, itemCode: z.string(), warehouseCode: z.string(), qtyDelta: qty, onHand: qty,
    refType: z.string().nullable(), refId: z.string().nullable(),
  }),

  'inventory.low_stock': z.object({
    itemId: id, itemCode: z.string(), itemName: z.string().optional(), warehouseCode: z.string(), onHand: qty, minQty: qty,
  }),

  'purchasing.po_created': z.object({ poId: id, poNo: z.string(), supplierName: z.string(), gross: money }),
  'purchasing.po_approved': z.object({ poId: id, poNo: z.string(), supplierName: z.string(), gross: money }),

  'purchasing.goods_received': z.object({
    poId: id, poNo: z.string(), supplierId: id.nullable(), supplierName: z.string(), warehouseCode: z.string(),
    lines: z.array(ItemQtyPrice).min(1),
  }),

  'sales.order_confirmed': z.object({
    orderId: id, orderNo: z.string(), customerId: id.nullable(), customerName: z.string(), total: money,
    lines: z.array(ItemQtyPrice).min(1),
  }),
  'sales.delivered': z.object({ orderId: id, orderNo: z.string(), warehouseCode: z.string(), lines: z.array(ItemQty).min(1) }),
  'sales.invoiced': z.object({ invoiceId: id, invoiceNo: z.string(), orderId: id, net: money, vat: money, gross: money }),

  'production.completed': z.object({
    orderId: id, orderNo: z.string(), item: ItemRef, qty, warehouseCode: z.string(),
    components: z.array(ItemQty),
  }),

  'maintenance.breakdown_reported': z.object({
    workOrderId: id, workOrderNo: z.string(), machineId: id, machineCode: z.string(), machineName: z.string(), title: z.string(),
    description: z.string().nullable(),
  }),
  'maintenance.work_completed': z.object({
    workOrderId: id, workOrderNo: z.string(), machineCode: z.string(), kind: z.string(), downtimeMinutes: z.number().nullable(),
  }),

  'maintenance.parts_used': z.object({
    workOrderId: id, workOrderNo: z.string(), machineCode: z.string(), warehouseCode: z.string(),
    parts: z.array(ItemQty).min(1),
  }),
} as const;

export type EventType = keyof typeof events;
export type EventData<T extends EventType> = z.infer<(typeof events)[T]>;

export const EventEnvelope = z.object({
  id: id,
  type: z.string(),
  tenantId: id,
  source: z.string(),
  occurredAt: z.string(),
  data: z.unknown(),
});
export type EventEnvelope = z.infer<typeof EventEnvelope>;

export function isKnownEvent(type: string): type is EventType {
  return Object.prototype.hasOwnProperty.call(events, type);
}

/** Validate the data of a known event type. Throws a ZodError on mismatch. */
export function parseEvent<T extends EventType>(type: T, data: unknown): EventData<T> {
  return events[type].parse(data) as EventData<T>;
}
