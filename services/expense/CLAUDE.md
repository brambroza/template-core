# expense — Expense Claims (เบิกค่าใช้จ่าย) · feature

Employees claim what they paid for the company (fuel, travel, entertainment, hotel…), a manager approves, finance pays.
Cash advances (เงินทดรองจ่าย) are paid out before the trip and cleared against the claim afterwards. Requires only `identity`.

## Data
- `expense_categories` — `code`, `name`, `monthly_limit?` (per person per calendar month, incl. VAT), `requires_receipt`, `note`, `active`
- `claims` — `EXP-2569-0001`, claimant (`claimant_id` = token user, `claimant_name`, `department`), `purpose`, `claim_date`,
  `status draft → submitted → approved → paid`, or `rejected | returned | cancelled`; `net`, `vat`, `total`; `over_limit`, `warnings` jsonb;
  `last_note`, pay info (`paid_date`, `pay_method transfer|cash|cheque`, `pay_reference`), cleared advance (`advance_id`, `advance_no`, `advance_amount`)
- `claim_lines` — `expense_date`, category snapshot (`category_id/code/name`, `receipt_required`), `description`, `amount`, `vat`, `total`, `receipt_no`
- `advances` — `ADV-2569-0001`, requester, `purpose`, `amount`, `needed_by`, `status requested → approved → paid → cleared` or `rejected | cancelled`,
  pay info, clearing (`claim_id` unique, `claim_no`, `claim_total`, `settle_amount = claim_total - amount`)

## Behaviour
- Totals: line total = amount + vat (rounded 2 dp with `round()`); claim net/vat/total = sums. `total_text` = Thai baht text for the printed form.
- Monthly limit **never blocks**: on create / line change / submit / reject / cancel the claim's `warnings` are recomputed —
  usage = the claimant's line totals in that category and month on every claim not rejected/cancelled (incl. drafts). `over_limit` = any limit warning.
  Warnings are a snapshot of the claim's last change; other claims are not re-evaluated.
- Lines: VAT ≤ amount and expense date ≤ today (Bangkok) (400). Submitting a claim totalling 0 → 400. Approvers cannot approve their own claim or advance (403).
- `requires_receipt`: a line without `receiptNo` gives a `receipt` warning on drafts and **blocks submit** (400).
- Owner actions (edit, lines, submit, cancel) — claimant, or a user with `expense.claim.approve`. Approve / reject (note) / return (note) — `expense.claim.approve`. Pay — `expense.claim.pay`.
- Visibility: users with approve or pay perms see everybody; everyone else only their own (others' records → 404).
- Advance clearing (`expense.claim.pay`): advance must be `paid`, the claim must be the same employee's, `approved` (not yet paid — a paid claim cannot absorb the advance, 409), and not already clearing another advance.
  `settle_amount > 0` company pays more; `< 0` employee returns cash (`settle_text` in Thai). The claim's `net_payable = total - advance_amount`.
- Wrong status → 409.

## API
- `GET/POST /categories` (`?q`, `?active`) · `GET/PUT /categories/:id` (detail has `used_this_month`)
- `POST /claims { purpose, claimantName?, department?, claimDate?, lines[{ expenseDate, categoryId, description?, amount, vat?, receiptNo? }], submit? }` → includes `warnings`
- `GET /claims` (`?q`, `?status`, `?mine=1`, `?from`, `?to`, `limit` 200) · `GET /my-claims` · `GET /claims/:id` · `PUT /claims/:id` · `PUT /claims/:id/lines`
- `POST /claims/:id/submit | approve {note?} | reject {note} | return {note} | pay {method, paidDate?, reference?} | cancel`
- `POST /advances` · `GET /advances` · `GET /advances/:id` · `POST /advances/:id/approve | reject {note} | pay | cancel | clear {claimId}`
- `GET /reports/by-category?month=YYYY-MM` · `GET /reports/outstanding` → `{ items (approved claims to pay), advances (paid, not cleared), toPayTotal, advanceTotal }`
- `GET /summary` → `toApprove, overLimit, toPay, toPayAmount, paidThisMonth, claimedThisMonth, myOpen, advancesToApprove, advancesOutstanding, byCategory[], months[{month,total,claims}], rows[]`

Permissions: `expense.claim.read | write | approve | pay`, `expense.category.write`.

## Events
- publishes `expense.claim_submitted` (claimId, no, claimantName, total, overLimit — after limit warnings are refreshed) on submit (also `POST /claims { submit: true }`).
- publishes `expense.claim_paid` (claimId, no, claimantName, total) on pay.
- subscribes: none. Candidates (not added): `expense.claim_approved`, advances events → an accounting module (post the expense journal).

## Screens
`src/ui.ts`: myClaims (mobile), claims (all, row approve), claimNew (mobile, lines), claimEdit, claimDetail (flow, lines + warnings, actions, printable),
toPay (row action pay), advances / advancesOpen / advanceNew (mobile) / advanceDetail (flow, clear with claim lookup, printable),
byCategory, monthly, categories / categoryNew / categoryEdit / categoryDetail.
Widgets: kpi, bars (`byCategory`), trend (`months`). ⌘K: `เบิก <เรื่อง>`, `เบิกล่วงหน้า <เรื่อง>`, `รอจ่าย`, `ใบเบิกของฉัน`. Search: claims, advances.

## Extension ideas
Receipt photos (store URLs), mileage rate per km, per-department budgets, block self-approval, export to accounting (journal CSV), withholding tax lines.
