# sales — Sales (ขาย) · feature

Sales orders → delivery → Thai tax invoice → credit / debit notes → receipts / deposits → receivables & aging.

## Flow
`draft` → confirm → `confirmed` → deliver → `delivered` → invoice → `invoiced` (invoice also allowed from `confirmed`). `draft|confirmed` → `cancelled`.
Invoice payment status (computed): `outstanding` → `partially_paid` → `paid` (from `paid_amount` vs billed = `gross + debit_total − credit_total`); `credited` = billed ≤ 0 with nothing paid.

## Data
- `sales_orders` (`SO-2569-0001`, customer snapshot incl. tax ID/branch/address, `subtotal`/`discount`/`net`/`vat`/`gross`, `ref` (customer PO / quotation no., searchable),
  `quotation_id` (unique — one order per accepted quotation), `credit_days`)
- `so_lines` (`discount_pct`, `description`; `item_id`/`item_code` null = service line, never issued from stock)
- `invoices` (`INV-2569-0001`, one per order, `due_date` = issue date + order `credit_days` unless given, `paid_amount`)
- `receipts` (`RC-2569-0001`; `kind` `payment` | `deposit`; customer snapshot; `method` `cash|transfer|cheque|card`, `reference`;
  `total` (settled incl. WHT and deposits used / deposit amount), `wht_pct`, `wht_amount`, `deposit_applied`, `received` (cash now),
  `deposit_remaining` (deposits only), `created_by_name` from the token) · `receipt_lines` (invoice, `amount`, `wht_base`) · `deposit_applications`
  (migration 004: either `receipt_id` (non-VAT deposit used on a receipt) or `invoice_id`/`invoice_no` (VAT deposit deducted on a tax invoice), with `net`/`vat`)
- migration 004 (wave 8, C2): deposits `vat_mode` (`inclusive`|`exclusive`|`none`; old rows `none`), `net`, `vat`, `tax_invoice_no` (`DT-2569-0001`), `deposit_vat_remaining`;
  invoices `deposit_net`/`deposit_vat`/`deposit_gross` (deducted deposits — `net`/`vat`/`gross` stay this invoice's own base / VAT / amount due)
- lock date: kernel table `_lock_date` (see packages/kernel `lock.ts`)
- migration 005 (wave 9): `sales_notes` (`CN-2569-0001` credit / `DN-2569-0001` debit; invoice no./date, buyer snapshot, `reason_code` + `reason_text` → printed
  `reason`, `vat_mode`/`vat_rate` of the invoice, `original_net`, `correct_net`, difference `net`/`vat`/`gross` (always positive), `warehouse_code` for returns,
  `created_by_name`) · `sales_note_lines` (`invoice_line_no`, item snapshot, `description`, `qty`, `unit_price`, `amount`, `return_to_stock`) ·
  invoices `credit_total` / `debit_total` (gross of the notes; check `paid_amount <= gross + debit_total` replaces `paid_amount <= gross`) ·
  sales_orders `customer_email` (from the partner lookup; carried on `sales.invoiced`)

## Behaviour
- Totals: line amount = qty × unit price × (1 − discount %); VAT via `documentTotals` — the same arithmetic as CRM quotations, so an order drafted from a quote matches it to the satang.
- `sales.order_confirmed` carries stock lines only (may be empty); `sales.delivered` is skipped when an order has no stock lines.
- Receipt (`payment`): lines `[{ invoiceId, amount }]` (amount incl. VAT); all invoices must belong to one customer (partner id when both have one, else name) — customer defaults to the first invoice's.
  `amount` > outstanding → 400. WHT (`whtPct` 0|1|2|3|5) = pct × Σ `wht_base` of the lines, rounded to satang. **C4**: per line `whtBase` (the income on the
  customer's 50 ทวิ, before VAT) may be typed; default = pre-VAT part of the amount (`amount × net / gross`) × the order's **service share** (Σ amount of lines
  without a stock item ÷ Σ all lines; an order with no service line → the whole pre-VAT part). Goods 5,000 + service 10,000 paid in full → base 10,000 → 3% = 300.
  `whtBase` > pre-VAT part → 400. The event carries `whtBase` when WHT > 0.
  `deposits [{ depositId, amount? }]` (or form shorthand `applyDepositId` + `applyDepositAmount?`) reduce cash due; no amount = as much as remains and is due.
  `received = total − wht − deposits` must be ≥ 0 (else 400).
- Deposit (`depositAmount`, optional `orderId` → customer from the order): no invoice, no WHT (record WHT when it is applied), `deposit_remaining` until used.
  **VAT on deposits (wave 8, C2, §78(1)(ข))**: a deposit that is part of the price is a tax point. `depositVatMode` `inclusive` (default — `depositAmount` is the money
  received, VAT inside: 99,670.50 → base 93,150.00 + VAT 6,520.50) | `exclusive` (amount before VAT, customer pays amount + 7%) | `none` (not part of the price,
  e.g. a refundable guarantee — no VAT). With VAT the receipt is also a deposit tax invoice: `tax_invoice_no` `DT-…`, title "ใบรับเงินมัดจำ / ใบกำกับภาษี".
  - Invoicing an order deducts its open VAT deposits (dated on/before the invoice) automatically, or exactly `deposits [{depositId, amount?}]` (same customer, VAT deposits only);
    `applyDeposits: false` skips. Capped at the order gross; VAT of a partial use is pro rata (`amount × vat / total`), the last use takes the exact rest.
    The invoice charges only the rest: `vat = order VAT − deposit VAT`, `gross = order gross − deposit`, `net = gross − vat`; `depositDeductions` on the printable invoice.
- Paper (wave 8): the tax invoice prints the company payment note as "เงื่อนไขการชำระเงิน" (`print.footer: 'payment'`, default for `legal: 'tax-invoice'`); the receipt never does. Time-varying facts stay on screen: `payment_status` (status badge), `outstanding`, the `receipts` table, receipt `deposit_remaining` (`print: false`). A company-named buyer without a tax ID gets an on-screen warning; a juristic tax ID without a branch prints "สำนักงานใหญ่". Invoice signature boxes: ผู้รับสินค้า / ผู้รับบริการ, ผู้มีอำนาจลงนาม.
  - A VAT deposit can't be used on a payment receipt (400 — deduct it on the invoice); `none` deposits still are (`deposits`/`applyDepositId`).
- Lock date (wave 8, C5): tax invoices and receipts/deposits dated on/before the lock date → 409 (Thai) unless the user has `sales.lock.override` and sends
  `lockOverrideReason` (kept in `_audit`). Moves forward on `accounting.period_closed`, steps back on `accounting.period_reopened` (accounting locks only), or `POST /lock`.
- Dates (bugs-0.4, wave 8): order / invoice / receipt dates default to `thaiToday()` from the kernel clock (Asia/Bangkok; the DB runs in UTC — never `current_date`); invoice and receipt dates may not be in the future; a receipt may not be dated before any invoice it settles (400). `sales.payment_received` carries `receiptDate`.
- **Credit / debit notes (wave 9)** — ใบลดหนี้ (ประมวลรัษฎากร มาตรา 82/10 + 86/10) / ใบเพิ่มหนี้ (มาตรา 82/9 + 86/9), only against this module's own invoices
  (`POST /invoices/:id/credit-notes|debit-notes`). Reasons: codes in `src/notes.ts` (`CREDIT_REASONS` / `DEBIT_REASONS`, the legal list) + free text
  (required for `other` = เหตุอื่นตามที่อธิบดีกำหนด); the printed `reason` = legal reason — text.
  - Lines refer to invoice lines by `lineNo` (item, description, qty and unit price after the line discount default from it) or are free lines
    (`description` + `unitPrice`); `amount` = one-line shorthand. Prices are in the **invoice's price basis** (VAT-exclusive order → before VAT; inclusive → incl. VAT).
    Arithmetic = the invoice's: round(qty × price) per line, then `calcVat(sum, vatMode, rate)` (rate of the invoice: 7%, 0 if the order had no VAT).
  - `original_net` = value in effect before the note: invoice `net + deposit_net` (deposits deducted on it are part of the goods' value) ± earlier notes;
    `correct_net` = original ∓ difference. Credit notes may not take it below zero (400 `ลดหนี้ … เกินมูลค่าคงเหลือ…`, compared in the price basis);
    the credit that brings it to exactly zero takes the exact remaining base and VAT (3 × 333.33/333.33/333.34 incl. → base 934.58, VAT 65.42 exactly).
  - Dates: default `thaiToday()`, not in the future, not before the invoice; the **lock date applies to the note's date** (`guardLockDate`, what = ใบลดหนี้/ใบเพิ่มหนี้) —
    a note dated in an open month may adjust an invoice of a closed month (that is the law: the note belongs to the month it is issued).
  - `returnToStock` (credit notes, stock-item lines only): `true` = the line qty, or a number ≤ qty; Σ returned per invoice line ≤ qty sold (400).
    `warehouseCode` defaults to the order's warehouse. Inventory receives it from `sales.note_issued`.
  - Effect on AR: invoice `credit_total`/`debit_total` += gross → outstanding = billed − paid everywhere (`/invoices`, invoice detail, `/orders/:id`, receipts'
    "amount > outstanding" check, `/summary`, PromptPay amount). A credit after payment makes outstanding negative = a customer **credit balance**:
    `/receivables` rows/totals `credit_balance` (`net_outstanding = outstanding − credit_balance − deposits`), aging `credit_balance` column (not aged).
    `/receivables` and aging as of a date count only notes dated on/before it. Summary revenue (month and trend) = invoices + debit notes − credit notes by document date.
  - The invoice itself never changes on paper; its detail lists `notes` (screen only) and `credit_total`/`debit_total`.
- Receivables group by `coalesce(customer_id, customer_name)`; aging buckets by days past due as of `asOf` (invoices issued on/before `asOf`, less receipts dated on/before it; deposits likewise) (default today, Asia/Bangkok): `current` (not yet due), `d1_30`, `d31_60`, `d61_90`, `over_90`.
- Handler `crm.quotation_accepted` (CRM is `enhancedBy`): if the payload has `lines`, drafts an order (warehouse MAIN, credit 0, `ref` = quotation no., `created_by` null) — once per quotation id; old payloads without lines are ignored.
- Handler `contracts.installment_due` (contracts is `enhancedBy`; `draftInstallmentOrder`): one draft order per installment (`sales_orders.contract_installment_id`, unique — migration 003):
  customer snapshot, VAT exclusive (contract amounts are before VAT), one service line "ค่าบริการบำรุงรักษา (MA) <title> ตามสัญญา <no> งวดที่ n/N ช่วง …" × 1 at `amount`,
  `ref` = `MA-… งวด n/N`, note asks billing staff to confirm, invoice and record the invoice no. in Contracts. Zero amounts are ignored.

## API
- `POST /orders` (`lines[]`: `itemId+itemCode` or `description`, `qty`, `unitPrice`, `discountPct?`; `creditDays?`, `ref?`) · `GET /orders?status=&q=` (q: no, customer, ref) · `GET /orders/:id` (+ `invoice_no`, `payment_status`, `outstanding`, `deposits`)
- `POST /orders/:id/confirm | deliver | cancel | invoice {issueDate?, dueDate?, deposits?, applyDeposits?, lockOverrideReason?}`
- `GET /invoices?q=&status=outstanding|partially_paid|paid|open&overdue=1&customerId=` (+ `days_overdue`)
- `GET /invoices/:id` → print-ready: `issueDateTh`, `dueDateTh`, `amountText`, customer block, lines, `receipts`, `outstanding`, `payment_status`, `promptPay` (for the outstanding amount; null when paid; env `PROMPTPAY_ID`)
- `POST /receipts { customerId?, customerName?, receiptDate?, method, reference?, note?, lines?[{ invoiceId, amount, whtBase? }], deposits?, whtPct?, depositAmount?, depositVatMode?, orderId?, lockOverrideReason? }` → printable receipt (201)
  (deposits: `net`, `vat`, `tax_invoice_no`, `vatLabel`, `applications` [{doc_no, doc_kind invoice|receipt, amount, net, vat}])
- `POST /invoices/:id/credit-notes | /invoices/:id/debit-notes { reasonCode, reasonText?, issueDate?, amount? | lines?[{ lineNo?, itemId?+itemCode?, itemName?, description?, qty?, unitPrice?, returnToStock? (credit) }],
  warehouseCode?, note?, lockOverrideReason? }` (`sales.note.write`) → printable note (201)
- `GET /credit-notes | /debit-notes | /notes?kind=credit|debit&invoiceId=&customerId=&q=` (`sales.note.read`; `kind_label`) ·
  `GET /credit-notes/:id | /debit-notes/:id` (404 under the other kind) → print-ready: `title` (ใบลดหนี้ / ใบเพิ่มหนี้), `issueDateTh`, `invoiceDateTh`, customer block,
  lines, `original_net`, `correct_net`, `net`, `vat`, `gross`, `amountText`, `reason`, `priceBasis`, `returned`, `legalText` (มาตรา 86/10 / 86/9 + original invoice no./date),
  `invoiceOutstanding` / `invoicePaymentStatus` (screen only)
- `GET /lock` (sales.lock.write / invoice.write / receipt.write / receivable.read) · `POST /lock { lockDate | null }` (`sales.lock.write`, not in the future) → `{ lockDate, lockDateTh, source, period, updatedAt, updatedByName }`
- `GET /receipts?q=&kind=payment|deposit&open=1&customerId=` · `GET /receipts/:id` → print-ready: `title` (ใบเสร็จรับเงิน / ใบรับเงินมัดจำ), `receiptDateTh`, `methodLabel`, `amountText`, `receivedText`, customer, lines, deposits
- `GET /receivables?asOf=` → `{ asOf, totals: {outstanding, overdue, deposits, customers}, rows: [{customer_id, customer_name, invoices, outstanding, overdue, oldest_due, max_days_overdue, deposits, net_outstanding}] }`
- `GET /receivables/aging?asOf=` → `{ asOf, totals: {current, d1_30, d31_60, d61_90, over_90, total}, rows: [per customer] }`
- `GET /summary` (dashboard: to confirm/deliver/invoice, revenue this month, 6-month trend, `outstanding`, `overdue`, `overdueCount`, `receivedMonth`, `unappliedDeposits`) — `sales.order.read` or `sales.receivable.read`

Permissions: `sales.order.read|write`, `sales.order.deliver`, `sales.invoice.write`, `sales.receipt.write` (issue receipts / take deposits), `sales.receivable.read` (receipts, receivables, aging),
`sales.lock.write` (set the lock date), `sales.lock.override` (date a document into a locked period, with a reason),
`sales.note.read` (credit / debit notes), `sales.note.write` (issue them).

## Events
- publishes `sales.order_confirmed`, `sales.delivered` (→ Inventory issues stock), `sales.invoiced` (+ optional customer, `dueDate`, wave 5 `issueDate` + `vatMode` → Accounting posts on the invoice date; wave 8 C7 `customerTaxId`/`customerBranch` for the sales VAT register), `sales.payment_received` (receipt issued: kind, totals, invoices settled with remaining outstanding; deposits: wave 8 `net`/`vat`/`taxInvoiceNo`) ·
  `sales.invoiced` wave 8 `depositApplied {net, vat, gross, deposits[]}` when VAT deposits were deducted; wave 9 `lines[]` (itemId, itemCode, description, qty,
  uom null, unitPrice, discount, amount — in the order's price basis, see `vatMode` —, vatRate), `customerAddress`, `customerEmail` (e-Tax) ·
  `sales.note_issued` (wave 9, same transaction as the note: kind, note/invoice no. + dates, buyer, reason, originalNet/correctNet, difference net/vat/gross,
  warehouseCode, lines with `returnToStock` → Inventory receives the goods back; Accounting reverses / adds revenue + output VAT in the note's month)
- subscribes `crm.quotation_accepted` (draft order from the accepted quotation), `contracts.installment_due` (draft MA service order),
  `accounting.period_closed` / `accounting.period_reopened` (lock date; accounting is `enhancedBy`)

## Extension ideas
Progress billing (ใบแจ้งหนี้ตามงวด), refund or apply a customer credit balance (from credit notes) to another invoice, void, credit limits, partial deliveries, receipt cancellation (void) with reversal, customer credit terms on MA drafts,
an overdue-invoice timer event for Automation, e-Tax invoice XML, PDF rendering (use the printable JSON).

## Screens
`src/ui.ts` — soList/soNew/soDetail, invoice (print), invoices (outstanding/overdue filters), receipts/receiptNew/depositNew/receipt (printable),
receivables, aging, creditNotes/debitNotes (lists) and creditNote/debitNote (printed ใบลดหนี้ / ใบเพิ่มหนี้: `legal: 'tax-invoice'`, no payment footer,
signatures ผู้รับใบลดหนี้ / ผู้คืนสินค้า + ผู้มีอำนาจลงนาม), invoice actions ออกใบลดหนี้ / ออกใบเพิ่มหนี้ (wave 9; reasons from `src/notes.ts`), lockSettings (wave 8: วันที่ปิดงวด form, `POST /lock`, load `GET /lock`). Widgets: sales KPI, AR KPI (`sales.receivable.read`), 6-month trend. ⌘K: `ขาย`, `รับชำระ`, `รับมัดจำ`, `ลูกหนี้`.
Keep endpoints identical to the routes above. Dashboard widgets, ⌘K commands and search are declared in `src/ui.ts` — see docs/ui.md.
