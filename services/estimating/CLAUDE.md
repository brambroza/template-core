# estimating — Print Estimating (ประเมินราคางานพิมพ์) · feature

Read the root CLAUDE.md first. This file is the module-level brief.

## What this module does
Cost estimating for a printing house (sheet-fed work: leaflets, cartons, labels). The estimator picks a paper, a press and the
finishing, types the finished size and one or more print quantities; the module lays the job out on the sheet, runs the company's
cost formulas once per quantity and shows cost, selling price and profit side by side. Confirming the price of one quantity locks
the estimate and, with CRM installed, becomes a draft quotation.

Sizes are in **inches** and paper weight in **gsm**, the way Thai printers buy paper (31×43 นิ้ว 120 แกรม).

## Data
- `papers` (`code`, `gsm`, `width_in`, `length_in`, `price_unit` `ream | kg | sheet`, `price`) · `presses` (`max_width_in`/`max_length_in`,
  `plate_cost`, `makeready_cost` per colour, `run_cost_per_thousand` per colour, `min_impressions`, `makeready_waste` sheets per colour,
  `run_waste_pct`) · `finishings` (`charge_by` `per_job | per_sheet | per_piece | per_sqin`, `rate` (6 decimals), `setup_cost`, `min_charge`).
  All three have `active`; nothing is deleted.
- `formulas` (`code` = variable name, never changes; `label`, `expression`, `kind` `step | cost | price`, `seq`, `unit`, `system`, `active`).
  Seeded per company on first use from `DEFAULT_FORMULAS` (src/calc.ts). `system` formulas (`pressSheets`, `unitPrice`) can be
  rewritten but not switched off or change kind.
- `estimates` (`EST-2569-0001`, customer snapshot, sizes, paper/press snapshot codes, `ups`, `cuts`, colours, `margin_pct`, `qty_text`,
  `draft → confirmed | cancelled`, `confirmed_qty/unit_price/price`, `detail` jsonb = the rates, finishing, formulas and cost lines the
  numbers came from) · `estimate_breaks` (one row per print quantity: `press_sheets`, `total_cost`, `unit_cost`, `unit_price`, `price`, `profit`).

## Logic
- `src/formula.ts` — the formula language: numbers, variables, `+ - * /`, brackets, comparisons, `ceil floor round roundup min max abs if`.
  Parsed into a tree and evaluated; **never `eval`**, and variables are own properties only. Errors are Thai `FormulaError`s.
- `src/calc.ts` — pure costing. `fit()` lays rectangles out in the better of two orientations (pieces per press sheet, press sheets per
  parent sheet). `paperSheetCost()`: ream ÷ 500, or kg × (กว้าง × ยาว × แกรม ÷ 3100) ÷ 500, or the sheet price. `calculate()` runs the
  active formulas in `seq` order (the `price` formula last); each result becomes a variable for the next. `cost` results are rounded
  to satang and summed into `totalCost`; the `price` formula returns the **unit** price and `price = unit price × qty`, so a quotation
  line reproduces it exactly. `finishingCost` is filled in when the first formula reads it and needs `pressSheets` before it.
- Finishing charge = max(`setup_cost` + `rate` × basis × `times`, `min_charge`); basis = 1 / press sheets / pieces / press sheets × sheet area.
- `formulaSetProblem()` checks a whole set before it is saved: names, one price formula, `pressSheets` present, and a trial run on the
  `SAMPLE` job (catches typos and formulas placed before the ones they read). `INPUT_VARIABLES` documents every input.
- An estimate is a snapshot: changed rates or formulas reach a draft only through `recalculate`; confirmed estimates never move.

## API
- Rate tables, same shape for `/papers`, `/presses`, `/finishings`: `GET` (`?q`, `?active=1`) · `GET /:id` · `POST` · `PATCH /:id` ·
  `POST /import { rows, dryRun? }` (upsert by `code`, Thai words for units accepted, all rows or none, ≤ 2000 rows)
- `GET /formulas` · `GET /formulas/variables` · `GET /formulas/:id` · `POST /formulas` · `PATCH /formulas/:id` (400 with the Thai reason
  when the set would stop working) · `POST /formulas/test { expression }` (tries it on the sample job, saves nothing)
- `POST /estimates` (`quantities`: `"1000, 2000"` or an array; `ups`/`cuts` omitted = worked out; 400 when the job does not fit) ·
  `GET /estimates` (`?q`, `?status`) · `GET /estimates/:id` (with `breaks`, `cost_lines`, `finishing_lines`)
- `POST /estimates/:id/recalculate { quantities?, marginPct? }` · `POST /estimates/:id/confirm { qty? }` · `POST /estimates/:id/cancel` — drafts only (409 otherwise)
- `GET /summary`

Permissions: `estimating.estimate.read|write|confirm`, `estimating.rate.read|write`, `estimating.formula.write`.

## Events
- publishes `estimating.estimate_confirmed` (estimateId, no, jobName, customer snapshot, `description`, `qty`, `unitPrice`, `price`)
  — CRM (`enhancedBy`) drafts a quotation with that one line, once per estimate. Without CRM the confirmation still locks the price.
- subscribes: none

## Screens (src/ui.ts)
estimates → estimateNew (finishing as lines) → estimate (printable ใบประเมินราคางานพิมพ์, actions confirm / recalculate / cancel) ·
papers, presses, finishings (list + new + edit, each with "นำเข้าจาก Excel") · formulas (list + new + edit, "ลองสูตร") · variables.
Area `commercial`. ⌘K: `ประเมินราคา <ลูกค้า> <ชื่องาน>`.

## Extension ideas
Books and multi-section jobs (signatures, cover + text), work-and-turn plates, machine-hour costing, a price list per customer,
editing a draft's paper/press, copying an estimate, approval when the margin is under a floor, digital click charges by tier.
