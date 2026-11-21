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
/** `exclusive` = prices before VAT, `inclusive` = prices include VAT */
const VatMode = z.enum(['exclusive', 'inclusive']);

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

  /** optional `createdById`: who raised it (automation does not send them an approve button — they may not approve their own PO) */
  'purchasing.po_created': z.object({ poId: id, poNo: z.string(), supplierName: z.string(), gross: money, createdById: id.nullable().optional() }),
  'purchasing.po_approved': z.object({ poId: id, poNo: z.string(), supplierName: z.string(), gross: money }),

  'purchasing.goods_received': z.object({
    poId: id, poNo: z.string(), supplierId: id.nullable(), supplierName: z.string(), warehouseCode: z.string(),
    /** `vatRate` optional (wave 5): VAT rate of the line as a fraction (0.07; 0 = exempt) */
    lines: z.array(ItemQtyPrice.extend({ vatRate: z.number().min(0).max(1).optional() })).min(1),
    /**
     * optional (wave 5): how `unitPrice` relates to VAT (PO's mode) and this receipt's totals — lets accounting split stock (net) from ภาษีซื้อ (vat).
     * Without them the receipt is booked at Σ qty × unitPrice with no VAT split.
     */
    vatMode: VatMode.optional(), net: money.optional(), vat: money.optional(), gross: money.optional(), receivedDate: z.string().optional(),
    /** optional (wave 8, C8): the supplier's tax invoice that came with the goods — for the purchase VAT register (ภาษีซื้อ) */
    supplierInvoiceNo: z.string().nullable().optional(), supplierInvoiceDate: z.string().nullable().optional(),
    supplierTaxId: z.string().nullable().optional(), supplierBranch: z.string().nullable().optional(),
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
    /** optional (wave 5): the tax-invoice date (accounting posts on it) and the order's VAT mode */
    issueDate: z.string().optional(), vatMode: VatMode.optional(),
    /** optional (wave 8, C7): the buyer's tax ID and branch printed on the tax invoice — for the sales VAT register (ภาษีขาย) */
    customerTaxId: z.string().nullable().optional(), customerBranch: z.string().nullable().optional(),
    /**
     * optional (wave 8, C2): deposits (มัดจำ) whose VAT was already charged on a deposit tax invoice and are deducted on this invoice.
     * Then `net`/`vat`/`gross` are this invoice's own base / output VAT / amount due (after the deduction); the goods' full value is
     * `net + depositApplied.net`. Accounting: Dr AR gross + Dr เงินมัดจำรับ depositApplied.net / Cr revenue (net + depositApplied.net) / Cr ภาษีขาย vat.
     */
    depositApplied: z.object({
      net: money, vat: money, gross: money,
      deposits: z.array(z.object({ depositId: id, depositNo: z.string(), taxInvoiceNo: z.string().nullable(), net: money, vat: money, gross: money })),
    }).optional(),
    /** optional (wave 9, e-Tax): the invoice's printed lines and the buyer's address — lets an e-Tax module build the XML without reading sales' tables */
    lines: z.array(z.object({
      itemId: id.nullable(), itemCode: z.string().nullable(), description: z.string(), qty, uom: z.string().nullable().optional(),
      unitPrice: money, discount: money.optional(), amount: money, vatRate: z.number().min(0).max(1),
    })).optional(),
    customerAddress: z.string().nullable().optional(), customerEmail: z.string().nullable().optional(),
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
  'expense.claim_paid': z.object({
    claimId: id, no: z.string(), claimantName: z.string().nullable(), total: money, /** optional (wave 4): claimant's user id */ claimantId: id.optional(),
    /** optional (wave 5): when / how it was paid and what was claimed — accounting maps each category to an expense account and posts input VAT */
    paidDate: z.string().optional(), payMethod: z.enum(['transfer', 'cash', 'cheque']).optional(), department: z.string().nullable().optional(),
    lines: z.array(z.object({
      categoryCode: z.string(), categoryName: z.string(), amount: money, vat: money, description: z.string().nullable().optional(),
      /**
       * optional (wave 8, C3): false = the VAT is not creditable (ภาษีซื้อต้องห้าม category, abbreviated/no tax invoice, no seller tax ID) — post it into
       * the expense, not ภาษีซื้อ. Absent = claimable (old payloads). C7: the seller's tax invoice for the purchase VAT register.
       */
      vatClaimable: z.boolean().optional(), receiptType: z.enum(['full_tax_invoice', 'abbreviated', 'none']).nullable().optional(), expenseDate: z.string().optional(),
      vendorName: z.string().nullable().optional(), vendorTaxId: z.string().nullable().optional(), vendorBranch: z.string().nullable().optional(), receiptNo: z.string().nullable().optional(),
    })).optional(),
    /** optional (wave 5): cash advance cleared by this claim (ADV-…) — `total − advanceAmount` was paid now */
    advanceNo: z.string().nullable().optional(), advanceAmount: money.optional(),
  }),

  'hr.leave_requested': z.object({
    leaveId: id, no: z.string(), employeeName: z.string(), typeName: z.string(), from: z.string(), to: z.string(), days: qty,
    /** optional (wave 4): the employee's login, and the manager (org chart) who should approve — null = HR */
    employeeUserId: id.nullable().optional(), approverUserId: id.nullable().optional(), approverName: z.string().nullable().optional(),
  }),
  'hr.leave_decided': z.object({
    leaveId: id, no: z.string(), employeeName: z.string(), typeName: z.string(), decision: z.enum(['approved', 'rejected']),
    /** optional (wave 4): the employee's login (to alert them personally) and who decided */
    employeeUserId: id.nullable().optional(), byName: z.string().nullable().optional(), note: z.string().nullable().optional(),
    /**
     * optional (wave 5): for payroll — the employee (HR id + code), the leave period and working days, whether the leave type is unpaid
     * (ลาไม่รับค่าจ้าง) and the working days per calendar month (`YYYY-MM`) so a leave crossing a month end lands in the right pay run.
     */
    employeeId: id.optional(), employeeCode: z.string().optional(), from: z.string().optional(), to: z.string().optional(), days: qty.optional(),
    unpaid: z.boolean().optional(), byMonth: z.array(z.object({ period: z.string(), days: qty })).optional(),
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
    /** optional (wave 5): VAT mode of the PO and the return's totals (the credit note to ask for) — accounting reverses ภาษีซื้อ when present */
    vatMode: VatMode.optional(), net: money.optional(), vat: money.optional(), gross: money.optional(), returnDate: z.string().optional(),
  }),

  /* ---- wave 4: receipts & receivables (sales) ---- */

  /** A receipt (RC-2569-0001) was issued: `payment` settles invoices (amount incl. WHT and deposits used), `deposit` = money received in advance. */
  'sales.payment_received': z.object({
    receiptId: id, receiptNo: z.string(), kind: z.enum(['payment', 'deposit']), customerId: id.nullable(), customerName: z.string(),
    /** the receipt's own date (YYYY-MM-DD, Thai calendar day) — Accounting posts cash / WHT / AR on it (bugs-0.4 ACC-01); absent in old payloads */
    receiptDate: z.string().optional(),
    method: z.enum(['cash', 'transfer', 'cheque', 'card']), total: money, whtAmount: money, depositApplied: money, received: money,
    invoices: z.array(z.object({ invoiceId: id, invoiceNo: z.string(), amount: money, outstanding: money })),
    /**
     * optional (wave 8, C2) — deposits only: a deposit is a tax point (§78(1)(ข)). `vat` = output VAT on the deposit tax invoice
     * `taxInvoiceNo` (DT-2569-0001), `net` = its tax base (`net + vat = total`); `vat` 0 / absent = deposit with no VAT (old payloads, or not part of the price).
     */
    net: money.optional(), vat: money.optional(), taxInvoiceNo: z.string().nullable().optional(),
    /** optional (wave 8, C4) — payments with WHT: the income the customer withheld on (ฐานเงินได้, before VAT; services only on a mixed invoice) */
    whtBase: money.optional(),
    /** optional (wave 8): the customer's tax ID / branch for the output VAT register */
    customerTaxId: z.string().nullable().optional(), customerBranch: z.string().nullable().optional(),
  }),

  /* ---- wave 4: service contracts / MA (contracts) ---- */

  /** A PM visit (PMV-2569-0001) was generated from an active MA contract — alert the technician / auto-create a PM ticket. */
  'contracts.visit_due': z.object({
    visitId: id, no: z.string(), contractId: id, contractNo: z.string(), customerId: id.nullable(), customerName: z.string(),
    dueDate: z.string(), scheduledDate: z.string(), technicianId: id.nullable(), technicianName: z.string().nullable(),
    /** covered equipment / sites as one line of text, e.g. "CCTV 32 จุด (อาคาร A) · NVR SN123" */
    itemsText: z.string().nullable(), coverage: z.enum(['8x5', '24x7']),
  }),
  /** An active MA contract ends within the notice window and has not been renewed (at most once per contract per month). */
  'contracts.contract_expiring': z.object({
    contractId: id, no: z.string(), customerId: id.nullable(), customerName: z.string(), title: z.string(),
    endDate: z.string(), daysLeft: z.number().int(), value: money,
  }),

  /* ---- payroll ---- */

  /**
   * A payroll run (PR-2569-10) was paid. Company totals only — no per-employee data. `postings` is a balanced
   * debit/credit list per account category (salary_expense, overtime_expense, allowance_expense, bonus_expense, other_income_expense,
   * sso_employer_expense, pvd_employer_expense / sso_payable, wht_payable, pvd_payable, employee_deductions, net_pay_payable)
   * that accounting maps to its chart of accounts.
   */
  'payroll.run_paid': z.object({
    runId: id, no: z.string(), period: z.string(), payDate: z.string(), paidDate: z.string(), headcount: z.number().int(),
    totals: z.object({
      gross: money, salary: money, overtime: money, allowances: money, bonus: money, otherIncome: money, unpaidLeave: money,
      ssoEmployee: money, ssoEmployer: money, pvdEmployee: money, pvdEmployer: money, wht: money, otherDeductions: money, totalDeductions: money, net: money,
    }),
    postings: z.array(z.object({ category: z.string(), side: z.enum(['debit', 'credit']), amount: money })),
  }),

  /* ---- wave 5: one system (HR → payroll, contracts → helpdesk / sales) ---- */

  /**
   * An employee was created or changed in HR (incl. confirm / resign). Snapshot only — no salary, no national ID.
   * Payroll keeps its pay profile in sync (code, name, department, position, dates, login); `status` resigned + `resignedDate` = last working day.
   */
  'hr.employee_upserted': z.object({
    employeeId: id, code: z.string(), name: z.string(), departmentName: z.string().nullable(), positionName: z.string().nullable(),
    status: z.enum(['active', 'probation', 'resigned']), startDate: z.string(), resignedDate: z.string().nullable(), userId: id.nullable(),
  }),
  /**
   * An MA contract installment is due to be invoiced (`POST /billing/due/notify`, once per installment). Amount is before VAT.
   * Sales drafts a service sales order (ref = contract no + installment) for billing staff to confirm and invoice.
   */
  'contracts.installment_due': z.object({
    installmentId: id, contractId: id, contractNo: z.string(), title: z.string(), customerId: id.nullable(), customerCode: z.string().nullable(), customerName: z.string(),
    seq: z.number().int(), count: z.number().int(), dueDate: z.string(), amount: money,
    billingPlan: z.enum(['one_time', 'monthly', 'quarterly', 'yearly']), periodFrom: z.string().nullable(), periodTo: z.string().nullable(),
  }),

  /* ---- wave 8: period lock (accounting → sales / purchasing / expense) ---- */

  /** An accounting period (YYYY-MM) was closed. Modules that issue posting documents move their lock date forward to `lastDate`. */
  'accounting.period_closed': z.object({ period: z.string(), lastDate: z.string(), closedByName: z.string().nullable().optional() }),
  /** A closed period was reopened: a lock date that came from Accounting steps back to the day before `firstDate`. */
  'accounting.period_reopened': z.object({ period: z.string(), firstDate: z.string(), reopenedByName: z.string().nullable().optional() }),

  /* ---- wave 9: credit/debit notes, supplier bills & WHT paid, e-Tax, token revocation ---- */

  /**
   * A credit note (ใบลดหนี้ CN-2569-0001, §86/10) or debit note (ใบเพิ่มหนี้ DN-2569-0001, §86/9) was issued against a tax invoice.
   * `net`/`vat`/`gross` are the DIFFERENCE (always positive; `kind` gives the direction). `originalNet` / `correctNet` are the values
   * printed on the note. Lines with `returnToStock` > 0 put goods back into `warehouseCode` (credit notes only).
   * Accounting: credit → Dr sales returns/revenue net + Dr ภาษีขาย vat / Cr AR gross; debit → the reverse. The VAT register records it in the note's month.
   */
  'sales.note_issued': z.object({
    noteId: id, noteNo: z.string(), kind: z.enum(['credit', 'debit']), issueDate: z.string(),
    invoiceId: id, invoiceNo: z.string(), invoiceDate: z.string(),
    customerId: id.nullable(), customerName: z.string(), customerTaxId: z.string().nullable().optional(), customerBranch: z.string().nullable().optional(),
    reason: z.string(), originalNet: money, correctNet: money, net: money, vat: money, gross: money,
    warehouseCode: z.string().nullable().optional(),
    lines: z.array(z.object({
      itemId: id.nullable(), itemCode: z.string().nullable(), description: z.string(), qty, unitPrice: money, amount: money,
      returnToStock: qty.optional(),
    })),
  }),

  /** A supplier's tax invoice / bill was recorded (ตั้งหนี้). Accounting: Dr expense-or-GRNI net + Dr ภาษีซื้อ vat (when claimable) / Cr AP gross. */
  'purchasing.bill_recorded': z.object({
    billId: id, billNo: z.string(), billDate: z.string(), dueDate: z.string().nullable().optional(),
    supplierId: id.nullable(), supplierCode: z.string().nullable(), supplierName: z.string(), supplierTaxId: z.string().nullable(), supplierBranch: z.string().nullable().optional(),
    supplierInvoiceNo: z.string().nullable(), supplierInvoiceDate: z.string().nullable(),
    /** `goods` = against a PO whose receipt was already booked (clears GRNI, VAT only); `service`/`expense` = book the cost now */
    kind: z.enum(['goods', 'service', 'expense']), poId: id.nullable().optional(), poNo: z.string().nullable().optional(),
    net: money, vat: money, gross: money, vatClaimable: z.boolean(),
  }),

  /**
   * A supplier payment (PV-2569-0001) was made. `wht` lists the tax withheld per income type (one 50 ทวิ certificate per payment),
   * `form` = PND3 (individual) or PND53 (juristic person). Accounting: Dr AP gross / Cr bank netPaid / Cr ภาษีหัก ณ ที่จ่ายค้างจ่าย Σwht.amount.
   */
  'purchasing.supplier_paid': z.object({
    paymentId: id, paymentNo: z.string(), paymentDate: z.string(), method: z.enum(['cash', 'transfer', 'cheque']),
    supplierId: id.nullable(), supplierName: z.string(), supplierTaxId: z.string().nullable(),
    bills: z.array(z.object({ billId: id, billNo: z.string(), amount: money })),
    gross: money, netPaid: money,
    wht: z.array(z.object({ form: z.enum(['PND3', 'PND53']), incomeType: z.string(), description: z.string(), rate: z.number().min(0).max(1), base: money, amount: money, certificateNo: z.string() })),
  }),

  /**
   * Every token issued to `userId` before `before` (epoch seconds) must be refused (logout everywhere, password change,
   * user disabled, roles changed). Every module's kernel subscribes automatically.
   */
  'identity.tokens_revoked': z.object({ userId: id, before: z.number().int(), reason: z.enum(['logout', 'password_changed', 'user_disabled', 'roles_changed', 'admin']) }),

  /**
   * A linked LINE user pressed "อนุมัติ" (and confirmed) on a decision card automation pushed to them. The owning module decides
   * as that user with its own rules (current approver / delegate / own request…). `perms` = the user's permissions as last seen
   * by automation on a valid token at `permsAt` (epoch seconds): refuse when the user's revocation cutoff is later (roles changed,
   * logged out everywhere, disabled) or when `perms` lacks the module's approve permission.
   */
  'automation.line_decision': z.object({
    lineActionId: id, userId: id, userName: z.string().nullable(), perms: z.array(z.string()), permsAt: z.number().int(),
    target: z.enum(['approvals.request', 'hr.leave', 'purchasing.po', 'expense.claim']), entityId: id, decision: z.literal('approved'),
  }),
  /** The outcome of an `automation.line_decision`, in Thai for the person who pressed the button (automation pushes it to their LINE). */
  'approvals.line_decision_result': z.object({ lineActionId: id, userId: id, ok: z.boolean(), message: z.string() }),
  'hr.line_decision_result': z.object({ lineActionId: id, userId: id, ok: z.boolean(), message: z.string() }),
  'purchasing.line_decision_result': z.object({ lineActionId: id, userId: id, ok: z.boolean(), message: z.string() }),
  'expense.line_decision_result': z.object({ lineActionId: id, userId: id, ok: z.boolean(), message: z.string() }),
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
