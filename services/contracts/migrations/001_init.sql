-- Service contracts (MA): contracts with covered equipment, PM visits with checklists, billing installments.
-- Customers and technicians are snapshots (id + code/name) from master-data / identity, never joined.

create table contracts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  customer_id uuid,
  customer_code text,
  customer_name text not null,
  contact_name text,
  contact_phone text,
  title text not null,
  start_date date not null,
  end_date date not null,
  value numeric(18,4) not null default 0 check (value >= 0),
  billing_plan text not null default 'yearly' check (billing_plan in ('one_time', 'monthly', 'quarterly', 'yearly')),
  sla_response_hours numeric(8,2) not null default 4 check (sla_response_hours > 0),
  sla_resolve_hours numeric(8,2) not null default 24 check (sla_resolve_hours > 0),
  coverage text not null default '8x5' check (coverage in ('8x5', '24x7')),
  -- PM every N months (0 = no PM visits); first visit on first_pm_date (default start_date)
  pm_every_months int not null default 3 check (pm_every_months between 0 and 60),
  first_pm_date date,
  checklist text[] not null default '{}',
  technician_id uuid,
  technician_name text,
  note text,
  status text not null default 'draft' check (status in ('draft', 'active', 'expired', 'cancelled')),
  renewal_of uuid references contracts(id),
  renewal_of_no text,
  renewed_to_id uuid,
  renewed_to_no text,
  uplift_pct numeric(8,2),
  activated_at timestamptz,
  cancelled_at timestamptz,
  cancel_reason text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no),
  check (end_date >= start_date)
);
-- @tenant contracts
create index contracts_status on contracts (tenant_id, status, end_date);
create unique index contracts_one_renewal on contracts (tenant_id, renewal_of) where renewal_of is not null and status <> 'cancelled';

create table contract_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contract_id uuid not null references contracts(id) on delete cascade,
  asset text not null,
  serial_no text,
  location text,
  note text,
  created_at timestamptz not null default now()
);
-- @tenant contract_items
create index contract_items_contract on contract_items (contract_id);

create table installments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contract_id uuid not null references contracts(id) on delete cascade,
  seq int not null,
  due_date date not null,
  amount numeric(18,4) not null check (amount >= 0),
  invoiced boolean not null default false,
  invoice_no text,
  invoiced_on date,
  invoiced_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, contract_id, seq)
);
-- @tenant installments

create table visits (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  contract_id uuid not null references contracts(id),
  contract_no text not null,
  customer_id uuid,
  customer_name text not null,
  due_date date not null,
  scheduled_date date not null,
  technician_id uuid,
  technician_name text,
  status text not null default 'planned' check (status in ('planned', 'done', 'missed', 'cancelled')),
  started_at timestamptz,
  done_on date,
  done_at timestamptz,
  signoff_name text,
  findings text,
  missed_reason text,
  completed_by_name text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no),
  -- generation is idempotent per contract + due date
  unique (tenant_id, contract_id, due_date)
);
-- @tenant visits
create index visits_status on visits (tenant_id, status, scheduled_date);

create table visit_checks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  visit_id uuid not null references visits(id) on delete cascade,
  seq int not null,
  item text not null,
  result text check (result in ('pass', 'fail')),
  note text,
  checked_at timestamptz
);
-- @tenant visit_checks
create index visit_checks_visit on visit_checks (visit_id, seq);

-- one "contract expiring" alert per contract per month
create table expiry_notices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  contract_id uuid not null references contracts(id) on delete cascade,
  month text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, contract_id, month)
);
-- @tenant expiry_notices
