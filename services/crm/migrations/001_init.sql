-- CRM: leads → opportunities → quotations, with activities on leads/opportunities.
-- Customer / item / user data from core modules is stored as snapshots (id + code/name), never joined.

create table leads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  company text not null,
  contact_name text,
  phone text,
  email text,
  line_id text,
  source text not null default 'other' check (source in ('website', 'line', 'phone', 'expo', 'referral', 'other')),
  interest text,
  note text,
  owner_id uuid,
  owner_name text,
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'converted', 'lost')),
  lost_reason text,
  opportunity_id uuid,
  converted_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant leads
create index leads_status on leads (tenant_id, status);

create table opportunities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  name text not null,
  lead_id uuid references leads(id),
  partner_id uuid,
  customer_name text not null,
  value numeric(18,4) not null default 0 check (value >= 0),
  probability int not null default 10 check (probability between 0 and 100),
  expected_close date,
  stage text not null default 'prospect' check (stage in ('prospect', 'proposal', 'negotiation', 'won', 'lost')),
  lost_reason text,
  owner_id uuid,
  owner_name text,
  note text,
  won_at timestamptz,
  closed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant opportunities
create index opportunities_stage on opportunities (tenant_id, stage);

create table activities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  type text not null check (type in ('call', 'meeting', 'email', 'visit', 'task')),
  subject text not null,
  due_at timestamptz,
  done boolean not null default false,
  done_at timestamptz,
  note text,
  lead_id uuid references leads(id) on delete cascade,
  opportunity_id uuid references opportunities(id) on delete cascade,
  owner_id uuid,
  owner_name text,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (lead_id is not null or opportunity_id is not null)
);
-- @tenant activities
create index activities_owner_open on activities (tenant_id, owner_id) where not done;

create table quotations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  base_no text not null,
  revision int not null default 0,
  revision_of uuid references quotations(id),
  revised_by uuid,
  opportunity_id uuid references opportunities(id),
  partner_id uuid,
  customer_name text not null,
  customer_tax_id text,
  customer_branch text,
  customer_address text,
  contact_name text,
  issue_date date not null default current_date,
  valid_until date,
  vat_mode text not null default 'exclusive' check (vat_mode in ('exclusive', 'inclusive')),
  subtotal numeric(18,4) not null,
  discount numeric(18,4) not null default 0,
  net numeric(18,4) not null,
  vat numeric(18,4) not null,
  gross numeric(18,4) not null,
  note text,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'rejected', 'expired')),
  sent_at timestamptz,
  decided_at timestamptz,
  reject_reason text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant quotations
create index quotations_status on quotations (tenant_id, status);

create table quotation_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  quotation_id uuid not null references quotations(id) on delete cascade,
  line_no int not null,
  item_id uuid,
  item_code text,
  item_name text,
  description text,
  qty numeric(18,4) not null check (qty > 0),
  unit_price numeric(18,4) not null check (unit_price >= 0),
  discount_pct numeric(18,4) not null default 0 check (discount_pct between 0 and 100),
  amount numeric(18,4) not null,
  unique (quotation_id, line_no)
);
-- @tenant quotation_lines
