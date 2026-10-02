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
    /** stock-item lines only — empty for a service-only order (wave 4: service lines carry no itemId) */
    lines: z.array(ItemQtyPrice),
  }),
  'sales.delivered': z.object({ orderId: id, orderNo: z.string(), warehouseCode: z.string(), lines: z.array(ItemQty).min(1) }),
  'sales.invoiced': z.object({
    invoiceId: id, invoiceNo: z.string(), orderId: id, net: money, vat: money, gross: money,
    /** optional (wave 4) */
    customerId: id.nullable().optional(), customerName: z.string().optional(), dueDate: z.string().optional(),
  }),

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
    /** optional (wave 4): who raised it, and who stands in for the approver today (delegation) — for per-user alerts */
    requesterId: id.optional(), delegateId: id.optional(), delegateName: z.string().nullable().optional(),
  }),
  /** Final outcome for the requester: approved (last step), rejected, or returned for edit. */
  'approvals.request_decided': z.object({
    requestId: id, no: z.string(), title: z.string(), decision: z.enum(['approved', 'rejected', 'returned']),
    requesterId: id, requesterName: z.string().nullable(), byName: z.string().nullable(), note: z.string().nullable(),
  }),

  'expense.claim_submitted': z.object({ claimId: id, no: z.string(), claimantName: z.string().nullable(), total: money, overLimit: z.boolean(), /** optional (wave 4): claimant's user id */ claimantId: id.optional() }),
  'expense.claim_paid': z.object({ claimId: id, no: z.string(), claimantName: z.string().nullable(), total: money, /** optional (wave 4): claimant's user id */ claimantId: id.optional() }),

  'hr.leave_requested': z.object({
    leaveId: id, no: z.string(), employeeName: z.string(), typeName: z.string(), from: z.string(), to: z.string(), days: qty,
    /** optional (wave 4): the employee's login, and the manager (org chart) who should approve — null = HR */
    employeeUserId: id.nullable().optional(), approverUserId: id.nullable().optional(), approverName: z.string().nullable().optional(),
  }),
  'hr.leave_decided': z.object({
    leaveId: id, no: z.string(), employeeName: z.string(), typeName: z.string(), decision: z.enum(['approved', 'rejected']),
    /** optional (wave 4): the employee's login (to alert them personally) and who decided */
    employeeUserId: id.nullable().optional(), byName: z.string().nullable().optional(), note: z.string().nullable().optional(),
  }),

  'helpdesk.ticket_created': z.object({
    ticketId: id, no: z.string(), title: z.string(), priority: z.enum(['low', 'normal', 'high', 'urgent']), categoryName: z.string().nullable(),
    requesterName: z.string().nullable(), assigneeName: z.string().nullable(),
  }),
  'helpdesk.ticket_resolved': z.object({
    ticketId: id, no: z.string(), title: z.string(), requesterName: z.string().nullable(), resolution: z.string().nullable(),
    /** optional (wave 4): the requester's user id when the ticket was raised by a logged-in user */
    requesterUserId: id.nullable().optional(),
  }),

  'crm.lead_created': z.object({ leadId: id, no: z.string(), company: z.string(), contactName: z.string().nullable(), source: z.string() }),
  'crm.quotation_accepted': z.object({
    quotationId: id, no: z.string(), customerName: z.string(), total: money,
    /** optional (wave 4): customer snapshot + lines so Sales can draft the order without retyping */
    partnerId: id.nullable().optional(), customerTaxId: z.string().nullable().optional(), customerBranch: z.string().nullable().optional(),
    customerAddress: z.string().nullable().optional(), opportunityId: id.nullable().optional(),
    vatMode: z.enum(['exclusive', 'inclusive']).optional(), subtotal: money.optional(), discount: money.optional(), net: money.optional(), vat: money.optional(),
    lines: z.array(z.object({
      itemId: id.nullable(), itemCode: z.string().nullable(), itemName: z.string().nullable(), description: z.string().nullable().optional(),
      qty, unitPrice: money, discountPct: z.number().min(0).max(100), amount: money.optional(),
    })).optional(),
  }),

  'quality.inspection_completed': z.object({
    inspectionId: id, no: z.string(), stage: z.enum(['incoming', 'in_process', 'final']), itemCode: z.string(), itemName: z.string().nullable(),
    lotNo: z.string().nullable(), result: z.enum(['pass', 'fail', 'conditional']), rejectedQty: qty,
    /** optional (wave 4): where the lot sits and how much of it — lets Inventory move rejected qty into quarantine (QC-HOLD) */
    itemId: id.optional(), warehouseCode: z.string().nullable().optional(), qty: qty.optional(), acceptedQty: qty.optional(),
    sourceType: z.string().optional(), sourceRef: z.string().nullable().optional(),
  }),
  'quality.ncr_raised': z.object({
    ncrId: id, no: z.string(), severity: z.enum(['minor', 'major', 'critical']), itemCode: z.string().nullable(), description: z.string(),
  }),

  'booking.requested': z.object({
    bookingId: id, no: z.string(), resourceName: z.string(), startAt: z.string(), endAt: z.string(), requesterName: z.string(), needsApproval: z.boolean(),
    /** Thai display text of the time slot, e.g. "พฤ. 2 ต.ค. 09:00–10:30" */
    period: z.string().optional(), purpose: z.string().optional(),
    /** optional (wave 4): the booker's user id */
    requesterId: id.optional(),
  }),

  'assets.repair_reported': z.object({ assetId: id, code: z.string(), name: z.string(), description: z.string() }),

  /* ---- wave 4: QC quarantine + return to supplier ---- */

  /** A QC inspection was opened (from a goods receipt, a production completion or by hand). Inventory may quarantine the lot until it is judged. */
  'quality.inspection_created': z.object({
    inspectionId: id, no: z.string(), stage: z.enum(['incoming', 'in_process', 'final']), itemId: id, itemCode: z.string(), itemName: z.string().nullable(),
    lotNo: z.string().nullable(), warehouseCode: z.string().nullable(), qty, sourceType: z.string(), sourceRef: z.string().nullable(),
  }),
  /** Goods sent back to the supplier against a PO (RT-2569-0001). Inventory issues the qty from `warehouseCode`. */
  'purchasing.goods_returned': z.object({
    returnId: id, returnNo: z.string(), poId: id, poNo: z.string(), supplierId: id.nullable(), supplierName: z.string(), warehouseCode: z.string(),
    lines: z.array(ItemQtyPrice.extend({ reason: z.string().nullable().optional() })).min(1),
  }),

  /* ---- wave 4: receipts & receivables (sales) ---- */

  /** A receipt (RC-2569-0001) was issued: `payment` settles invoices (amount incl. WHT and deposits used), `deposit` = money received in advance. */
  'sales.payment_received': z.object({
    receiptId: id, receiptNo: z.string(), kind: z.enum(['payment', 'deposit']), customerId: id.nullable(), customerName: z.string(),
    method: z.enum(['cash', 'transfer', 'cheque', 'card']), total: money, whtAmount: money, depositApplied: money, received: money,
    invoices: z.array(z.object({ invoiceId: id, invoiceNo: z.string(), amount: money, outstanding: money })),
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
