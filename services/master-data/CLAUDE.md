# master-data — Master Data (ข้อมูลหลัก) · core

Items and business partners. Other modules keep only snapshots (`itemId`, `itemCode`, `itemName`) and may listen to the upsert events.

## Data
- `items` — `code` unique per tenant, `type` ∈ raw | semi | finished | spare | service, `uom`, `std_price`
- `partners` — `kind` ∈ customer | supplier | both, `tax_id` (validated 13-digit), `branch` (5 digits, `00000` = head office)

## API (generic CRUD built by `crud()` in src/service.ts)
- `GET /items?q=&type=&limit=&offset=` · `GET /items/:id` · `POST /items` · `PATCH /items/:id`
- `GET /partners?q=&kind=` · `GET /partners/:id` · `POST /partners` · `PATCH /partners/:id`
- `POST /items/import` · `POST /partners/import` — bulk upsert by `code` from a spreadsheet: `{ rows: [...], dryRun?: boolean }` (max 2000).
  Each row is validated with the same zod schema as create (text cells coerced: blank → absent, `"1,250.50"` → number, ใช่/ไม่ใช่ → boolean, Thai names or any-case codes → enum codes;
  partners: 12-digit tax ID gets its leading 0 back, branch `1` → `00001`). Answers `{ dryRun, total, created, updated, errors: [{ row, field?, message }] }`
  (`row` 1-based in `rows`, Thai messages). A real run writes all rows in one transaction or, if any row is invalid, nothing (400, `details.errors`).
  An existing record only changes in the columns the file filled. Permission `master.item.write` / `master.partner.write`; publishes the usual upsert event per row.
- `GET /summary` (counts of items, customers, suppliers)

## Events
- publishes `master.item_upserted`, `master.partner_upserted` on every create/update (and per imported row)

## Extension ideas
Item categories, units-of-measure conversion, price lists, barcodes: add columns in a new migration and the field to `ITEM_COLS` + `ItemInput`.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
The `items` and `partners` lists declare `import` (CSV columns = create-body keys with Thai labels) — add a column there when you add a field.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
