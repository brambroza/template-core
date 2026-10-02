# accounting — Accounting (บัญชี) · feature

General ledger for a Thai SME (TFRS for NPAEs): chart of accounts, journal vouchers, period close, automatic posting from
Sales / Purchasing / Expense events, and the statements + tax reports an accountant prepares each month (ภ.พ.30, 50 ทวิ follow-up).
Requires only `identity`. `enhancedBy` sales, purchasing, expense (events consumed today), payroll, inventory (no events yet — see Gaps).

## Data
- `accounts` — `code` (unique), `name`, `name_en`, `type` asset|liability|equity|revenue|expense, `category` (statement line:
  current_asset, non_current_asset, current_liability, non_current_liability, equity, revenue, other_income, cost_of_sales, expense, income_tax),
  `parent_id` (a group of the same type), `is_group` (header — cannot be posted to), `role` (what the system uses it for: cash, bank, ar, ap, inventory,
  vat_output, vat_input, wht_receivable, deposit_received, …), `active`, `is_system` (seeded).
- `journal_entries` — `JV-2569-0001` (`nextDocNo('JV')`, BE year of the entry date), `entry_date`, `description`, `ref`, `note`,
  `status draft → posted → reversed`, `draft → cancelled`; `source_type` manual | reversal | <event type>, `source_id` (invoice/receipt/claim/return id;
  the event id for goods receipts), `source_event_id`, totals, `reversal_of` / `reversed_by`, created/posted by (+ names from the token).
  Unique (source_type, source_id) for non-cancelled entries and unique source_event_id → one journal per source document.
- `journal_lines` — `account_id`, `debit` xor `credit` (≥ 0), `description`, partner snapshot (`partner_id`, `partner_name`), `tax_base` (ฐานภาษี on VAT/WHT lines).
- `fiscal_periods` — `period` 'YYYY-MM' (Christian year), `open|closed`, who/when closed and reopened. No row = open.
- `posting_rules` — (event_type, leg) → `account_id` (null = not mapped), `side`, Thai `label`. Seeded with the defaults in `src/chart.ts`.
- `posting_errors` — one row per event that could not be posted: `reason`, `payload` (the event data), `attempts`, `open → resolved | dismissed`, `journal_id`.

## Behaviour
- **Chart setup**: `STANDARD_CHART` (src/chart.ts, ~75 accounts, 5-digit codes 1xxxx–5xxxx) + `DEFAULT_RULES` are inserted the first time a tenant
  lists accounts / rules, creates an account or journal, opens a report, or receives an event (`ensureChart`). `POST /accounts/setup` re-inserts any
  missing standard account/rule (never changes existing ones). Advisory lock per tenant.
- **Balancing** (`checkLines`, 400 Thai messages): ≥ 2 lines; each line exactly one side > 0; accounts exist, active, not a group; Σ debit = Σ credit
  (rounded to satang) — details `{ debit, credit, difference }`.
- **Statuses**: only drafts can be edited (`PUT /journals/:id`, `PUT /journals/:id/lines`), posted or cancelled (409 otherwise). Posted entries are corrected
  by `reverse`: a new posted JV with debit/credit swapped (`source_type 'reversal'`), the original becomes `reversed`. Reports count `posted` + `reversed`.
- **Periods**: posting, posting-on-create, reversing and auto-posting into a closed month → 409 (`งวดบัญชี … ปิดแล้ว`). Closing a month with drafts → 409.
  Drafts may still be keyed into a closed month. Reopen → 409 if already open.
- **Auto-posting** (`postEvent`, handlers): idempotent by event id (kernel inbox) **and** by source document; runs inside a savepoint and **never throws** —
  a missing / inactive / group account in a rule, a closed period or any DB error is stored in `posting_errors` (the event is acknowledged). Users fix the
  rule or reopen the period, then `retry` (re-runs the stored payload) or `dismiss` (book it by hand). Zero-amount events post nothing.
  Posting date = the event's `occurredAt` in Asia/Bangkok. Created-by name "ระบบ (ลงบัญชีอัตโนมัติ)".

| event | journal (default accounts) |
| --- | --- |
| `sales.invoiced` | Dr 11300 ลูกหนี้ (gross) / Cr 41000 รายได้ (gross − vat) / Cr 21200 ภาษีขาย (vat, tax_base = net); partner = customer |
| `sales.payment_received` kind `payment` | Dr 11100 เงินสด (method cash) or 11200 เงินฝาก (transfer/cheque/card) `received` + Dr 11600 ภาษีถูกหัก ณ ที่จ่าย `whtAmount` + Dr 21700 เงินมัดจำรับ `depositApplied` / Cr 11300 ลูกหนี้ (sum of debits; note if ≠ total) |
| `sales.payment_received` kind `deposit` | Dr เงินสด/เงินฝาก / Cr 21700 เงินมัดจำรับ (`total`) |
| `purchasing.goods_received` | Dr 11400 สินค้าคงเหลือ / Cr 21100 เจ้าหนี้ — Σ qty × unitPrice, **no VAT split** (event has none; note on the JV). One JV per event (partial receipts) |
| `purchasing.goods_returned` | Dr 21100 เจ้าหนี้ / Cr 11400 สินค้าคงเหลือ — Σ qty × unitPrice |
| `expense.claim_paid` | Dr 53900 ค่าใช้จ่ายเบ็ดเตล็ด (rule `expense`) / Cr 11200 เงินฝาก — `total` incl. VAT (event has no category/VAT split) |

- **Reports** (posted + reversed only; calendar fiscal year):
  - trial balance as of a date — per account Σ Dr, Σ Cr, balance in Dr or Cr column; `totals.difference` must be 0; `table` = rows + total row.
  - general ledger `from`–`to` per account (or all accounts) — opening (ยอดยกมา), lines with running balance in the account's normal direction, closing (ยอดยกไป).
  - P&L for a month + YTD: sections revenue, cost of sales, gross profit, SG&A, other income, profit before tax, income tax, net profit (by `category`).
  - balance sheet as of a date: by category; equity + "prior years' unclosed P&L" + "current year net profit" (no closing entries needed); `totals.difference` = 0.
  - VAT (ภ.พ.30) by month: output (role `vat_output`) and input (role `vat_input`) tax + base (`tax_base`), net payable / excess; `vat/lines` = the ภาษีขาย / ภาษีซื้อ register.
  - WHT received (role `wht_receivable`): lines per receipt, by month and by customer, and the account balance (to chase 50 ทวิ and offset ภ.ง.ด.50/51).
- Summary: revenue/expense/net this month (Bangkok), AR / AP / cash+bank balances, VAT payable (output − input), deposits held, drafts, open posting errors,
  `months[]` (6 × revenue, expense, net), `rows` (recent JVs with in-app `link`).

## API
- `POST /accounts/setup` · `GET /accounts?q=&type=&category=&role=&active=&postable=&groups=` (+ `balance`, `line_count`) · `GET /accounts/:id` (+ usage, balances incl. children, `movements`, `children_list`)
- `POST /accounts` · `PUT /accounts/:id` (code/type change only when unused; group ↔ detail rules; can't deactivate/group an account used by a posting rule) · `DELETE /accounts/:id` (409 if used / has children / in a rule)
- `GET /journals?q=&status=&source=&from=&to=&accountId=` · `GET /journals/:id` · `POST /journals { entryDate?, description, ref?, note?, lines[], post? }` (post needs `accounting.journal.post`)
- `PUT /journals/:id` (header) · `PUT /journals/:id/lines { lines }` · `POST /journals/:id/post | cancel | reverse { entryDate?, reason? }`
- `GET /posting-rules` · `PUT /posting-rules/:id { accountId | null }` · `GET /posting-errors?status=open|resolved|dismissed|all&q=` · `POST /posting-errors/:id/retry | dismiss`
- `GET /periods?year=` (12 months with entries / drafts) · `POST /periods/:period/close | reopen { note? }` (`:period` = YYYY-MM)
- `GET /reports/trial-balance?asOf=&all=` · `/reports/ledger?accountId=&from=&to=` · `/reports/profit-loss?month=` · `/reports/balance-sheet?asOf=` · `/reports/vat?year=` · `/reports/vat/lines?month=&kind=output|input` · `/reports/wht-received?year=`
- `GET /summary`

Permissions: `accounting.journal.read` (chart, journals, rules, errors, periods), `accounting.journal.write` (draft JVs), `accounting.journal.post`
(post, reverse, retry/dismiss posting errors), `accounting.account.write` (chart + posting rules), `accounting.period.close`, `accounting.report.read` (reports, summary).

## Events
- subscribes `sales.invoiced`, `sales.payment_received`, `purchasing.goods_received`, `purchasing.goods_returned`, `expense.claim_paid` (table above)
- publishes none

## Gaps (need contract fields — not changed here)
- `sales.invoiced` has no issue date → posted on the event date. `purchasing.goods_received` has no VAT mode/amount nor a receipt id/date; unit price may be VAT-inclusive.
- `expense.claim_paid` has no category lines, VAT, pay method or paid date → one expense account, bank. A `lines[{categoryCode, amount, vat}]` + `payMethod` field would allow a category → account map and ภาษีซื้อ.
- No supplier-invoice (AP bill) or supplier-payment event, no payroll / depreciation / COGS (inventory issue value) events → book by JV.
- Deposits: no output VAT on deposits (sales issues no deposit tax invoice yet). WHT received has no base (`wht_base` not in the event).

## Screens
`src/ui.ts` (area `finance`, icon `book`): jvList (row post), jvNew (lines, post now), jvEdit, jvDetail (flow, lines, post / edit lines / cancel / reverse,
printable ใบสำคัญทั่วไป with signatures), accounts (setup action) / accountNew / accountEdit / accountDetail (movements, children, delete),
postingRules (row: change account), postingErrors (retry / dismiss), periods (close / reopen), trialBalance, ledger (→ JV), profitLoss (mobile),
balanceSheet (mobile), vatReport, vatLines (→ JV), whtReceived (→ JV), revenueTrend.
Widgets: KPI (revenue, expense, net, AR, AP, posting errors), trends (revenue, net). ⌘K: `บันทึกบัญชี …` → JV form, `งบกำไรขาดทุน`, `งบทดลอง`,
`แยกประเภท <รหัส>`, `ภพ30`. Search: journals, accounts.

## Extension ideas
Fiscal year not starting in January, year-end closing entry to 32000, bank reconciliation, AP bills + payment vouchers with WHT (ภ.ง.ด.3/53, 50 ทวิ issue),
fixed-asset register → depreciation JVs, multi-currency, cost centres / departments on lines, recurring JVs, Excel export of statements, e-filing ภ.พ.30 file.
