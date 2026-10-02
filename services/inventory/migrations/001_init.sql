create table warehouses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant warehouses

create table stock_moves (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  warehouse_id uuid not null references warehouses(id),
  qty numeric(18,4) not null check (qty <> 0),
  unit_cost numeric(18,4),
  kind text not null check (kind in ('receive', 'issue', 'transfer_in', 'transfer_out', 'adjust')),
  ref_type text,
  ref_id text,
  note text,
  created_by uuid,
  -- clock_timestamp keeps moves inside one transaction in insertion order
  created_at timestamptz not null default clock_timestamp()
);
-- @tenant stock_moves
create index stock_moves_item_wh on stock_moves (tenant_id, item_id, warehouse_id, created_at);

create table settings (
  tenant_id uuid primary key,
  allow_negative boolean not null default false
);
-- @tenant settings
