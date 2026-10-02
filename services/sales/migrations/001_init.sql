create table sales_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  customer_id uuid,
  customer_name text not null,
  customer_tax_id text,
  customer_branch text,
  customer_address text,
  warehouse_code text not null default 'MAIN',
  order_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'delivered', 'invoiced', 'cancelled')),
  vat_mode text not null default 'exclusive' check (vat_mode in ('exclusive', 'inclusive')),
  net numeric(18,4) not null,
  vat numeric(18,4) not null,
  gross numeric(18,4) not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant sales_orders

create table so_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  order_id uuid not null references sales_orders(id) on delete cascade,
  line_no int not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  qty numeric(18,4) not null check (qty > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  amount numeric(18,4) not null,
  unique (order_id, line_no)
);
-- @tenant so_lines

create table invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  order_id uuid not null references sales_orders(id),
  issue_date date not null default current_date,
  net numeric(18,4) not null,
  vat numeric(18,4) not null,
  gross numeric(18,4) not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, no),
  unique (order_id)
);
-- @tenant invoices
