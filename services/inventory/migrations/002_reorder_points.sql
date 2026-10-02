-- minimum stock per item + warehouse; crossing below it publishes inventory.low_stock
create table reorder_points (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  warehouse_code text not null,
  min_qty numeric(18,4) not null check (min_qty >= 0),
  updated_at timestamptz not null default now(),
  unique (tenant_id, item_id, warehouse_code)
);
-- @tenant reorder_points
