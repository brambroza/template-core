# purchasing — Purchasing (จัดซื้อ) · feature

Purchase orders with Thai VAT and goods receipt; supplier bills (payables), supplier payments with withholding tax, 50 ทวิ and ภ.ง.ด.3/53 (wave 9).

## Flow
`draft` → (approve, perm `purchasing.po.approve` / `purchasing.po.approve-high` by amount) → `approved` → receive (partial → `partially_received`) → `received`. `draft|approved` → `cancelled`.

## Approval controls (wave 8, round-2 blocker #1 — segregation of duties)
- `settings` (per tenant, no row = secure defaults): `creator_cannot_approve` (default **true**) and `approval_tiers` jsonb
  (default `[{upTo: 50000, perm: 'purchasing.po.approve'}, {upTo: null, perm: 'purchasing.po.approve-high'}]`, on the PO's gross incl. VAT).
- Approve: the PO's `created_by` cannot approve it (403 `ผู้สร้างใบสั่งซื้อ … อนุมัติเองไม่ได้`) — applies to `*` admins too; the tier the gross falls in
  names the permission needed; a higher tier's permission also approves lower tiers (403 `… เกินวงเงินอนุมัติของคุณ …`). No approve permission at all → 403.
- Receiving by the PO's approver is allowed but logged: `po_receipts` row per receipt (`received_by(_name)`, `by_approver`, lines, gross, Thai `note`)
  + a server warn log. `GET /receipts?byApprover=true` is the auditor's exception list; PO detail returns `receipts[]` and `received_by_approver`.
- `purchase_orders.created_by_name` / `approved_by_name` snapshot the token names (printed signatures, detail).
- Permissions: `purchasing.po.approve-high` (executive template), `purchasing.settings.write` (admin only — no template).

## Data
- `purchase_orders` (`no` = `PO-<BE year>-0001`, totals `net/vat/gross`, `vat_mode`, `warehouse_code` = where goods arrive)
- `po_lines` (`received_qty` ≤ `qty`, `returned_qty` ≤ `received_qty`)
- `purchase_returns` (`RT-<BE year>-0001`, PO snapshot, `warehouse_code` the goods leave from, `ref_no` e.g. NCR no, VAT totals = the credit note to ask for) · `purchase_return_lines` (`po_line_id`, `reason`)

## API
- `POST /purchase-orders` · `GET /purchase-orders?status=&q=` · `GET /purchase-orders/:id`
- `POST /purchase-orders/:id/approve | cancel | receive` (receive body `{ lines?: [{ lineId, qty }], receivedDate?, lockOverrideReason? }`, omit lines = everything outstanding;
  `receivedDate` default today in Bangkok, not in the future → carried as `receivedDate` on `purchasing.goods_received`)
  · C8 (optional, receive form fields): `supplierInvoiceNo`, `supplierInvoiceDate`, `supplierTaxId` (13 digits, checksum → 400), `supplierBranch` ('00000' = HQ) —
  the supplier's tax invoice that came with the goods; stored on `po_receipts` (migration 004, shown in the PO's receipt log) and carried on
  `purchasing.goods_received` so accounting's purchase VAT register shows the supplier's invoice instead of our PO number. Empty strings = not given.
- `GET /lock` (`purchasing.po.read`) · `POST /lock { lockDate | null }` (`purchasing.lock.write`) — wave 8 lock date
- `GET /summary` (dashboard: to approve, to receive, spend this month, 6-month trend)
- SoD 403 for the creator: when the creator also holds `purchasing.settings.write` (owner / admin), the message adds where to switch the rule off
  (จัดซื้อ › ตั้งค่าการอนุมัติใบสั่งซื้อ) — a one-person company is otherwise stuck at its first PO. The default stays on.
- `GET /settings` (`purchasing.po.read`) → `{ creatorCannotApprove, approvalTiers, standardApprovalLimit, tiersText }` ·
  `PUT /settings { creatorCannotApprove?, approvalTiers? | standardApprovalLimit? }` (`purchasing.settings.write`; tiers ascending, last `upTo: null`,
  perms only the two approve perms; `standardApprovalLimit` = form shortcut, 0 = one tier without limit)
- `GET /receipts?byApprover=&poId=&q=` (`purchasing.po.read`) — receipt log with PO no, supplier, approver, items
- `POST /purchase-orders/:id/returns { lines: [{ itemId, qty, reason? }], warehouseCode?, returnDate?, refNo?, note?, lockOverrideReason? }` (perm `purchasing.po.return`;
  PO `partially_received|received`; per item up to received − returned, spread over the PO lines of that item in line order; warehouse default = PO's)
- `GET /purchase-returns?q=&poId=` · `GET /purchase-returns/:id` · `GET /purchase-orders/:id` also returns `returns[]`, `returned_gross`, line `returnable_qty`

## Dates & lock (wave 8)
- PO `order_date`, return `return_date` and receipt `receivedDate` default to `thaiToday()` (kernel clock, Asia/Bangkok) — never SQL `current_date` (UTC).
- Lock date (kernel `_lock_date`): goods receipts and returns dated on/before it → 409 unless `purchasing.lock.override` + `lockOverrideReason` (in `_audit`).
  Subscribes `accounting.period_closed` (lock forward to the period's last day) / `accounting.period_reopened` (accounting lock steps back); accounting is `enhancedBy`.
  Permissions `purchasing.lock.write`, `purchasing.lock.override`. POs themselves are not locked (no posting).

## Events
- publishes `purchasing.goods_received` per receipt (only the quantities received this time, with unit price) → Inventory stock-in, Costing moving average;
  wave 5 adds the PO's `vatMode`, this receipt's `net`/`vat`/`gross` (`documentTotals` of the received lines) and line `vatRate` (0.07) → Accounting books ภาษีซื้อ apart
- publishes `purchasing.po_created` (+ optional `createdById`: the creator gets no LINE approve button) and `purchasing.po_approved` → Automation (e.g. big-PO approval alert)
- subscribes `automation.line_decision` (target `purchasing.po`): an approver pressed อนุมัติ + ยืนยัน on a LINE card → `linePoDecision()` runs `approvePo()`
  (shared with `POST /purchase-orders/:id/approve`: SoD creator ≠ approver, approval tiers) as that user; refused when their revocation cutoff is later
  than `permsAt` or they hold no approve permission. Never throws; publishes `purchasing.line_decision_result` (lineActionId, userId, ok, message).
- `POST /purchase-orders/:id/receive` is dry-runnable (`?_dryRun=1`, kernel impact.ts) — the receive dialog previews stock, cost, accounting and QC
- publishes `purchasing.goods_returned` per return (lines with unit price + reason) → Inventory issues the qty (QC-HOLD for rejected material);
  wave 5 adds `vatMode`, the return's `net`/`vat`/`gross` and `returnDate` (always sent since wave 8) → Accounting reverses ภาษีซื้อ.
  Costing does not reverse the moving average yet (extension idea).

## Payables, payments & withholding tax (wave 9) — `src/payables.ts`, pure helpers in `@erp/thai` (`wht.ts`)
Legal basis is in the code comments (ประมวลรัษฎากร มาตรา 3 เตรส + คำสั่ง ท.ป.4/2528, 50 / 69 ทวิ, 50 ทวิ, 52 / 59; input VAT 82/3, 86/4).
Nothing is filed with the Revenue Department — reports/exports only; the company files itself.

Data (migration 005): `po_lines.billed_qty` · `supplier_bills` (`AP-2569-0001`, kind goods|service|expense, supplier snapshot id/code/name/tax_id/branch/address
from master-data's lookup in the request, supplier invoice no/date, `vat_mode` exclusive|inclusive|none, `vat_claimable`, `wht_income_type` hint, `paid`, status open|partially_paid|paid)
· `supplier_bill_lines` · `supplier_payments` (`PV-2569-0001`, payee snapshot, `form` PND3|PND53|null, gross / wht_total / net_paid, `warnings` jsonb)
· `supplier_payment_bills` · `supplier_payment_wht` (income_type, description, rate fraction, base, amount, condition '1') · `wht_certificates` (id = payment id,
`WHT-2569-0001` → เล่มที่ 2569 เลขที่ 0001, per tenant via `nextDocNo`, `print_count`). Attachment entities `bill`, `payment`.

API
- `POST /bills` (`purchasing.bill.write`) `{ kind, supplierId?, supplierCode?, supplierName, supplierTaxId? (13 digits + checksum), supplierBranch?, supplierAddress?,
  supplierInvoiceNo, supplierInvoiceDate, billDate? (default today, not future, lock date), dueDate? | creditDays?, vatClaimable? (true|false|'auto'), whtIncomeType?, note?, lockOverrideReason?,
  goods: poId + poLines? [{ lineId, qty }] · service/expense: vatMode, lines [{ description, qty, unitPrice }] }`.
  Goods: PO `partially_received|received`; per line ≤ received − returned − billed (409); totals = `documentTotals` at the PO's VAT mode; supplier from the PO.
  `vatClaimable` default = VAT > 0 and a seller tax ID; true without a tax ID → 400 (§86/4). Same supplier + same invoice no again → 409.
- `POST /purchase-orders/:id/bills` — goods bill from the PO screen (omit `lines` = everything received and not billed yet)
- `GET /bills?status=open|partially_paid|paid|unpaid&kind=&supplierId=&q=` · `GET /bills/:id` (lines, payments, outstanding) — `purchasing.bill.read`
- `GET /payables?asOf=&overdue=&supplierId=&q=` (days_overdue, bucket; due = due_date or bill_date) · `GET /payables/aging?asOf=` → `{ asOf, rows per supplier, totals }`
- `POST /supplier-payments` (`purchasing.payment.write`) `{ bills: [{ billId, amount? (default outstanding) }], paymentDate?, method, wht?: [{ incomeType, base?, rate?, description? }],
  form? (PND3|PND53|'auto'), bankRef?, note?, lockOverrideReason? }` + form shortcut `whtIncomeType` ('none' | type), `whtRatePercent`, `whtBase`, `whtDescription`.
  All bills of one supplier (400); amount ≤ outstanding (409 จ่ายเกินยอดค้าง); default base = pre-VAT part of what is paid now (Σ amount × net/gross) — only with one WHT line;
  Σbase ≤ amount paid (400); WHT = round(base × rate) to the satang. Form default: tax ID starting 0 → PND53, other 13-digit → PND3, no ID → company-looking name → PND53.
  Warnings (stored, shown, never block): base under 1,000 for types usually exempt, rate ≠ standard, form ≠ expected, payee without tax ID, base above pre-VAT, bill hints WHT but none taken.
- `POST /bills/:id/payments` — pay one bill (`amount?` + the same fields)
- `GET /supplier-payments?period=YYYY-MM&form=&supplierId=&q=` · `GET /supplier-payments/:id` — `purchasing.payment.read`
- `GET /wht-certificates?period=&form=&q=` · `GET /wht-certificates/:id` (id = payment id; everything the 50 ทวิ prints: เล่มที่/เลขที่, payee, ลำดับที่ในแบบ,
  ภ.ง.ด. boxes, income lines under ข้อ 5 (มาตรา 3 เตรส), totals + baht text, ผู้จ่ายเงิน (1) หัก ณ ที่จ่าย ticked, copy captions) ·
  `POST /wht-certificates/:id/print` (print log) — `purchasing.wht.read` or `purchasing.payment.read`. Payer = company letterhead (identity company profile).
- `GET /wht/returns?year=` (per month × form: payees, totals, due dates) · `GET /wht/returns/:id` (id `2026-09_PND53`: header, ใบแนบ rows, totals, due dates, `rd_text`) ·
  `GET /wht/returns/:id/export?format=csv|rd&encoding=tis620|utf8` (file download; header `x-rd-prep-layout: unverified`) ·
  `GET /wht/attachment-rows?period=&form=` (the rows as a list — the web's list CSV button) — `purchasing.wht.read`.
- Due: paper by the 7th, e-filing by the 15th of the next month (`whtDueDates`); holidays not adjusted.
- RD Prep text layout: see `docs/wht-rd-prep-export.md` — **ต้องตรวจกับโปรแกรม RD Prep เวอร์ชันล่าสุดก่อนยื่นจริง**, never verified.

Events: publishes `purchasing.bill_recorded` (per bill) and `purchasing.supplier_paid` (per payment; `wht[]` with form + certificateNo) → Accounting (AP, ภาษีซื้อ, WHT payable).

Screens: บิลผู้ขาย (billList/billNew/billDetail + "จ่ายชำระ"), PO action "ตั้งหนี้", เจ้าหนี้ค้างจ่าย (payables), อายุเจ้าหนี้ (aging report),
จ่ายชำระหนี้ผู้ขาย (payNew), ใบสำคัญจ่าย (paymentList/paymentDetail printable), 50 ทวิ (whtCerts, whtCert1 = ฉบับที่ 1, whtCert2 = ฉบับที่ 2, printable),
ภ.ง.ด.3/53 (whtReturns → whtReturn printable ใบแนบ + RD text), ใบแนบ (ส่งออก CSV) (whtRows). WHT type options in ui.ts are literal — keep them equal to `WHT_INCOME_TYPES` (test).

Not yet: void/cancel of a bill or payment (needs reversal events), WHT conditions 2/3 (ออกให้ — gross-up), ภ.ง.ด.3/53 cover form figures beyond totals,
a download button in the generic renderer (the RD text is shown on screen and available from the export endpoint).

## Extension ideas
Purchase requests, multi-level approval by amount, supplier price lists, AP invoice matching.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.

Wave 8: `receipts` (บันทึกการรับของ, filter ผู้อนุมัติรับของเอง) and `settings` (ตั้งค่าการอนุมัติ: creator rule + standard limit) screens;
PO detail shows ผู้จัดทำ / ผู้อนุมัติ / อนุมัติเมื่อ / ผู้อนุมัติรับของเอง and the การรับของ lines.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
Wave 4: PO detail action "ส่งคืนผู้ขาย" (default warehouse QC-HOLD) → `rtDetail` (printable ใบส่งคืนสินค้า); `rtList` menu + ⌘K search over returns.
PO paper (wave 8): no company payment note (footer off by default); status, receiving warehouse, received/returned columns and the returns table stay on screen (`print: false`).
