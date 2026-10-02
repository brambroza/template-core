-- one active BOM per item (keep it simple; add versions in custom/ if a customer needs them)
create table boms (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  output_qty numeric(18,4) not null default 1 check (output_qty > 0),
  updated_at timestamptz not null default now(),
  unique (tenant_id, item_id)
);
-- @tenant boms

create table bom_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  bom_id uuid not null references boms(id) on delete cascade,
  line_no int not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  qty numeric(18,6) not null check (qty > 0),
  scrap_pct numeric(6,3) not null default 0 check (scrap_pct >= 0 and scrap_pct < 100)
);
-- @tenant bom_lines

create table production_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  qty numeric(18,4) not null check (qty > 0),
  completed_qty numeric(18,4) not null default 0,
  warehouse_code text not null default 'MAIN',
  due_date date,
  status text not null default 'planned' check (status in ('planned', 'released', 'completed', 'cancelled')),
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant production_orders
