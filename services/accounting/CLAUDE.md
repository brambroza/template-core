# accounting — Accounting (บัญชี) · feature

General ledger for a Thai SME (TFRS for NPAEs): chart of accounts, journal vouchers, period close, automatic posting from
Sales / Purchasing / Expense events, and the statements + tax reports an accountant prepares each month (ภ.พ.30, 50 ทวิ follow-up).
Requires only `identity`. `enhancedBy` sales, purchasing, expense, payroll (events consumed), inventory (no events yet — see Gaps).
Wave 9: credit/debit notes, supplier bills and supplier payments with WHT are posted; the ภ.พ.30 return (boxes 1–16) is computed from the VAT registers
and the user RECORDS the filing made on rd.go.th — **nothing is submitted to the Revenue Department from this module**.

## Data
- `accounts` — `code` (unique), `name`, `name_en`, `type` asset|liability|equity|revenue|expense, `category` (statement line:
  current_asset, non_current_asset, current_liability, non_current_liability, equity, revenue, other_income, cost_of_sales, expense, income_tax),
  `parent_id` (a group of the same type), `is_group` (header — cannot be posted to), `role` (what the system uses it for: cash, bank, ar, ap, inventory,
  vat_output, vat_input, wht_receivable, deposit_received, …), `active`, `is_system` (seeded).
- `journal_entries` — `JV-2569-0001` (`nextDocNo('JV')`, BE year of the entry date), `entry_date`, `description`, `ref`, `note`,
  `status draft → posted → reversed`, `draft → cancelled`; `source_type` manual | reversal | <event type>, `source_id` (invoice/receipt/claim/return id;
  the event id for goods receipts), `source_event_id`, totals, `reversal_of` / `reversed_by`, created/posted by (+ names from the token).
  Unique (source_type, source_id) for non-cancelled entries and unique source_event_id → one journal per source document.
- `journal_lines` — `account_id`, `debit` xor `credit` (≥ 0), `description`, partner snapshot (`partner_id`, `partner_name`), `tax_base` (ฐานภาษี on VAT/WHT lines);
  (migration 003, C7/C8) the tax invoice behind a VAT line: `tax_invoice_no`, `tax_invoice_date`, `tax_party_name`, `tax_party_tax_id`, `tax_party_branch`
  (from the event: sales invoice + buyer tax ID/branch; supplier invoice keyed in at goods receipt; the seller on an expense-claim line).
- `fiscal_periods` — `period` 'YYYY-MM' (Christian year), `open|closed`, who/when closed and reopened. No row = open.
- `posting_rules` — (event_type, leg) → `account_id` (null = not mapped), `side`, Thai `label`. Seeded with the defaults in `src/chart.ts`.
- `category_mappings` (migration 002) — expense-claim category → account: `category_code` (unique, case-insensitive), optional `category_name` (fallback match),
  `account_id` (postable), `note`, `is_default`. Seeded from `DEFAULT_CATEGORY_MAP` (TRAVEL→52510 ค่าเดินทาง, FUEL→52520 ค่าน้ำมันเชื้อเพลิง, ENTERTAIN→52600 ค่ารับรอง,
  HOTEL→52530 ค่าที่พัก, TOLL, FREIGHT, PHONE, SUPPLIES, REPAIR, WELFARE, MISC) when the tenant has none.
- (migration 004, wave 9) `journal_lines.tax_ref_invoice_no/date` — the tax invoice a credit/debit note corrects (VAT line of the note);
  `journal_lines.wht_form` (PND3|PND53), `wht_income_type`, `wht_rate`, `wht_certificate_no` — on WHT-payable lines of supplier payments. Reversals copy all tax columns.
- `supplier_bills` (004) — every `purchasing.bill_recorded` received: bill/supplier/tax-invoice snapshot, kind, PO, net/vat/gross, `vat_claimable`,
  `treatment` posted | matched | vat_reclassed, `journal_id` (null when matched), `note` (price-difference / §82/3 notes). Unique bill_id (idempotency).
- `vat_returns` (004) — ภ.พ.30 filings the user recorded: `period`, `seq` (0 = ordinary, 1.. = ภ.พ.30 เพิ่มเติม), `amend`, `reason`, `filed_date`, `channel`
  efiling|paper, `receipt_no`, `refund_or_carry` (only when there was an excess), `paid_amount`, user inputs `zero_rated`/`exempt`/`surcharge`/`penalty`,
  `figures` (jsonb snapshot of box1…box16, + `previous_box11`/`additional_tax`/`due` on amendments), filed by.
- `posting_errors` — one row per event that could not be posted: `reason`, `payload` (the event data), `attempts`, `open → resolved | dismissed`, `journal_id`.

## Behaviour
- **Chart setup**: `STANDARD_CHART` (src/chart.ts, ~85 accounts, 5-digit codes 1xxxx–5xxxx) + `DEFAULT_RULES` (+ default category mappings) are inserted the first time a tenant
  lists accounts / rules, creates an account or journal, opens a report, or receives an event (`ensureChart`) — and again when a release adds default rules
  (`ensureChart` re-seeds when the tenant has fewer rules than `DEFAULT_RULES`; rules are never deleted, so new rules = append to `DEFAULT_RULES`).
  `POST /accounts/setup` re-inserts any missing standard account/rule (never changes existing ones). Advisory lock per tenant.
- **Balancing** (`checkLines`, 400 Thai messages): ≥ 2 lines; each line exactly one side > 0; accounts exist, active, not a group; Σ debit = Σ credit
  (rounded to satang) — details `{ debit, credit, difference }`.
- **Statuses**: only drafts can be edited (`PUT /journals/:id`, `PUT /journals/:id/lines`), posted or cancelled (409 otherwise). Posted entries are corrected
  by `reverse`: a new posted JV with debit/credit swapped (`source_type 'reversal'`), the original becomes `reversed`. Reports count `posted` + `reversed`.
- **Periods**: posting, posting-on-create, reversing and auto-posting into a closed month → 409 (`งวดบัญชี … ปิดแล้ว`). Closing a month with drafts → 409.
  Drafts may still be keyed into a closed month. Reopen → 409 if already open.
  Close publishes `accounting.period_closed { period, lastDate, closedByName }` and reopen `accounting.period_reopened { period, firstDate, reopenedByName }` (wave 8, C5)
  → Sales / Purchasing / Expense move their lock date so tax invoices, receipts, goods receipts and payments can't be dated into a closed month.
- **Auto-posting** (`postEvent`, handlers): idempotent by event id (kernel inbox) **and** by source document; runs inside a savepoint and **never throws** —
  a missing / inactive / group account in a rule, a closed period or any DB error is stored in `posting_errors` (the event is acknowledged). Users fix the
  rule or reopen the period, then `retry` (re-runs the stored payload) or `dismiss` (book it by hand). Zero-amount events post nothing.
  Posting date = the document date the event carries (`issueDate` / `paidDate` / `receivedDate` / `returnDate` / `receiptDate`), else the event's `occurredAt` in Asia/Bangkok.
  Default dates (`todayTh()`: JVs without a date, reports) use the kernel business clock (`thaiDate(now())`; tests freeze it with `setClock`).
  Created-by name "ระบบ (ลงบัญชีอัตโนมัติ)".

| event | journal (default accounts) |
| --- | --- |
| `sales.invoiced` | Dr 11300 ลูกหนี้ (gross) / Cr 41000 รายได้ (gross − vat) / Cr 21200 ภาษีขาย (vat, tax_base = net); partner = customer. With `depositApplied` (wave 8, C2): + Dr 21700 เงินมัดจำรับ (`depositApplied.net`, rule `deposit`) and revenue = gross − vat + `depositApplied.net` (full value); VAT = only the remaining VAT the invoice charges |
| `sales.payment_received` kind `payment` | Dr 11100 เงินสด (method cash) or 11200 เงินฝาก (transfer/cheque/card) `received` + Dr 11600 ภาษีถูกหัก ณ ที่จ่าย `whtAmount` (tax_base = `whtBase`, C4: sales computes it on the service part) + Dr 21700 เงินมัดจำรับ `depositApplied` / Cr 11300 ลูกหนี้ (sum of debits; note if ≠ total) |
| `sales.payment_received` kind `deposit` | Dr เงินสด/เงินฝาก (`total`) / Cr 21700 เงินมัดจำรับ (`net`) + Cr 21200 ภาษีขาย (`vat`, tax_base = net, rule `vat`, ref = deposit tax invoice `taxInvoiceNo`) — wave 8, C2: a deposit is a tax point. No `vat` (old payloads / non-VAT deposit): Cr 21700 `total` |
| `purchasing.goods_received` | with `net`+`vat` (or `vatMode` + line `vatRate`, default 7%): Dr 11400 สินค้าคงเหลือ (net) + Dr 11500 ภาษีซื้อ (vat, tax_base = net) / Cr 21100 เจ้าหนี้ (gross). Old payloads: Σ qty × unitPrice, no VAT split (note on the JV). One JV per event (partial receipts) |
| `purchasing.goods_returned` | with totals: Dr 21100 เจ้าหนี้ (gross) / Cr 11400 (net) + Cr 11500 ภาษีซื้อ (vat). Old payloads: Σ qty × unitPrice both sides |
| `expense.claim_paid` | with `lines`: one Dr per expense account (category → `category_mappings` by code, then name; unmapped → rule `expense` 53900, listed in the JV note; **C3: a line with `vatClaimable: false` adds its VAT to the expense**, noted on the JV) + Dr 11500 ภาษีซื้อ for claimable VAT only — one line per seller tax invoice (tax_base = amount, seller name/tax ID/branch, receipt no, expense date) when the lines carry the seller, else one line Σ vat (old payloads) / Cr 11100 เงินสด (`payMethod` cash, rule `cash`) or 11200 เงินฝาก (rule `bank`) = Σ (amount + vat); note when ≠ `total` or an advance was cleared. Old payloads: Dr 53900 / Cr bank `total` |
| `sales.note_issued` (wave 9) | credit (ใบลดหนี้ §86/10): Dr 41900 รับคืนและส่วนลดจ่าย (rule `returns`) net + Dr 21200 ภาษีขาย vat / Cr 11300 ลูกหนี้ net+vat. debit (ใบเพิ่มหนี้ §86/9): Dr 11300 / Cr 41000 (rule `revenue`) + Cr 21200. Dated `issueDate`; the VAT line carries the note no + date, customer tax ID/branch and `tax_ref_invoice_no/date` = the original invoice → output register row in the note's month (negative for credit). Reason / original / correct value in the JV note |
| `purchasing.bill_recorded` (wave 9) | `service` / `expense`: Dr 53400 ค่าบริการและค่าจ้างทำของ (rule `service`) or 53900 (rule `expense`) net (+ VAT when `vatClaimable` false, §82/5) + Dr 11500 ภาษีซื้อ (claimable; tax invoice = `supplierInvoiceNo`/date, supplier tax ID/branch) / Cr 21100 เจ้าหนี้. **`goods`: decision** — receipts already post Dr สินค้า + Dr ภาษีซื้อ / Cr เจ้าหนี้ (no GRNI account), so a goods bill is a *match*: claimable VAT already booked at receipt → **no journal** (`matched`; the receipt's ภาษีซื้อ lines without a tax invoice get the supplier invoice no/date/tax ID — metadata only); receipt without VAT split (old payload) → Dr 11500 / Cr 11400 (stock included VAT) or Cr 21100 (AP booked before VAT, decided by comparing billed vs booked AP); non-claimable VAT that the receipt booked → Dr 11400 / Cr 11500. No posted receipt for the PO yet → posting error (retry after the receipt). Price differences vs the receipt are only noted. §82/3: tax invoice > 6 months old → note. Every bill lands in `supplier_bills` |
| `purchasing.supplier_paid` (wave 9) | Dr 21100 เจ้าหนี้ (net paid + Σ WHT; note when ≠ `gross`) / Cr 11200 เงินฝาก (transfer/cheque, rule `bank`) or 11100 (cash) `netPaid` / Cr 21310 ภ.ง.ด.3 (rule `wht_pnd3`) or 21320 ภ.ง.ด.53 (`wht_pnd53`) per `wht[]` row: tax_base = base, form, income type, rate, 50 ทวิ no (note when amount ≠ base × rate) |
| `payroll.run_paid` | one line per `postings[]` entry, `category` = rule leg: Dr 52100 เงินเดือน, 52130 ค่าล่วงเวลา, 52150 เบี้ยเลี้ยง, 52140 โบนัส, 52100 เงินได้อื่น, 52110 ประกันสังคมนายจ้าง, 52120 กองทุนสำรองเลี้ยงชีพนายจ้าง / Cr 21400 ประกันสังคมค้างจ่าย, 21300 ภ.ง.ด.1 ค้างจ่าย, 21410 กองทุนสำรองเลี้ยงชีพค้างจ่าย, 11720 ลูกหนี้พนักงาน (เงินกู้/หักอื่น), 11200 เงินฝาก (สุทธิ). Source = `runId` (one JV per run). Unknown category → posting error |

- **Reports** (posted + reversed only; calendar fiscal year):
  - trial balance as of a date — per account Σ Dr, Σ Cr, balance in Dr or Cr column; `totals.difference` must be 0; `table` = rows + total row.
  - general ledger `from`–`to` per account (or all accounts) — opening (ยอดยกมา), lines with running balance in the account's normal direction, closing (ยอดยกไป).
  - P&L for a month + YTD: sections revenue, cost of sales, gross profit, SG&A, other income, profit before tax, income tax, net profit (by `category`).
  - balance sheet as of a date: by category; equity + "prior years' unclosed P&L" + "current year net profit" (no closing entries needed); `totals.difference` = 0.
  - VAT (ภ.พ.30) by month: output (role `vat_output`) and input (role `vat_input`) tax + base (`tax_base`; a reduction — purchase return, reversal — is negative).
    **C11**: months are never netted — `net` = this month's output − input, `carried_in` = ภาษีชำระเกินยกมา (excess of the previous month; the chain starts at the
    first month with VAT postings, across years), `payable`, `carry_forward` = ยอดภาษีซื้อเกินยกไป (assumes carry-forward, not a cash refund). Year row / `totals`:
    Σ payable, `carryForward` out of December, `carriedIntoYear`; `totals.net` is kept for old clients only.
  - `vat/lines` = the ภาษีขาย / ภาษีซื้อ register (C7/C8): per VAT line `tax_invoice_date`, `document_no` (the tax invoice number; the source reference when unknown),
    `party_name` (seller/buyer — not the claimant), `party_tax_id`, `party_branch_label` (สำนักงานใหญ่ / สาขา n), base and tax with the sign of the
    posting (returns negative), `ref` / `no` as references. Register totals = the ภ.พ.30 summary of the month.
  - WHT received (role `wht_receivable`): lines per receipt, by month and by customer, and the account balance (to chase 50 ทวิ and offset ภ.ง.ด.50/51).
  - **ภ.พ.30 return (wave 9, `src/tax.ts`)** — boxes 1–16 of the "การคำนวณภาษี" part of แบบ ภ.พ.30 (numbering from our reading of the form on rd.go.th —
    **ตรวจกับแบบ ภ.พ.30 ฉบับล่าสุด** before relying on box positions): 4 = output register base, 5 = output VAT, 6/7 = input register base/VAT,
    2 (0%-rated, §80/1) and 3 (exempt, §81) are **user inputs** (no VAT line exists for them; `revenue_without_vat` hints at the amount), 1 = 4 + 2 + 3,
    8/9 = 5 − 7 either way, **10 = ภาษีชำระเกินยกมา = box 16 of the previous month's latest recorded filing when it chose `carry`** (0 when refunded); if the
    previous month has no recorded filing, the ledger's own C11 chain is used and a warning is shown; 11/12 = 8 − 9 − 10 either way; 13 เงินเพิ่ม / 14 เบี้ยปรับ
    are user inputs (a §89/1 suggestion 1.5% per month or part of a month on box 11 is shown when late); 15/16 = 11 + 13 + 14 − 12 either way.
    Deadlines (§83): paper the 15th of the next month, e-Filing the 23rd (MoF e-Filing extension measure — check it is still in force; holidays not modelled).
    `changed_since_filing` when the ledger no longer matches the recorded figures (→ ภ.พ.30 เพิ่มเติม).
  - **Filing record** — `POST /pp30/:period/file` only RECORDS what the user filed on rd.go.th / on paper. 400: filed date before the month ended or in the future,
    amendment without reason; 409: already filed (unless `amend`), amendment with nothing filed. Closes nothing; warnings: accounting period still open,
    `paidAmount` ≠ amount due (box 15, or additional tax + 13 + 14 on an amendment), late without เงินเพิ่ม/เบี้ยปรับ, box 10 not from a recorded filing.
  - **WHT payable** (wave 9) — lines with `wht_form` (supplier payments; reversals negative) by month × form with base, amount and the ภ.ง.ด.3/53 deadlines
    (7th of next month on paper, 15th via e-Filing — §59 + e-Filing extension), plus the balances of the accounts mapped by rules `wht_pnd3` / `wht_pnd53`
    — reconcile against purchasing's ภ.ง.ด.3/53.
- Summary: revenue/expense/net this month (Bangkok), AR / AP / cash+bank balances, VAT payable (output − input), deposits held, drafts, open posting errors,
  `months[]` (6 × revenue, expense, net), `rows` (recent JVs with in-app `link`).

## API
- `POST /accounts/setup` · `GET /accounts?q=&type=&category=&role=&active=&postable=&groups=` (+ `balance`, `line_count`, `level` = depth under the top group, `row_kind` group|account — the chart screen indents by `level`) · `GET /accounts/:id` (+ usage, balances incl. children, `movements`, `children_list`)
- `POST /accounts` · `PUT /accounts/:id` (code/type change only when unused; group ↔ detail rules; can't deactivate/group an account used by a posting rule) · `DELETE /accounts/:id` (409 if used / has children / in a rule)
- `GET /journals?q=&status=&source=&from=&to=&accountId=` · `GET /journals/:id` · `POST /journals { entryDate?, description, ref?, note?, lines[], post? }` (post needs `accounting.journal.post`)
- `PUT /journals/:id` (header) · `PUT /journals/:id/lines { lines }` · `POST /journals/:id/post | cancel | reverse { entryDate?, reason? }`
- `GET /category-mappings?q=` · `GET /category-mappings/:id` · `POST /category-mappings { categoryCode, categoryName?, accountId, note? }` (409 duplicate code, 400 group/inactive account)
  · `PUT /category-mappings/:id` · `DELETE /category-mappings/:id` (write = `accounting.account.write`; an account used by a mapping cannot be deleted/deactivated)
- `GET /posting-rules` · `PUT /posting-rules/:id { accountId | null }` · `GET /posting-errors?status=open|resolved|dismissed|all&q=` · `POST /posting-errors/:id/retry | dismiss`
- `GET /periods?year=` (12 months with entries / drafts) · `POST /periods/:period/close | reopen { note? }` (`:period` = YYYY-MM)
- `GET /reports/trial-balance?asOf=&all=` · `/reports/ledger?accountId=&from=&to=` · `/reports/profit-loss?month=` · `/reports/balance-sheet?asOf=` · `/reports/vat?year=` · `/reports/vat/lines?month=&kind=output|input` · `/reports/wht-received?year=`
- `GET /summary`
- wave 9: `GET /reports/pp30?period=YYYY-MM&zeroRated=&exempt=&surcharge=&penalty=&filedDate=&channel=` (preview; inputs default to the latest filing's)
  · `GET /pp30/:period` (same payload, detail screen) · `GET /pp30?year=` (12 months: boxes 4/5/7/10/11/12/15/16, filing status, overdue; `first_vat_period`, `note`) —
  months before the first VAT posting in the ledger (any year; = go-live of VAT in this module) and not filed are `status: 'no_activity'` "ไม่มีรายการ", never overdue;
  later months without a filing past the e-Filing deadline stay overdue even when empty (a VAT registrant files zero returns — the screen says so)
  · `GET /reports/pp30/csv?period=` (UTF-8 BOM CSV of boxes 1–16) · `POST /pp30/:period/file { filedDate, channel: efiling|paper, receiptNo?, refundOrCarry: carry|refund,
  paidAmount, zeroRated?, exempt?, surcharge?, penalty?, amend?, reason? }` (201) · `GET /reports/wht-payable?year=&month=&form=PND3|PND53`
  · `GET /supplier-bills?q=&kind=&treatment=&from=&to=`

Permissions: `accounting.journal.read` (chart, journals, rules, errors, periods), `accounting.journal.write` (draft JVs), `accounting.journal.post`
(post, reverse, retry/dismiss posting errors), `accounting.account.write` (chart + posting rules), `accounting.period.close`, `accounting.report.read` (reports, summary),
`accounting.tax.read` (wave 9: ภ.พ.30 boxes / list / CSV, WHT payable), `accounting.tax.file` (wave 9: record a ภ.พ.30 filing / amendment). Supplier bills: `accounting.journal.read`.

## Events
- subscribes `sales.invoiced`, `sales.payment_received`, `purchasing.goods_received`, `purchasing.goods_returned`, `expense.claim_paid`, `payroll.run_paid`,
  `sales.note_issued`, `purchasing.bill_recorded`, `purchasing.supplier_paid` (wave 9) (table above)
- publishes `accounting.period_closed`, `accounting.period_reopened` (wave 8)

## Gaps
- Closed in wave 5: invoice issue date, goods-receipt VAT split, expense category/VAT/pay method/paid date, payroll journal.
- `purchasing.goods_received` has no receipt id (source = event id) — VAT is booked at receipt; the supplier's invoice no/date/tax ID shows in the register
  when the store keyed it in at receipt (optional). A supplier invoice arriving later still needs a JV.
- Cash advances (`expense` advances) publish no event → the advance payment is not booked; a claim that clears an advance is credited in full to cash/bank (JV note).
- ~~No supplier-invoice (AP bill) or supplier-payment event~~ closed in wave 9 (`purchasing.bill_recorded` / `purchasing.supplier_paid`). No depreciation events → book by JV.
- Wave 9 limits: goods-bill price differences vs the receipt are noted, not posted; goods returns are not netted when comparing billed vs received AP;
  a PO with a mix of VAT-split and old receipts is treated as "VAT booked". ภ.พ.30 boxes 2/3 (0% / exempt sales) are typed by the user. The ภ.พ.30 is
  **not** e-filed (needs RD e-Filing credentials / a service provider) — the module computes, prints, exports CSV and records the filing; the same for ภ.ง.ด.3/53.
  VAT payable is not cleared to 21220 automatically on filing — book the VAT-settlement JV (Dr 21200 / Cr 11500 / Cr 21220 or Dr ลูกหนี้กรมสรรพากร).
- **C6 — cost of sales (next step, not built):** today a delivery posts nothing, so ต้นทุนขาย is 0 and inventory only grows. Design:
  1. `costing` (it owns the moving-average cost) subscribes `sales.delivered` and publishes a new event `costing.delivery_costed`
     `{ orderId, orderNo, deliveryDate, warehouseCode, lines[{ itemId, itemCode, qty, unitCost, amount }], total }` — the value issued at the average cost at
     delivery time (append its zod schema in contracts; costing lists it in `publishes`; accounting adds it to `subscribes` / `enhancedBy` costing).
  2. accounting posts Dr 51100 ต้นทุนขาย (role `cogs`; new rule leg `cogs`, append to `DEFAULT_RULES`) / Cr 11400 สินค้าคงเหลือ (`inventory`) on `deliveryDate`,
     source = orderId + delivery seq (one JV per delivery), partner = customer; a sales return (future `sales.returned`) reverses it at the same cost.
  3. without costing installed: periodic method — a month-end JV from the stock count (inventory module's valuation report) — document it in the UI.
  Same pattern later for production issues (WIP) and scrap.
- Closed in wave 8: output VAT on deposits (C2) and period close → module lock dates (C5). WHT received now carries its base (`whtBase`, C4).

## Screens
`src/ui.ts` (area `finance`, icon `book`): jvList (row post), jvNew (lines, post now), jvEdit, jvDetail (flow, lines, post / edit lines / cancel / reverse,
printable ใบสำคัญทั่วไป with signatures), accounts (setup action) / accountNew / accountEdit / accountDetail (movements, children, delete),
postingRules (row: change account), categoryMappings (row: edit / delete) / categoryMappingNew, postingErrors (retry / dismiss), periods (close / reopen), trialBalance, ledger (→ JV), profitLoss (mobile),
balanceSheet (mobile), vatReport, vatLines (→ JV; wave 9: column "อ้างอิงใบกำกับเดิม"), whtReceived (→ JV), revenueTrend.
Wave 9: pp30List (→ pp30Detail), pp30Detail (boxes 1–16 in sections, printable worksheet "ภ.พ.30 — ใบสรุปสำหรับกรอกแบบ", filings table, actions
บันทึกว่ายื่นแล้ว / บันทึก ภ.พ.30 เพิ่มเติม with `accounting.tax.file`), pp30Boxes (boxes as rows → automatic CSV / print), whtPayable (month × form),
whtPayableLines (per 50 ทวิ → JV), supplierBills (→ JV). ⌘K `ยื่นภพ30`, `ภงด53`.
Widgets: KPI (revenue, expense, net, AR, AP, posting errors), trends (revenue, net). ⌘K: `บันทึกบัญชี …` → JV form, `งบกำไรขาดทุน`, `งบทดลอง`,
`แยกประเภท <รหัส>`, `ภพ30`. Search: journals, accounts.

## Extension ideas
Fiscal year not starting in January, year-end closing entry to 32000, bank reconciliation, AP bills + payment vouchers with WHT (ภ.ง.ด.3/53, 50 ทวิ issue),
fixed-asset register → depreciation JVs, multi-currency, cost centres / departments on lines, recurring JVs, Excel export of statements, e-filing ภ.พ.30 file.
