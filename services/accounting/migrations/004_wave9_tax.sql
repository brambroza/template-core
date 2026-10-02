-- Wave 9: credit/debit notes, supplier bills, supplier payments with WHT, ภ.พ.30 filing records.

-- A credit / debit note's VAT line names the tax invoice it corrects (§86/9, §86/10 — the note must refer to the original invoice);
-- shown in the output VAT register next to the note number.
alter table journal_lines add column tax_ref_invoice_no text;
alter table journal_lines add column tax_ref_invoice_date date;

-- WHT withheld on a supplier payment (credit lines on ภาษีหัก ณ ที่จ่ายค้างจ่าย): which return it goes on (PND3 | PND53), the income type
-- (e.g. 40(8) ค่าจ้างทำของ), the rate and the 50 ทวิ certificate number — the WHT-payable report reconciles against purchasing's ภ.ง.ด.3/53.
alter table journal_lines add column wht_form text check (wht_form in ('PND3', 'PND53'));
alter table journal_lines add column wht_income_type text;
alter table journal_lines add column wht_rate numeric(9,6);
alter table journal_lines add column wht_certificate_no text;

-- Supplier bills received from purchasing (purchasing.bill_recorded) and what accounting did with each one. A `goods` bill whose receipt already
-- booked AP and ภาษีซื้อ posts no journal (treatment `matched`) — this table is where the accountant still sees it.
create table supplier_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  bill_id uuid not null,
  bill_no text not null,
  bill_date date not null,
  due_date date,
  supplier_id uuid,
  supplier_name text not null,
  supplier_tax_id text,
  supplier_branch text,
  supplier_invoice_no text,
  supplier_invoice_date date,
  -- goods | service | expense
  kind text not null,
  po_no text,
  net numeric(18,4) not null,
  vat numeric(18,4) not null,
  gross numeric(18,4) not null,
  vat_claimable boolean not null,
  -- posted (expense/service JV) | matched (goods: receipt already booked AP + VAT, nothing to post) | vat_reclassed (goods: VAT moved between
  -- inventory and ภาษีซื้อ because the receipt booked it differently from the bill)
  treatment text not null,
  journal_id uuid references journal_entries(id),
  note text,
  event_id uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, bill_id)
);
-- @tenant supplier_bills
create index supplier_bills_po on supplier_bills (tenant_id, po_no);

-- ภ.พ.30 filings the user RECORDS after filing on rd.go.th (or on paper) — nothing is submitted from here (§83).
-- seq 0 = the ordinary return, 1.. = ภ.พ.30 เพิ่มเติม (amended return) with a reason. `figures` = the boxes as computed when the filing was recorded.
create table vat_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  seq int not null default 0,
  amend boolean not null default false,
  reason text,
  filed_date date not null,
  channel text not null check (channel in ('efiling', 'paper')),
  receipt_no text,
  -- what the taxpayer chose for an excess (box 12/16): carry to next month or cash refund; null when tax was payable
  refund_or_carry text check (refund_or_carry in ('carry', 'refund')),
  paid_amount numeric(18,4) not null default 0,
  zero_rated numeric(18,4) not null default 0,
  exempt numeric(18,4) not null default 0,
  surcharge numeric(18,4) not null default 0,
  penalty numeric(18,4) not null default 0,
  figures jsonb not null,
  filed_by uuid,
  filed_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, period, seq)
);
-- @tenant vat_returns
