# inventory — Inventory (คลังสินค้า) · feature

Warehouses and an append-only stock ledger. Balance = `sum(qty)` of `stock_moves` per item + warehouse.

## Data
- `warehouses` (code per tenant, `is_hold` = quarantine: on hand but never available) · `stock_moves` (signed `qty`, `kind`, `ref_type`/`ref_id` back to the source document)
- `settings.allow_negative`, `settings.receive_into_hold` (API name `receiveIntoHoldWhenInspected`)
- `qc_holds` — one row per QC inspection that put stock into quarantine: origin `warehouse_code`, `hold_warehouse_code` (QC-HOLD), `held_qty`, `qty` still held,
  `status pending (waiting for QC) | rejected (failed, waiting for a decision) | released | returned | forced_out (left outside the hold flow, see log)`
- `qc_hold_log` (wave 8) — every reduction of a hold: `kind release | return | override | external`, `qty`, `qty_after`, `ref_type/ref_id`, `note` (reason), `user_id/user_name`
- `stock_anomalies` — every move that left a balance below zero (`source event` = forced by another module's event, `user` = allowed by `allowNegative`), acknowledged with a note

## The one write path
`postMove(emit, c, move, opts)` in `src/stock.ts` — locks item+warehouse, checks negative stock, inserts, records a `stock_anomalies` row when the
balance ends below zero, emits `inventory.stock_changed`. Never insert into `stock_moves` anywhere else.

## Behaviour
- Users can never issue/transfer below zero unless `allowNegative` (409 `สต็อกไม่พอ: <code> ที่คลัง <wh> คงเหลือ … ต้องการจ่าย … (ขาด …)`); a transfer is all-or-nothing.
- Event-driven issues (sales, production, maintenance, purchase returns) are recorded with `force: true` — and surface as anomalies + the "สต็อกติดลบ" KPI/bars.
- QC quarantine: `quality.inspection_completed` with `rejectedQty > 0` moves the rejected qty from the lot's warehouse into `QC-HOLD`
  (auto-created per tenant, `is_hold`), stock card ref = QC no. With `receiveIntoHoldWhenInspected` on, `quality.inspection_created` (incoming stage only)
  moves the whole lot into QC-HOLD at receipt; completion releases the accepted qty back and keeps the rejected qty on hold.
  Events without `itemId`/`warehouseCode` (older quality module) are ignored. Cancelled inspections leave stock on hold — release it by hand.
- Wave 8 (round-2 N2): stock leaves a hold warehouse **only through the hold flow** — `POST /holds/:id/release` (QC decision, note required, perm
  `inventory.hold.release`) or a purchase return. Normal `POST /issues`, `/transfers` (from) and negative `/adjustments` out of an `is_hold` warehouse → 403
  for everyone, `inventory.hold.release` included. Admin override: `overrideHoldReason` (≥ 5 chars) + perm `inventory.hold.override` (no template has it);
  the move note becomes `บังคับออกจากคลังกักกัน: <reason>`.
- Hold list = stock: `postMove` out of a hold warehouse (override, or another module's event such as `sales.delivered` from QC-HOLD) calls `trimHolds` —
  when the item's open holds there exceed what is left on hand, they are reduced (rejected first, then pending, oldest first; `forced_out` when empty)
  and each reduction is logged (`override` / `external`). Untracked stock in the hold warehouse is taken first. Callers that manage holds themselves
  (release, QC verdict, purchase return) pass `holdManaged: true`.
- `sales.note_issued` (wave 9, credit notes only): lines with `itemId` and `returnToStock > 0` are received into the note's `warehouseCode` (auto-created),
  stock card ref `sales_note` / note no. (`ref_th` รับคืนตามใบลดหนี้), note `รับคืนจากลูกค้า … ตามใบลดหนี้ CN-… (ใบกำกับ INV-…): <reason>`. Idempotent beyond the kernel's
  event-id de-duplication (a note already on the stock card is skipped); debit notes / no warehouse / service lines are ignored — never throws.
- `purchasing.goods_returned` issues from its warehouse; from a hold warehouse it settles that item's `rejected` then `pending` holds oldest first (`returned` when empty), logged as `return`.

## API
- `GET/POST /warehouses` (`isHold`) · `GET/PUT /settings { allowNegative?, receiveIntoHoldWhenInspected? }`
- `POST /receipts` · `POST /issues` · `POST /transfers` · `POST /adjustments` (note required)
- `GET /balances?itemId=&warehouseCode=&nonZero=` (`onHand`, `available` = 0 in hold warehouses, `isHold`) · `GET /items/:itemId/stock-card?warehouseCode=`
- `POST /issues | /transfers | /adjustments` accept `overrideHoldReason?` (only used out of a hold warehouse, with `inventory.hold.override`)
- `GET /holds?status=a,b&itemId=` (rows carry `hold_on_hand` = the item's on-hand in that hold warehouse) · `GET /holds/:id` (+ `log[]` with `kind_th`) ·
  `POST /holds/:id/release { qty?, toWarehouseCode?, note }` (perm `inventory.hold.release`)
- `GET /anomalies?open=true|false&itemId=` (with `on_hand_now`, `ref_th`) · `POST /anomalies/:id/acknowledge { note }` (perm `inventory.settings.write`)
- `GET/PUT /reorder-points` (min qty per item+warehouse; perm `inventory.settings.write` to set) · `GET /summary` (dashboard: skus, moves today, low stock rows,
  `negative` count, `negativeRows` (label, shortQty), `onHold`, `openAnomalies`)

## Events
- publishes `inventory.stock_changed`
- subscribes (all optional — module works without them):
  - `purchasing.goods_received` → receipt (auto-creates the warehouse code)
  - `sales.delivered` → issue · `production.completed` → issue components + receive finished good · `maintenance.parts_used` → issue
  - `quality.inspection_created` / `quality.inspection_completed` → QC-HOLD (see Behaviour) · `purchasing.goods_returned` → issue (return to supplier)
  - `sales.note_issued` → receive goods returned on a credit note (see Behaviour)
  - event-driven issues use `force: true` (record even if stock goes negative; the physical fact already happened)
- publishes `inventory.low_stock` once when on-hand crosses below a reorder point → Automation alert

## Extension ideas
Lots/serials, bin locations, stock counts, reorder points (new table + a scheduled route), valuation (FIFO) reading `unit_cost`.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.

Dashboard widgets, ⌘K commands and search for this module are declared in `src/ui.ts` (`widgets`, `commands`, `search`) — see docs/ui.md.
Screens added in wave 4: `holds` (กักกัน QC, row action ปล่อยเข้าคลัง), `anomalies` (สต็อกติดลบ/ผิดปกติ, row action รับทราบ), settings form loads `GET /settings`;
wave 8: `holdDetail` (facts + ประวัติการนำออกจากคลังกักกัน log, release action), holds list column คงเหลือในคลังกักกัน, `overrideHoldReason`
field on the transfer / adjust forms (admin override only); widgets `stock-negative-kpi` (สต็อกติดลบ / ในคลังกักกัน / รอตรวจ) and `stock-negative-bars` (shortQty per item @ warehouse).
