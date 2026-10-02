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

  /* ---- office / service modules (mainly consumed by automation for LINE / in-app alerts) ---- */

  /** A request reached an approver: on submit (step 1) and each time an approval moves it to the next step. */
  'approvals.request_submitted': z.object({
    requestId: id, no: z.string(), title: z.string(), typeName: z.string(), requesterName: z.string().nullable(), amount: money.nullable(),
    nextApproverId: id, nextApproverName: z.string().nullable(), step: z.number().int().optional(), stepCount: z.number().int().optional(),
  }),
  /** Final outcome for the requester: approved (last step), rejected, or returned for edit. */
  'approvals.request_decided': z.object({
    requestId: id, no: z.string(), title: z.string(), decision: z.enum(['approved', 'rejected', 'returned']),
    requesterId: id, requesterName: z.string().nullable(), byName: z.string().nullable(), note: z.string().nullable(),
  }),

  'expense.claim_submitted': z.object({ claimId: id, no: z.string(), claimantName: z.string().nullable(), total: money, overLimit: z.boolean() }),
  'expense.claim_paid': z.object({ claimId: id, no: z.string(), claimantName: z.string().nullable(), total: money }),

  'hr.leave_requested': z.object({
    leaveId: id, no: z.string(), employeeName: z.string(), typeName: z.string(), from: z.string(), to: z.string(), days: qty,
  }),
  'hr.leave_decided': z.object({
    leaveId: id, no: z.string(), employeeName: z.string(), typeName: z.string(), decision: z.enum(['approved', 'rejected']),
  }),

  'helpdesk.ticket_created': z.object({
    ticketId: id, no: z.string(), title: z.string(), priority: z.enum(['low', 'normal', 'high', 'urgent']), categoryName: z.string().nullable(),
    requesterName: z.string().nullable(), assigneeName: z.string().nullable(),
  }),
  'helpdesk.ticket_resolved': z.object({
    ticketId: id, no: z.string(), title: z.string(), requesterName: z.string().nullable(), resolution: z.string().nullable(),
  }),

  'crm.lead_created': z.object({ leadId: id, no: z.string(), company: z.string(), contactName: z.string().nullable(), source: z.string() }),
  'crm.quotation_accepted': z.object({ quotationId: id, no: z.string(), customerName: z.string(), total: money }),

  'quality.inspection_completed': z.object({
    inspectionId: id, no: z.string(), stage: z.enum(['incoming', 'in_process', 'final']), itemCode: z.string(), itemName: z.string().nullable(),
    lotNo: z.string().nullable(), result: z.enum(['pass', 'fail', 'conditional']), rejectedQty: qty,
  }),
  'quality.ncr_raised': z.object({
    ncrId: id, no: z.string(), severity: z.enum(['minor', 'major', 'critical']), itemCode: z.string().nullable(), description: z.string(),
  }),

  'booking.requested': z.object({
    bookingId: id, no: z.string(), resourceName: z.string(), startAt: z.string(), endAt: z.string(), requesterName: z.string(), needsApproval: z.boolean(),
    /** Thai display text of the time slot, e.g. "พฤ. 2 ต.ค. 09:00–10:30" */
    period: z.string().optional(), purpose: z.string().optional(),
  }),

  'assets.repair_reported': z.object({ assetId: id, code: z.string(), name: z.string(), description: z.string() }),
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
