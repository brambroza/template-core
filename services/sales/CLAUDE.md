# sales — Sales (ขาย) · feature

Sales orders → delivery → Thai tax invoice.

## Flow
`draft` → confirm → `confirmed` → deliver → `delivered` → invoice → `invoiced` (invoice also allowed from `confirmed`). `draft|confirmed` → `cancelled`.

## Data
- `sales_orders` (`SO-2569-0001`, customer snapshot incl. tax ID/branch/address, totals) · `so_lines` · `invoices` (`INV-2569-0001`, one per order)

## API
- `POST /orders` · `GET /orders?status=&q=` · `GET /orders/:id`
- `POST /orders/:id/confirm | deliver | cancel | invoice`
- `GET /invoices/:id` → print-ready: `issueDateTh` (2 ตุลาคม 2569), `amountText` (บาทถ้วน), customer block, lines, `promptPay` payload (env `PROMPTPAY_ID`)

## Events
- publishes `sales.order_confirmed`, `sales.delivered` (→ Inventory issues stock), `sales.invoiced`

## Extension ideas
Quotations, credit limits, partial deliveries, receipts/payments, e-Tax invoice XML, PDF rendering (use the printable invoice JSON).

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
