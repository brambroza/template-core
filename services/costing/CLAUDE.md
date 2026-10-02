# costing — Product Costing (ต้นทุนการผลิต) · feature

Item cost table, standard cost sheets, actual job cost.

## Data
- `item_costs` — read model: moving average from `purchasing.goods_received`, or manual (`PUT /item-costs/:itemId`) when Purchasing is not installed
- `cost_sheets` (`CS-2569-0001`): material (from item_costs) + labour (hours × rate) + overhead (% of material+labour)
- `job_costs` — one row per `production.completed` event, materials at current average cost; `missing_costs` lists unpriced items

## API
- `GET /item-costs` · `PUT /item-costs/:itemId { itemCode, cost }`
- `POST /cost-sheets` (422 `missing_costs` if any material has no cost — never guess) · `GET /cost-sheets?itemId=` · `GET /cost-sheets/:id`
- `GET /job-costs`
- `GET /summary` (dashboard: items costed, sheets, jobs missing cost, material cost this month)

## Events
- subscribes `purchasing.goods_received` (moving average), `production.completed` (job cost) — both optional

## Extension ideas
Machine-hour costing, carbon footprint per product (same BOM × emission factors instead of cost rates), quotation pricing from cost + margin.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
