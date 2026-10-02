# purchasing — Purchasing (จัดซื้อ) · feature

Purchase orders with Thai VAT and goods receipt.

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
- publishes `purchasing.po_created` and `purchasing.po_approved` → Automation (e.g. big-PO approval alert)
- publishes `purchasing.goods_returned` per return (lines with unit price + reason) → Inventory issues the qty (QC-HOLD for rejected material);
  wave 5 adds `vatMode`, the return's `net`/`vat`/`gross` and `returnDate` (always sent since wave 8) → Accounting reverses ภาษีซื้อ.
  Costing does not reverse the moving average yet (extension idea).

## Extension ideas
Purchase requests, multi-level approval by amount, supplier price lists, AP invoice matching.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.

Wave 8: `receipts` (บันทึกการรับของ, filter ผู้อนุมัติรับของเอง) and `settings` (ตั้งค่าการอนุมัติ: creator rule + standard limit) screens;
PO detail shows ผู้จัดทำ / ผู้อนุมัติ / อนุมัติเมื่อ / ผู้อนุมัติรับของเอง and the การรับของ lines.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
Wave 4: PO detail action "ส่งคืนผู้ขาย" (default warehouse QC-HOLD) → `rtDetail` (printable ใบส่งคืนสินค้า); `rtList` menu + ⌘K search over returns.
PO paper (wave 8): no company payment note (footer off by default); status, receiving warehouse, received/returned columns and the returns table stay on screen (`print: false`).
