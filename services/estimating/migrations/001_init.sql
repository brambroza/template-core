-- Print estimating: rate tables (paper, presses, finishing), cost formulas kept as data, and estimates with one price per print quantity.
-- Sizes are in inches, paper weight in gsm. Customers come from master-data as snapshots (id + name), never joined.

create table papers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  gsm numeric(8,2) not null check (gsm > 0),
  width_in numeric(8,3) not null check (width_in > 0),
  length_in numeric(8,3) not null check (length_in > 0),
  -- the unit the merchant prices by: a ream of 500 sheets, a kilogram, or a single sheet
  price_unit text not null default 'ream' check (price_unit in ('ream', 'kg', 'sheet')),
  price numeric(18,4) not null check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant papers

create table presses (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  max_width_in numeric(8,3) check (max_width_in > 0),
  max_length_in numeric(8,3) check (max_length_in > 0),
  max_colors int check (max_colors between 1 and 12),
  plate_cost numeric(18,4) not null default 0 check (plate_cost >= 0),
  makeready_cost numeric(18,4) not null default 0 check (makeready_cost >= 0),
  run_cost_per_thousand numeric(18,4) not null default 0 check (run_cost_per_thousand >= 0),
  min_impressions int not null default 0 check (min_impressions >= 0),
  makeready_waste int not null default 0 check (makeready_waste >= 0),
  run_waste_pct numeric(9,4) not null default 0 check (run_waste_pct between 0 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant presses

create table finishings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  charge_by text not null default 'per_piece' check (charge_by in ('per_job', 'per_sheet', 'per_piece', 'per_sqin')),
  -- six decimals: lamination is priced per square inch (0.006 บาท/ตร.นิ้ว)
  rate numeric(18,6) not null default 0 check (rate >= 0),
  setup_cost numeric(18,4) not null default 0 check (setup_cost >= 0),
  min_charge numeric(18,4) not null default 0 check (min_charge >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant finishings

-- The company's costing formulas. `code` is the variable name later formulas read, so it never changes after creation.
create table formulas (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  label text not null,
  expression text not null,
  kind text not null default 'step' check (kind in ('step', 'cost', 'price')),
  seq int not null default 100,
  unit text,
  note text,
  -- system formulas (press sheets, selling price) can be rewritten but not switched off or change kind
  system boolean not null default false,
  active boolean not null default true,
  updated_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant formulas

create table estimates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  job_name text not null,
  partner_id uuid,
  customer_name text not null,
  customer_tax_id text,
  customer_branch text,
  customer_address text,
  finished_w numeric(10,3) not null,
  finished_l numeric(10,3) not null,
  bleed numeric(10,3) not null default 0,
  paper_id uuid not null,
  paper_code text not null,
  paper_name text not null,
  press_id uuid not null,
  press_code text not null,
  press_name text not null,
  press_sheet_w numeric(10,3) not null,
  press_sheet_l numeric(10,3) not null,
  ups int not null check (ups > 0),
  cuts int not null check (cuts > 0),
  colors_front int not null check (colors_front between 0 and 12),
  colors_back int not null check (colors_back between 0 and 12),
  margin_pct numeric(9,4) not null default 0,
  qty_text text not null,
  note text,
  status text not null default 'draft' check (status in ('draft', 'confirmed', 'cancelled')),
  confirmed_qty numeric(18,4),
  confirmed_unit_price numeric(18,4),
  confirmed_price numeric(18,4),
  confirmed_at timestamptz,
  confirmed_by_name text,
  -- snapshot of what the numbers were worked out from: rates, finishing chosen, formulas, cost lines per quantity
  detail jsonb not null,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant estimates
create index estimates_status on estimates (tenant_id, status);

create table estimate_breaks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  estimate_id uuid not null references estimates(id) on delete cascade,
  qty numeric(18,4) not null check (qty > 0),
  press_sheets numeric(18,4) not null,
  total_cost numeric(18,4) not null,
  unit_cost numeric(18,4) not null,
  unit_price numeric(18,4) not null,
  price numeric(18,4) not null,
  profit numeric(18,4) not null,
  unique (tenant_id, estimate_id, qty)
);
-- @tenant estimate_breaks
