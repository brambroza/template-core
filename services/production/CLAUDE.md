# production — Production & MRP (วางแผนการผลิต) · feature

BOMs, production orders, material requirements.

## Data
- `boms` (one per item, `output_qty`) · `bom_lines` (`qty` per output, `scrap_pct`)
- `production_orders` (`MO-2569-0001`, `qty`, `completed_qty`, `warehouse_code`): `planned` → `released` → `completed` (or `cancelled`)

## Logic (src/bom.ts)
- `directComponents(bom, qty)` = qty × line.qty / output_qty / (1 − scrap%) — what is consumed when reporting output
- **Multi-level BOM**: a component that has its own BOM is a sub-assembly; there is no depth limit. `loadAllBoms(c)` loads the tenant's
  BOMs once; `bomTree(all, itemId, qty?)` = indented rows depth first (`level`, `qty_per`, `scrap_pct`, `qty` for the root quantity, `has_bom`,
  `parent_code`, `source_label`), throws a Thai 400 naming the item codes of a loop; `leafTotals(tree)` = bought materials summed over all levels;
  `whereUsed(all, itemId)` = parents level 1, 2, … up; `depthOf`.
- `explode(c, itemId, qty)` = `leafTotals(bomTree(...))` — production orders use it; circular BOMs are refused on every save

## API
- `PUT /boms` (create/replace) · `GET /boms?q=` (with `levels`, `components`, `role` top/sub, `role_label`)
- `GET /boms/:itemId` (lines + `tree`, `levels`, `requirements` all levels, `used_in`) · `GET /boms/:itemId/tree?qty=` · `GET /boms/:itemId/where-used`
  (any item, with or without its own BOM) · `GET /boms/:itemId/explode?qty=`
- `POST /orders` (needs a BOM) · `GET /orders` · `GET /orders/:id` (with requirements for the open qty)
- `POST /orders/:id/release | cancel | complete` (complete body `{ qty? }` — partial reporting allowed)
- `GET /summary` (dashboard: planned/released/late orders, output this month, pipeline rows)

## Events
- publishes `production.completed` per output report (item, qty, direct components consumed) → Inventory, Costing

## Extension ideas
Routings/work centres & capacity, BOM versions, scrap reporting, MRP net requirements against Inventory balances (subscribe to `inventory.stock_changed` and keep a local balance table).

## Screens
BOM: list (type, depth) → detail with the indented tree (fold/unfold, sub-assembly opens its own BOM, "+ สร้างสูตรย่อย" on a bought part opens
the BOM form prefilled with it), all-level material totals and where-used · `bomEdit` (new) / `bomChange` (edit, loads the lines).
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
