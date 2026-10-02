# production — Production & MRP (วางแผนการผลิต) · feature

BOMs, production orders, material requirements.

## Data
- `boms` (one per item, `output_qty`) · `bom_lines` (`qty` per output, `scrap_pct`)
- `production_orders` (`MO-2569-0001`, `qty`, `completed_qty`, `warehouse_code`): `planned` → `released` → `completed` (or `cancelled`)

## Logic (src/bom.ts)
- `directComponents(bom, qty)` = qty × line.qty / output_qty / (1 − scrap%) — what is consumed when reporting output
- `explode(c, itemId, qty)` = multi-level leaf requirements; throws on circular BOMs (also checked on every BOM save)

## API
- `PUT /boms` (create/replace) · `GET /boms` · `GET /boms/:itemId` · `GET /boms/:itemId/explode?qty=`
- `POST /orders` (needs a BOM) · `GET /orders` · `GET /orders/:id` (with requirements for the open qty)
- `POST /orders/:id/release | cancel | complete` (complete body `{ qty? }` — partial reporting allowed)
- `GET /summary` (dashboard: planned/released/late orders, output this month, pipeline rows)

## Events
- publishes `production.completed` per output report (item, qty, direct components consumed) → Inventory, Costing

## Extension ideas
Routings/work centres & capacity, BOM versions, scrap reporting, MRP net requirements against Inventory balances (subscribe to `inventory.stock_changed` and keep a local balance table).

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
