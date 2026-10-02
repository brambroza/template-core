-- read model: filled from purchasing.goods_received, or entered manually when Purchasing is not installed
create table item_costs (
  tenant_id uuid not null,
  item_id uuid not null,
  item_code text not null,
  avg_cost numeric(18,4) not null,
  last_cost numeric(18,4) not null,
  qty_basis numeric(18,4) not null default 0,
  source text not null check (source in ('purchase', 'manual')),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, item_id)
);
-- @tenant item_costs

create table cost_sheets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  qty numeric(18,4) not null,
  material_cost numeric(18,4) not null,
  labor_cost numeric(18,4) not null,
  overhead_cost numeric(18,4) not null,
  total_cost numeric(18,4) not null,
  unit_cost numeric(18,4) not null,
  detail jsonb not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant cost_sheets

create table job_costs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  production_order_id uuid not null,
  order_no text not null,
  item_id uuid not null,
  item_code text not null,
  qty numeric(18,4) not null,
  material_cost numeric(18,4) not null,
  unit_cost numeric(18,4) not null,
  missing_costs text[] not null default '{}',
  detail jsonb not null,
  created_at timestamptz not null default now()
);
-- @tenant job_costs
