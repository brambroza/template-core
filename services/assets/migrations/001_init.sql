-- Fixed asset register: categories, assets, custodian/location history, repairs, disposal, physical audits.
-- Custodian is a snapshot (id + name) from identity — never joined.

create table asset_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  useful_life_years int not null default 5 check (useful_life_years between 0 and 100),
  method text not null default 'straight_line' check (method in ('straight_line', 'none')),
  salvage_pct numeric(18,4) not null default 0 check (salvage_pct >= 0 and salvage_pct < 100),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant asset_categories

create table assets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  category_id uuid not null references asset_categories(id),
  serial_no text,
  brand text,
  model text,
  location text,
  purchase_date date not null,
  cost numeric(18,4) not null check (cost >= 0),
  salvage_value numeric(18,4) not null default 0 check (salvage_value >= 0),
  -- copied from the category at registration so later category edits don't rewrite history
  useful_life_years int not null check (useful_life_years between 0 and 100),
  method text not null check (method in ('straight_line', 'none')),
  supplier_name text,
  warranty_until date,
  custodian_id uuid,
  custodian_name text,
  status text not null default 'in_storage' check (status in ('in_use', 'in_storage', 'in_repair', 'disposed', 'lost')),
  note text,
  disposed_on date,
  disposal_method text check (disposal_method in ('sold', 'scrapped', 'donated')),
  disposal_price numeric(18,4),
  disposal_book_value numeric(18,4),
  disposal_gain_loss numeric(18,4),
  disposal_note text,
  lost_on date,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (salvage_value <= cost),
  unique (tenant_id, code)
);
-- @tenant assets
create index assets_category on assets (category_id);
create index assets_location on assets (location);

create table asset_assignments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  asset_id uuid not null references assets(id),
  custodian_id uuid,
  custodian_name text,
  location text,
  assigned_on date not null,
  note text,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- @tenant asset_assignments
create index asset_assignments_asset on asset_assignments (asset_id, assigned_on);

create table asset_repairs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  asset_id uuid not null references assets(id),
  repair_date date not null,
  description text not null,
  vendor text,
  cost numeric(18,4) not null default 0 check (cost >= 0),
  status text not null default 'open' check (status in ('open', 'done')),
  -- asset status to return to when the repair is finished
  prev_status text,
  completed_on date,
  reported_by uuid,
  created_at timestamptz not null default now()
);
-- @tenant asset_repairs
create index asset_repairs_asset on asset_repairs (asset_id, repair_date);

create table asset_audits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  location text not null,
  note text,
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  unique (tenant_id, no)
);
-- @tenant asset_audits

-- expected = in the register at this location when the audit started; result is set on close.
create table asset_audit_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  audit_id uuid not null references asset_audits(id),
  asset_id uuid references assets(id),
  asset_code text not null,
  asset_name text,
  registered_location text,
  expected boolean not null,
  scanned_at timestamptz,
  result text check (result in ('found', 'missing', 'unexpected')),
  marked_lost boolean not null default false,
  unique (tenant_id, audit_id, asset_code)
);
-- @tenant asset_audit_lines
