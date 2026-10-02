-- Wave 8 (accountant C2): a deposit (มัดจำ) that is part of the price is a VAT tax point (§78(1)(ข)) — the deposit receipt is also a
-- deposit tax invoice (ใบกำกับภาษีเงินมัดจำ DT-2569-0001) with its own base and output VAT. When the final tax invoice is issued the
-- deposit is deducted on it, so the invoice charges only the remaining VAT.
-- (The lock date lives in the kernel table _lock_date.)

-- deposits: VAT basis of the amount and the split; 'none' = not a tax point (e.g. a refundable guarantee), old rows = 'none'
alter table receipts add column vat_mode text not null default 'none' check (vat_mode in ('inclusive', 'exclusive', 'none'));
alter table receipts add column net numeric(18,4);
alter table receipts add column vat numeric(18,4) not null default 0;
alter table receipts add column tax_invoice_no text;
-- deposits only: VAT not yet deducted on a tax invoice (deposit_remaining counts the amount incl. VAT)
alter table receipts add column deposit_vat_remaining numeric(18,4) not null default 0 check (deposit_vat_remaining >= 0);
create unique index receipts_tax_invoice_no on receipts (tenant_id, tax_invoice_no) where tax_invoice_no is not null;

-- invoices: deposits deducted on the tax invoice; net / vat / gross stay this document's own base / VAT / amount due
alter table invoices add column deposit_net numeric(18,4) not null default 0;
alter table invoices add column deposit_vat numeric(18,4) not null default 0;
alter table invoices add column deposit_gross numeric(18,4) not null default 0;

-- a deposit is used either by a payment receipt (no VAT deposits) or deducted on a tax invoice (VAT deposits)
alter table deposit_applications alter column receipt_id drop not null;
alter table deposit_applications add column invoice_id uuid references invoices(id);
alter table deposit_applications add column invoice_no text;
alter table deposit_applications add column net numeric(18,4);
alter table deposit_applications add column vat numeric(18,4) not null default 0;
alter table deposit_applications add constraint deposit_applications_one_target check (num_nonnulls(receipt_id, invoice_id) = 1);
create index deposit_applications_invoice on deposit_applications (tenant_id, invoice_id) where invoice_id is not null;
