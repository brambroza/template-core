# purchasing — Purchasing (จัดซื้อ) · feature

Purchase orders with Thai VAT and goods receipt.

## Flow
`draft` → (approve, perm `purchasing.po.approve`) → `approved` → receive (partial → `partially_received`) → `received`. `draft|approved` → `cancelled`.

## Data
- `purchase_orders` (`no` = `PO-<BE year>-0001`, totals `net/vat/gross`, `vat_mode`, `warehouse_code` = where goods arrive)
- `po_lines` (`received_qty` ≤ `qty`)

## API
- `POST /purchase-orders` · `GET /purchase-orders?status=&q=` · `GET /purchase-orders/:id`
- `POST /purchase-orders/:id/approve | cancel | receive` (receive body `{ lines?: [{ lineId, qty }] }`, omit = everything outstanding)

## Events
- publishes `purchasing.goods_received` per receipt (only the quantities received this time, with unit price) → Inventory stock-in, Costing moving average

## Extension ideas
Purchase requests, multi-level approval by amount, supplier price lists, AP invoice matching.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
