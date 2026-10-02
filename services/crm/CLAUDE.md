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
- publishes: none · subscribes: none. Candidates (not added): `crm.quotation_accepted` (→ Sales could draft a sales order), `crm.lead_created` (→ Automation LINE alert).

## Screens
`src/ui.ts`: leads/lead/leadNew/leadEdit, opportunities/opportunity/opportunityNew/opportunityEdit, myActivities/activities/activityNew,
quotes/quote (printable)/quoteNew. Widgets: KPI, pipeline (open stages), won-value trend. ⌘K: `เสนอราคา <ลูกค้า> <หมายเหตุ>`, `ลีด <บริษัท>`,
`เยี่ยมลูกค้า`, `งานติดตาม`; search over leads, opportunities, quotations. Mobile: leads, lead detail actions, log activity/visit, my activities.

## Extension ideas
Email/LINE the printed quote, lead scoring, auto-create a sales order on accept (via event), quote approval for big discounts.
