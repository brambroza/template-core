# payroll — Payroll (เงินเดือน) · feature

Thai monthly payroll for SME factories: HR keeps a pay profile per employee, creates the month's run, enters or imports
OT hours / work days / unpaid leave / bonus, calculates, the owner approves, finance marks it paid. Employees read their own
payslips and 50 ทวิ on the phone. Requires only `identity`; `hr` enhances it (employee codes, the monthly attendance summary as an import file).
**Privacy:** no national ID numbers and no full bank account numbers are stored — a typed account number is cut to its last 4 digits.

## Data
- `payroll_settings` (one row per tenant): `rules` jsonb = overrides of `PayrollRules` (src/calc.ts), `sso_employer_account`, `sso_branch`
- `pay_profiles`: snapshot of the HR employee (`employee_code` unique per tenant, `employee_name`, optional `employee_id`, department, position),
  `user_id` (identity user — unique per tenant — sees own payslips), `pay_type monthly | daily`, `base_salary` / `daily_wage`, `start_date` / `end_date`,
  `bank_name` + `bank_account_last4`, `sso_enrolled`, `pvd_employee_pct` / `pvd_employer_pct` (0–15), tax allowances (`tax_spouse`, `tax_children`,
  `tax_children2018`, `tax_parents`, life/health/parent-health insurance, home-loan interest, other — annual baht), opening YTD balances
  (`opening_year`, income, tax, sso, pvd) for going live mid-year, `active`
- `pay_items`: recurring `earning` (taxable?, counts as SSO wage?) or `deduction` (loan with optional `balance`) per profile
- `pay_runs`: `PR-2569-10` (BE year + month; `-2`… if a cancelled run used the number), `period` YYYY-MM (one non-cancelled run per month),
  `pay_date`, `draft → calculated → approved → paid` (+ `cancelled`), totals, created/approved/paid by + names, `pay_reference`
- `pay_lines` (= payslips): profile snapshots, month inputs (`work_days`, `ot1/ot15/ot2/ot3_hours`, `unpaid_leave_days`, `bonus`, `other_income`,
  `other_deduction`), results (salary, overtime, allowances, gross, SSO wage/employee/employer, PVD, WHT, loans, net, `taxable_regular/irregular`),
  itemised `earnings` / `deductions`, `recurring_taken`, `tax_detail` (projection), `warnings`

## Behaviour (calculation engine: `src/calc.ts`, pure, unit-tested in `test/calc.test.ts`)
- **Base pay**: monthly = salary, pro-rata for a partial month (joiner/leaver) by calendar days (setting `proration: days30` = salary ÷ 30 × days);
  daily = daily wage × `work_days` (empty → `defaultDailyWorkDays` (26) pro-rata, with a warning). Recurring earnings pro-rate like the salary.
- **OT**: hourly rate = salary ÷ 30 ÷ 8 (monthly) or daily wage ÷ 8; hours × 1 (monthly staff on a holiday) / 1.5 / 2 (daily staff on a holiday) / 3 — all multipliers are settings.
- **Unpaid leave** (monthly only): days × salary ÷ 30, never more than the salary.
- **SSO**: rate (5%) × wage clamped to [1,650, 15,000], half-up to whole baht, employee and employer. SSO wage = salary − unpaid + earnings flagged `sso`
  (+ OT only if `ssoIncludeOvertime`). Not enrolled → 0.
- **PVD**: % × (salary − unpaid). Employee 2–15%, employer ≥ employee (400 otherwise).
- **WHT ภ.ง.ด.1**: annualised with YTD correction. Regular income (salary − unpaid + taxable recurring earnings) projected = YTD regular +
  this month + full month × (remaining periods − 1); remaining = 13 − month (1 in a leaver's last month). Tax on projection + YTD irregular, minus tax
  already withheld, ÷ remaining periods. Irregular income (OT, bonus, other) is taxed in full in the month: tax(with) − tax(without).
  Net income = income − 50% expenses (cap 100,000) − personal 60,000 − spouse 60,000 − children 30,000 (60,000 for 2nd+ born ≥ 2018) − parents 30,000 (max 4)
  − projected SSO − PVD (≤ 15% wages, ≤ 500,000) − life+health insurance (life ≤ 100,000, health ≤ 25,000, together ≤ 100,000) − parents' health (≤ 15,000)
  − home-loan interest (≤ 100,000) − other. Brackets 0/5/10/15/20/25/30/35%. Over-withholding is never refunded through payroll (part = 0).
  YTD = approved/paid runs of earlier months of the same calendar year + opening balances when `opening_year` = that year.
- **Loans**: a deduction never exceeds its `balance`; paying the run reduces the balance and deactivates the item at 0.
- Runs: creating a run adds a line per active profile employed during the month; **calculate** re-syncs lines (adds new / drops inactive profiles,
  keeps inputs), refreshes snapshots and totals. Editing inputs of a calculated run recalculates it. Approve needs `payroll.run.approve` and every line
  calculated with net ≥ 0 (409). Reopen (approved → calculated) is refused when a later month is already approved/paid. Cancel only draft/calculated.
- Employees see payslips only of **paid** runs, matched by `pay_profiles.user_id` = the token's user.
- Settings: legal numbers live in `payroll_settings.rules` merged over `DEFAULT_RULES`; brackets must ascend and end with `upTo: null`.

## API
- `GET/PUT /settings` (PUT: `payroll.setup.write`)
- `GET /profiles` (`q`, `active`, `payType`, `department`) · `POST /profiles` · `GET/PATCH /profiles/:id` (detail has `items`, `recent`)
- `POST /profiles/import { rows, dryRun }` — upsert by employee code (Thai `รายเดือน/รายวัน`, `ใช่/ไม่`, dd/mm/พ.ศ. accepted; full account → last 4)
- `GET /items` (`q`, `kind`, `profileId`, `active`) · `POST /profiles/:id/items` · `PATCH /items/:id` · `DELETE /items/:id`
- `GET /runs` (`q`, `status`, `year` ค.ศ./พ.ศ.) · `POST /runs { period, payDate, note }` · `GET /runs/:id` (with `lines`, `problems`)
- `POST /runs/:id/calculate | approve | reopen | pay { paidDate, reference } | cancel { note }`
- `GET /payslips` (`q`, `runId`, `period`, `profileId`) · `GET /payslips/:id` (YTD, baht text) · `PUT /payslips/:id/inputs`
- `POST /inputs/import { rows, dryRun }` — columns period, employeeCode, workDays, ot1/ot15/ot2/ot3Hours, unpaidLeaveDays, bonus, otherIncome, otherDeduction, note
- `GET /my-payslips` (`year`, `q`) · `GET /my-payslips/:id` — `payroll.payslip.self`, own + paid only
- `GET /runs/:id/bank-transfer` (rows + per-bank totals) · `GET /runs/:id/sso` (สปส.1-10 data) · `GET /runs/:id/pnd1` (`withheldOnly`)
- `GET /certificates?year=` · `GET /certificates/:profileId_year` (50 ทวิ; the employee may open their own with `payroll.payslip.self`)
- `GET /summary` (kpis, `months` = last 6 months net/gross/cost, `rows` = runs)

Permissions: `payroll.payslip.self`, `payroll.profile.read|write`, `payroll.run.read|write|approve|pay`, `payroll.setup.write`.
Salaries are visible only with `payroll.profile.read` / `payroll.run.read`.

## Events
- publishes `payroll.run_paid` (runId, no, period, payDate, paidDate, headcount, `totals`, balanced `postings[]` by account category) on pay. Company totals only.
- subscribes: none. Suggested: `hr.employee_upserted` (code, name, department, position, start/resign dates, userId) to keep profiles in sync
  instead of `POST /profiles/import`; `hr.leave_decided` with employeeCode + days + unpaid flag to fill `unpaid_leave_days`.

## Screens
`myPayslips` / `myPayslip` (mobile, printable), `runs` → `runNew` → `runDetail` (flow, actions calculate/approve/pay/reopen/cancel, printable summary),
`payslips` (row action กรอก OT/วันลา, CSV import of inputs) → `payslipDetail` (printable payslip), `profiles` (CSV import) → `profileNew`/`profileEdit`/`profileDetail`
(add recurring item), `items` (edit/delete), `bankRuns` → `bankTransfer` (CSV via list export), `ssoRuns` → `ssoReport`, `pnd1Runs` → `pnd1Report` (printable),
`certificates` → `certificate` (50 ทวิ printable, ต้นฉบับ/สำเนา), `settings` / `settingsEdit`.
Widgets: kpi, run pipeline, 6-month net trend. ⌘K: `สลิป`, `ทำเงินเดือน`, `เงินเดือนพนักงาน EMP-001`, `50 ทวิ`.

## Extension ideas
Bank bulk-payment files (KBank/SCB/BBL formats — need full account numbers kept outside this DB), SSO e-filing text file and ภ.ง.ด.1/1ก RD e-filing files
(need the 13-digit IDs — keep them in a separate encrypted store), ภ.ง.ด.1ก annual form, severance pay calculator (LPA s.118), multiple pay periods per month
(semi-monthly), shift allowance from hr attendance, salary history / raises with effective dates, payroll journal posting in accounting.
