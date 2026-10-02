# inventory — Inventory (คลังสินค้า) · feature

Warehouses and an append-only stock ledger. Balance = `sum(qty)` of `stock_moves` per item + warehouse.

## Data
- `warehouses` (code per tenant) · `stock_moves` (signed `qty`, `kind`, `ref_type`/`ref_id` back to the source document) · `settings.allow_negative`

## The one write path
`postMove(emit, c, move, opts)` in `src/stock.ts` — locks item+warehouse, checks negative stock, inserts, emits `inventory.stock_changed`.
Never insert into `stock_moves` anywhere else.

## API
- `GET/POST /warehouses` · `PUT /settings { allowNegative }`
- `POST /receipts` · `POST /issues` · `POST /transfers` · `POST /adjustments` (note required)
- `GET /balances?itemId=&warehouseCode=&nonZero=` · `GET /items/:itemId/stock-card?warehouseCode=`

## Events
- publishes `inventory.stock_changed`
- subscribes (all optional — module works without them):
  - `purchasing.goods_received` → receipt (auto-creates the warehouse code)
  - `sales.delivered` → issue · `production.completed` → issue components + receive finished good · `maintenance.parts_used` → issue
  - event-driven issues use `force: true` (record even if stock goes negative; the physical fact already happened)

## Extension ideas
Lots/serials, bin locations, stock counts, reorder points (new table + a scheduled route), valuation (FIFO) reading `unit_cost`.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
