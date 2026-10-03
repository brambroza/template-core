# etax — e-Tax Invoice (ใบกำกับภาษีอิเล็กทรอนิกส์)

Read the root CLAUDE.md first. This file is the module-level brief.

## What this module does
Prepares Thai e-Tax Invoice files for the tax invoices, credit notes and debit notes that **Sales** issues — and stops there.
Accounting/billing staff: open a document → "สร้าง XML" (ETDA ขมธอ. 3-2560 / UN/CEFACT CII, satang-exact totals) → optionally
"ลงลายมือชื่อดิจิทัล" (XAdES-BES with the company's own .p12) → download the XML → deliver it **outside** this module
(e-Tax Invoice by Email via ETDA, or upload at a Revenue-Department-approved service provider) → "บันทึกว่าส่งแล้ว" with the
reference they got. **The module never submits anything to the Revenue Department or ETDA and never checks that delivery
succeeded** — the "sent" status is what the user recorded. Every screen says so (`BOUNDARY` in service.ts = `BOUNDARY_TEXT` in ui.ts).

Legal basis (comments in etda.ts / service.ts): ประมวลรัษฎากร มาตรา 86/4, 86/9, 86/10; ประกาศอธิบดีกรมสรรพากรฯ (ฉบับที่ 196)
(e-Tax Invoice); พ.ร.บ.ธุรกรรมทางอิเล็กทรอนิกส์ 2544 มาตรา 26 (reliable electronic signature).

## Data
- `etax_settings` — one row per tenant: the seller profile used in the XML (this module's own copy — never read from identity),
  default invoice type (T02 / 388), and the uploaded PKCS#12 file + certificate metadata. **The .p12 password is never stored**:
  it is typed per signature (or set by the operator as env `ETAX_P12_PASSWORD`). The file bytes are never returned by the API.
- `etax_documents` — one snapshot per source document, unique per (`source`, `source_id`):
  `source` = `invoice` (sales.invoiced) | `note` (sales.note_issued) | `replacement` (created here by "ออกฉบับใหม่แทน").
  Holds buyer, lines, totals, generated XML / signed XML (+ sha256), delivery record, cancel record, replacement chain
  (`replaces_*` on the new document, `replaced_by_*` on the old one), `problems` / `warnings` shown on screen.
- Kernel `_attachments` (`document:<id>`): the generated `<no>.xml` / `<no>-signed.xml` (uploaded_by `system:etax`, only
  `etax.attachment.delete` may remove them) and the user's proof of delivery (ETDA e-mail receipt, SP acknowledgement PDF).

## Statuses (lock-step — `TRANSITIONS` in service.ts; every route checks it with the row locked `for update`)
```
incomplete ─(cancel)→ cancelled ─(restore)→ incomplete | draft
draft ─generate→ generated ─sign→ signed ─mark-sent→ sent_manual (e-Tax by Email) | sent_sp (service provider)
                 generated ─mark-sent→ sent_*          (SP may sign on the seller's behalf)
draft/generated/signed ─PATCH buyer→ draft (XML + signature cleared)     generate on generated/signed = regenerate (signature dropped)
draft/generated/signed/incomplete ─cancel→ cancelled                     sent_* ─unmark-sent→ signed | generated (fixing a wrong record)
sent_* (tax invoices only) ─replace→ replaced   + a NEW draft document (source replacement, PurposeCode TIVC01/02/99)
```
- A document recorded as sent can no longer be regenerated, re-signed, edited or cancelled. Wrong buyer name/address/other
  non-amount data → **replace** (TIVC01 ชื่อผิด / TIVC02 ที่อยู่ผิด / TIVC99 เหตุอื่น, with the original in
  `AdditionalReferencedDocument`). Wrong **amounts** → credit/debit note in Sales (arrives here as a new document, purpose codes
  CDNG/CDNS/DBNG/DBNS). Notes are never replaced here.
- Replacement number defaults to `<original>-R1`, `-R2` … and the date to today; the user may type both (conventions: CHECK
  with the accountant / service provider). Same lines and amounts as the original. Cancelling an unsent replacement re-opens the
  original (back to its sent status); restoring it marks the original replaced again.
- Cancel = "will not be issued as e-Tax from here" (paper invoice instead, duplicate…). It does NOT cancel anything in Sales.

## API (all JSON unless noted)
- GET /settings (read, write or settings perm) · PUT /settings (`etax.settings.write`)
- POST /settings/certificate `{ fileName?, dataBase64, password? }` · DELETE /settings/certificate (`etax.settings.write`)
  (settings carry `cert_warnings` — e.g. the certificate's subject does not contain the seller's tax ID — shown as "ข้อควรตรวจ"; the upload reply's `warnings` is the same list)
- GET /meta, GET /summary (`incomplete`, `draft`, `ready`, `sent` counts)
- GET /documents `?status=…|open|sent&kind=&from=&to=&q=` · GET /documents/:id (`etax.document.read`)
- GET /documents/:id/xml `[?signed=1]` → application/xml download · GET /documents/:id/verification (read)
- PATCH /documents/:id/buyer · POST /documents/:id/generate `{ typeCode?, purposeCode? }` · POST /documents/:id/sign `{ password? }`
- POST /documents/:id/mark-sent `{ channel: email_etda|service_provider, sentDate?, reference?, note? }` · POST /documents/:id/unmark-sent
- POST /documents/:id/cancel `{ reason }` · POST /documents/:id/restore
- POST /documents/:id/replace `{ purposeCode: TIVC01|TIVC02|TIVC99, reason?, buyerName?, buyerTaxId?, buyerBranch?, buyerAddress?, buyerEmail?, docNo?, issueDate? }` → 201 the new document
  (all document writes: `etax.document.write`)
- Kernel attachments: read = `etax.document.read`, upload = `etax.document.write`, delete system XML = `etax.attachment.delete`.

## Screens (src/ui.ts) — office work, not marked mobile
- documents (list, title states the boundary) → document (detail: boundary first, buyer, totals, checks, delivery record, lines,
  files; actions generate / sign / mark-sent / unmark / edit buyer / replace / cancel / restore, each gated on status)
- settings (detail: boundary, seller profile, certificate; upload / remove certificate) → settingsEdit (form)
- widget `etaxPulse` (kpi), palette search `etaxDocs`.

## Events
- publishes: none
- subscribes: `sales.invoiced` (needs the wave-9 optional `lines`, `customerAddress`, `customerEmail`), `sales.note_issued`.
  Handlers never throw for business reasons: an invoice without lines (old Sales), with no lines or with an invalid date
  becomes `incomplete` with the reason in `problems`. A re-sent fact refreshes only `incomplete` / `draft` snapshots and keeps a
  buyer corrected here (`buyer_edited_at`). A note takes the buyer address/e-mail from the invoice snapshot (or its latest
  replacement); a note that arrives first is back-filled when the invoice arrives.

## Honest limits (keep these true in the UI and docs)
- The XML follows the published standard as understood here; it has **not** been validated against ETDA's official XSD /
  schematron or the ETDA validation service from this repo. Items marked CHECK in etda.ts (namespaces, guideline ID, address
  codes, unit codes, purpose-code list) are the likely ones to adjust. `checkEtaxXml` is an internal structure/arithmetic check.
- No PDF/A-3 with embedded XML (what e-Tax by Email usually takes) is produced; no submission, no timestamping, no SP API.

## Tests
- test/xml.test.ts — pure: XML builder, settlement arithmetic, PKCS#12, XAdES (cross-checked with xmllint / lxml when present).
- test/service.test.ts — real service + database: snapshots, settings, generate/sign/verify with test/fixtures/*.p12.b64
  (password `test-pass-1234`), transitions and refusals, cancel/replace, permissions per endpoint, tenant isolation.
