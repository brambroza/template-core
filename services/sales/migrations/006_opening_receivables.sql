-- ลูกหนี้ยกมา (phase 2): invoices still unpaid in the old system on the day the company starts, imported from Excel. They keep
-- the old document number, have no sales order (customer snapshot on the row instead), are not tax invoices of this system
-- (no sales.invoiced event: no output VAT, no e-Tax, no revenue posting — the ledger's AR comes from the accounting opening
-- balance) and are collected with normal receipts.
alter table invoices add column kind text not null default 'sale' check (kind in ('sale', 'opening'));
alter table invoices alter column order_id drop not null;
alter table invoices add constraint invoices_sale_has_order check (kind = 'opening' or order_id is not null);
alter table invoices add column opening_customer_id uuid;
alter table invoices add column opening_customer_code text;
alter table invoices add column opening_customer_name text;
alter table invoices add column opening_customer_tax_id text;
alter table invoices add column opening_customer_branch text;
alter table invoices add column opening_customer_address text;
alter table invoices add column opening_note text;
