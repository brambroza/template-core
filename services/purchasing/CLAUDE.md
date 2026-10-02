# purchasing — Purchasing (จัดซื้อ) · feature

Purchase orders with Thai VAT and goods receipt.

## Flow
`draft` → (approve, perm `purchasing.po.approve`) → `approved` → receive (partial → `partially_received`) → `received`. `draft|approved` → `cancelled`.

## Data
- `purchase_orders` (`no` = `PO-<BE year>-0001`, totals `net/vat/gross`, `vat_mode`, `warehouse_code` = where goods arrive)
- `po_lines` (`received_qty` ≤ `qty`, `returned_qty` ≤ `received_qty`)
- `purchase_returns` (`RT-<BE year>-0001`, PO snapshot, `warehouse_code` the goods leave from, `ref_no` e.g. NCR no, VAT totals = the credit note to ask for) · `purchase_return_lines` (`po_line_id`, `reason`)

## API
- `POST /purchase-orders` · `GET /purchase-orders?status=&q=` · `GET /purchase-orders/:id`
- `POST /purchase-orders/:id/approve | cancel | receive` (receive body `{ lines?: [{ lineId, qty }] }`, omit = everything outstanding)
- `GET /summary` (dashboard: to approve, to receive, spend this month, 6-month trend)
- `POST /purchase-orders/:id/returns { lines: [{ itemId, qty, reason? }], warehouseCode?, returnDate?, refNo?, note? }` (perm `purchasing.po.return`;
  PO `partially_received|received`; per item up to received − returned, spread over the PO lines of that item in line order; warehouse default = PO's)
- `GET /purchase-returns?q=&poId=` · `GET /purchase-returns/:id` · `GET /purchase-orders/:id` also returns `returns[]`, `returned_gross`, line `returnable_qty`

## Events
- publishes `purchasing.goods_received` per receipt (only the quantities received this time, with unit price) → Inventory stock-in, Costing moving average
- publishes `purchasing.po_created` and `purchasing.po_approved` → Automation (e.g. big-PO approval alert)
- publishes `purchasing.goods_returned` per return (lines with unit price + reason) → Inventory issues the qty (QC-HOLD for rejected material).
  Costing does not reverse the moving average yet (extension idea).

## Extension ideas
Purchase requests, multi-level approval by amount, supplier price lists, AP invoice matching.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
Wave 4: PO detail action "ส่งคืนผู้ขาย" (default warehouse QC-HOLD) → `rtDetail` (printable ใบส่งคืนสินค้า); `rtList` menu + ⌘K search over returns.
