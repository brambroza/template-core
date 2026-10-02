# master-data — Master Data (ข้อมูลหลัก) · core

Items and business partners. Other modules keep only snapshots (`itemId`, `itemCode`, `itemName`) and may listen to the upsert events.

## Data
- `items` — `code` unique per tenant, `type` ∈ raw | semi | finished | spare | service, `uom`, `std_price`
- `partners` — `kind` ∈ customer | supplier | both, `tax_id` (validated 13-digit), `branch` (5 digits, `00000` = head office)

## API (generic CRUD built by `crud()` in src/service.ts)
- `GET /items?q=&type=&limit=&offset=` · `GET /items/:id` · `POST /items` · `PATCH /items/:id`
- `GET /partners?q=&kind=` · `GET /partners/:id` · `POST /partners` · `PATCH /partners/:id`

## Events
- publishes `master.item_upserted`, `master.partner_upserted` on every create/update

## Extension ideas
Item categories, units-of-measure conversion, price lists, barcodes: add columns in a new migration and the field to `ITEM_COLS` + `ItemInput`.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
