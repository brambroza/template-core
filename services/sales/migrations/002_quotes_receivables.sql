-- Wave 4: quotation → sales order, line discounts/service lines, credit terms, receipts, deposits, receivables.

-- Sales orders: reference to the source document (e.g. accepted quotation) and credit terms.
alter table sales_orders add column ref text;
alter table sales_orders add column quotation_id uuid;
alter table sales_orders add column credit_days int not null default 0 check (credit_days between 0 and 365);
alter table sales_orders add column subtotal numeric(18,4);
alter table sales_orders add column discount numeric(18,4) not null default 0;
-- backfill existing rows (RLS is forced even for the owner, so lift it for the backfill only)
alter table sales_orders no force row level security;
update sales_orders set subtotal = case when vat_mode = 'exclusive' then net else gross end where subtotal is null;
alter table sales_orders force row level security;
-- one sales order per accepted quotation (idempotent event handling)
create unique index sales_orders_quotation on sales_orders (tenant_id, quotation_id) where quotation_id is not null;

-- Lines: per-line discount, free-text description, service lines without a stock item (not issued from stock).
alter table so_lines add column discount_pct numeric(18,4) not null default 0 check (discount_pct between 0 and 100);
alter table so_lines add column description text;
alter table so_lines alter column item_id drop not null;
alter table so_lines alter column item_code drop not null;

-- Invoices: due date (issue date + credit days) and amount settled by receipts (incl. withholding tax).
alter table invoices add column due_date date;
alter table invoices no force row level security;
update invoices set due_date = issue_date where due_date is null;
alter table invoices force row level security;
alter table invoices alter column due_date set not null;
alter table invoices add column paid_amount numeric(18,4) not null default 0 check (paid_amount >= 0);
alter table invoices add check (paid_amount <= gross);

-- Receipts (ใบเสร็จรับเงิน RC-2569-0001): kind 'payment' settles invoices; kind 'deposit' (มัดจำ) has no invoice
-- and its remaining balance can be applied to invoices by later payment receipts.
create table receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  kind text not null check (kind in ('payment', 'deposit')),
  customer_id uuid,
  customer_name text not null,
  customer_tax_id text,
  customer_branch text,
  customer_address text,
  order_id uuid references sales_orders(id),
  receipt_date date not null default current_date,
  method text not null check (method in ('cash', 'transfer', 'cheque', 'card')),
  reference text,
  -- payment: sum of invoice amounts settled; deposit: deposit amount
  total numeric(18,4) not null check (total > 0),
  wht_pct numeric(5,2) not null default 0,
  wht_amount numeric(18,4) not null default 0,
  deposit_applied numeric(18,4) not null default 0,
  -- money actually received now = total - wht_amount - deposit_applied
  received numeric(18,4) not null check (received >= 0),
  -- deposits only: not yet applied to invoices
  deposit_remaining numeric(18,4) not null default 0 check (deposit_remaining >= 0),
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant receipts
create index receipts_customer on receipts (tenant_id, customer_name);

create table receipt_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null references receipts(id) on delete cascade,
  line_no int not null,
  invoice_id uuid not null references invoices(id),
  invoice_no text not null,
  amount numeric(18,4) not null check (amount > 0),
  -- pre-VAT part of the amount (withholding tax base)
  wht_base numeric(18,4) not null,
  unique (receipt_id, line_no)
);
-- @tenant receipt_lines
create index receipt_lines_invoice on receipt_lines (tenant_id, invoice_id);

-- Deposits used by a payment receipt.
create table deposit_applications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  receipt_id uuid not null references receipts(id) on delete cascade,
  deposit_id uuid not null references receipts(id),
  deposit_no text not null,
  amount numeric(18,4) not null check (amount > 0)
);
-- @tenant deposit_applications
