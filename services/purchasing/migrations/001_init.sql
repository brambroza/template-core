create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  supplier_id uuid,
  supplier_name text not null,
  warehouse_code text not null default 'MAIN',
  order_date date not null default current_date,
  expected_date date,
  status text not null default 'draft' check (status in ('draft', 'approved', 'partially_received', 'received', 'cancelled')),
  vat_mode text not null default 'exclusive' check (vat_mode in ('exclusive', 'inclusive')),
  net numeric(18,4) not null,
  vat numeric(18,4) not null,
  gross numeric(18,4) not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now(),
  approved_by uuid,
  approved_at timestamptz,
  unique (tenant_id, no)
);
-- @tenant purchase_orders

create table po_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  po_id uuid not null references purchase_orders(id) on delete cascade,
  line_no int not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  qty numeric(18,4) not null check (qty > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  amount numeric(18,4) not null,
  received_qty numeric(18,4) not null default 0,
  unique (po_id, line_no)
);
-- @tenant po_lines
