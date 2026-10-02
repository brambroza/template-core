-- Wave 9: supplier bills (ตั้งหนี้), supplier payments (PV) with withholding tax, 50 ทวิ certificates.

-- how much of each received PO line has been billed by the supplier (goods bills cannot exceed received − returned)
alter table po_lines add column billed_qty numeric(18,4) not null default 0;

-- a supplier's tax invoice / bill recorded as a payable (AP-2569-0001)
create table supplier_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  kind text not null check (kind in ('goods', 'service', 'expense')),
  bill_date date not null,
  due_date date,
  -- supplier snapshot from master-data's lookup (never read from master-data's database)
  supplier_id uuid,
  supplier_code text,
  supplier_name text not null,
  supplier_tax_id text,
  supplier_branch text,
  supplier_address text,
  supplier_invoice_no text not null,
  supplier_invoice_date date not null,
  po_id uuid references purchase_orders(id),
  po_no text,
  vat_mode text not null check (vat_mode in ('exclusive', 'inclusive', 'none')),
  net numeric(18,4) not null,
  vat numeric(18,4) not null,
  gross numeric(18,4) not null check (gross > 0),
  -- false = no full tax invoice (§86/4) — the VAT is part of the cost, not ภาษีซื้อ
  vat_claimable boolean not null,
  -- suggested WHT income type for paying it (service bills), see @erp/thai WHT_INCOME_TYPES
  wht_income_type text,
  paid numeric(18,4) not null default 0,
  status text not null default 'open' check (status in ('open', 'partially_paid', 'paid')),
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, no),
  check (paid <= gross)
);
-- @tenant supplier_bills
create index supplier_bills_open on supplier_bills (tenant_id, due_date) where status <> 'paid';

create table supplier_bill_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  bill_id uuid not null references supplier_bills(id) on delete cascade,
  line_no int not null,
  po_line_id uuid references po_lines(id),
  item_id uuid,
  item_code text,
  description text not null,
  qty numeric(18,4) not null check (qty > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  amount numeric(18,4) not null,
  unique (bill_id, line_no)
);
-- @tenant supplier_bill_lines

-- a payment voucher (PV-2569-0001) settling one or more bills of one supplier
create table supplier_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  payment_date date not null,
  method text not null check (method in ('cash', 'transfer', 'cheque')),
  supplier_id uuid,
  supplier_code text,
  supplier_name text not null,
  supplier_tax_id text,
  supplier_branch text,
  supplier_address text,
  -- null when nothing was withheld
  form text check (form in ('PND3', 'PND53')),
  gross numeric(18,4) not null,
  wht_total numeric(18,4) not null default 0,
  net_paid numeric(18,4) not null,
  bank_ref text,
  note text,
  warnings jsonb not null default '[]',
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant supplier_payments
create index supplier_payments_date on supplier_payments (tenant_id, payment_date);

create table supplier_payment_bills (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payment_id uuid not null references supplier_payments(id) on delete cascade,
  bill_id uuid not null references supplier_bills(id),
  bill_no text not null,
  amount numeric(18,4) not null check (amount > 0)
);
-- @tenant supplier_payment_bills

create table supplier_payment_wht (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  payment_id uuid not null references supplier_payments(id) on delete cascade,
  line_no int not null,
  income_type text not null,
  description text not null,
  rate numeric(9,6) not null check (rate > 0 and rate < 1),
  base numeric(18,4) not null check (base > 0),
  amount numeric(18,4) not null,
  -- 1 = หัก ณ ที่จ่าย (only condition supported for now)
  condition text not null default '1' check (condition in ('1', '2', '3')),
  unique (payment_id, line_no)
);
-- @tenant supplier_payment_wht

-- หนังสือรับรองการหักภาษี ณ ที่จ่าย ตามมาตรา 50 ทวิ — one per payment with WHT; id = the payment's id
create table wht_certificates (
  id uuid primary key references supplier_payments(id) on delete cascade,
  tenant_id uuid not null,
  certificate_no text not null,
  book_no text not null,
  number text not null,
  form text not null check (form in ('PND3', 'PND53')),
  print_count int not null default 0,
  last_printed_at timestamptz,
  last_printed_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, certificate_no)
);
-- @tenant wht_certificates
