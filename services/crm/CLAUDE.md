# crm — CRM & Quotations (ลูกค้าสัมพันธ์และใบเสนอราคา) · feature

Sales pipeline for B2B SMEs: leads → opportunities → quotations, with follow-up activities. Requires only core
(`identity` for owner lookups, `master-data` for customer/item lookups — stored as snapshots, never joined).

## Data
- `leads` (`LD-2569-0001`, source `website | line | phone | expo | referral | other`, `new → contacted → qualified → converted | lost`, `lost_reason`, `opportunity_id`)
- `opportunities` (`OP-…`, `partner_id` + `customer_name` snapshot or free text, `value`, `probability`, `expected_close`,
  stage `prospect → proposal → negotiation → won | lost`, `lost_reason`); `weighted_value = value × probability / 100` is computed in queries
- `activities` (`call | meeting | email | visit | task`, `due_at`, `done`, linked to a lead and/or opportunity, owner snapshot)
- `quotations` (`QT-…`, revisions `QT-2569-0001-R1` with `base_no`, `revision`, `revision_of`, `revised_by`; customer snapshot incl. tax id/branch/address;
  `subtotal` (before discount), `discount`, `net`, `vat`, `gross`, `vat_mode`; `draft → sent → accepted | rejected | expired`) · `quotation_lines` (item snapshot or description, `discount_pct`, `amount` after discount)

## Behaviour
- Owner defaults to the caller; `?mine=1` and `GET /activities/mine` use `owner_id = caller`.
- Convert: creates an opportunity (name defaults to "interest — company", customer defaults to the lead's company), moves the lead's
  open activities to it, marks the lead `converted`, returns the opportunity (201).
- Advancing a stage raises probability to at least 10/40/70 % (prospect/proposal/negotiation); win = 100 %, lose = 0 % + reason.
- Totals: line amount = qty × unit price × (1 − discount %); VAT via `documentTotals` (exclusive or inclusive). `gross_text` = baht text.
- `valid_until` defaults to issue date + 30 days. Only drafts can be edited (`PUT`); `revise` copies a sent/rejected/expired quote
  (once) into a new draft keeping the validity length.
- Sending a quote moves its opportunity from `prospect` to `proposal`. Accepting marks the opportunity `won` with `value = quote.net`.
- `valid_until` before `issue_date` → 400. Accept → 409 when the quote is past `valid_until` (revise it) or was superseded by a revision.
- `POST /quotations/expire-due { asOf? }` expires sent quotes past validity — idempotent, run daily.
- All status changes not allowed in the current state return 409.

## API
- Leads: `POST/GET /leads` (`?q,status,source,open,mine`) · `GET/PUT /leads/:id` · `POST /leads/:id/contact | qualify | lose {reason} | convert {name?, partnerId?, customerName?, value?, probability?, expectedClose?}` · `POST /leads/:id/activities`
- Opportunities: `POST/GET /opportunities` (`?q,stage,open,mine,partnerId`) · `GET/PUT /opportunities/:id` (with activities + quotations) · `POST /opportunities/:id/advance | win | lose {reason}` · `POST /opportunities/:id/activities`
- Activities: `POST/GET /activities` (`?q,type,mine,open,overdue,leadId,opportunityId`) · `GET /activities/mine` · `POST /activities/:id/done {note?}`
- Quotations: `POST/GET /quotations` (`?q,status,opportunityId,partnerId`) · `GET/PUT /quotations/:id` · `POST /quotations/:id/send | accept | reject {reason} | expire | revise` · `POST /quotations/expire-due`
- `GET /summary` → `openLeads, pipelineValue, weightedForecast, wonThisMonth, quotesSent, winRate, overdueActivities, myOpenActivities, months[{month,total,deals}], rows` (open opportunities)

Permissions: `crm.lead.read|write`, `crm.activity.write`, `crm.quote.read|write|decide`.

## Events
- publishes `crm.lead_created` (leadId, no, company, contactName, source) and `crm.quotation_accepted` (quotationId, no, customerName, total = gross,
  plus — optional in the contract, always sent now — `partnerId`, `customerTaxId`, `customerBranch`, `customerAddress`, `opportunityId`, `vatMode`,
  `subtotal`, `discount`, `net`, `vat`, `lines[{itemId, itemCode, itemName, description, qty, unitPrice, discountPct, amount}]`).
- subscribes: none. Automation alerts sales; **Sales drafts a sales order** from `crm.quotation_accepted` (same lines/discounts/VAT, `ref` = quotation no.,
  once per quotation). The quote screen cannot link to it (no cross-module links) — find it in Sales by searching the quotation no.

## Screens
`src/ui.ts`: leads/lead/leadNew/leadEdit, opportunities/opportunity/opportunityNew/opportunityEdit, myActivities/activities/activityNew,
quotes/quote (printable)/quoteNew. Widgets: KPI, pipeline (open stages), won-value trend. ⌘K: `เสนอราคา <ลูกค้า> <หมายเหตุ>`, `ลีด <บริษัท>`,
`เยี่ยมลูกค้า`, `งานติดตาม`; search over leads, opportunities, quotations. Mobile: leads, lead detail actions, log activity/visit, my activities.

## Recommended roles (identity settings — not code)
A service/sales company hit two permission gaps in the demo (sales/feedback/service-owner.md #7): sales could not create a customer, and the
project manager could not look up customers (or staff). Both are role settings in Identity; CRM only *reads* through the core lookups.
Give these roles (identity `POST /roles`, or the role templates in `services/identity/src/role-templates.ts`):

| Role | CRM | Core lookups it needs | Other modules |
| --- | --- | --- | --- |
| เซลส์ (sales) | `crm.lead.read/write`, `crm.activity.write`, `crm.quote.read/write/decide` | `master.partner.read` **+ `master.partner.write`** (create a new customer while quoting), `master.item.read`, `identity.user.read` (owner picker) | `sales.order.read/write`, `sales.receivable.read` |
| ผู้จัดการโครงการ (PM) | `crm.lead.read`, `crm.quote.read` (see what was sold) | **`master.partner.read`** (customer lookup on a project), **`identity.user.read`** (add team members) | `projects.*`, `sales.order.read`, `helpdesk.ticket.read` |
| หัวหน้าช่าง / ช่าง | — | `master.partner.read` (customer on a ticket), `master.item.read`, `identity.user.read` (assign) | `helpdesk.ticket.create/read/work`, `projects.timesheet.log`, `expense.claim.write` |
| บัญชี (accounts) | `crm.quote.read` | `master.partner.read` | `sales.order.read`, `sales.invoice.write`, `sales.receipt.write`, `sales.receivable.read` |
| ผู้บริหาร | `crm.lead.read`, `crm.quote.read` | `master.partner.read` | `sales.order.read`, `sales.receivable.read`, `helpdesk.ticket.read` |

A lookup to a core module is refused (403) when the user lacks that module's read permission, so the picker finds nothing — check the role before suspecting a bug.

## Extension ideas
Email/LINE the printed quote, lead scoring, auto-create a sales order on accept (via event), quote approval for big discounts.
