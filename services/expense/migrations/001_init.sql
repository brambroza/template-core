-- Expense claims (เบิกค่าใช้จ่าย): categories with optional monthly limits, claims with lines, cash advances (เงินทดรองจ่าย).

create table expense_categories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  -- per person per calendar month (incl. VAT); null = no limit
  monthly_limit numeric(18,4) check (monthly_limit is null or monthly_limit >= 0),
  requires_receipt boolean not null default false,
  note text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant expense_categories

create table claims (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  claimant_id uuid not null,
  claimant_name text,
  department text,
  purpose text not null,
  claim_date date not null default current_date,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved', 'paid', 'rejected', 'returned', 'cancelled')),
  net numeric(18,4) not null default 0,
  vat numeric(18,4) not null default 0,
  total numeric(18,4) not null default 0,
  over_limit boolean not null default false,
  -- [{ kind: 'limit'|'receipt', message, categoryCode, month, limit, used }]
  warnings jsonb not null default '[]'::jsonb,
  last_note text,
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  rejected_at timestamptz,
  paid_date date,
  pay_method text check (pay_method is null or pay_method in ('transfer', 'cash', 'cheque')),
  pay_reference text,
  paid_by uuid,
  -- set when a cash advance is cleared against this claim
  advance_id uuid,
  advance_no text,
  advance_amount numeric(18,4) not null default 0,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant claims
create index claims_status on claims (tenant_id, status);
create index claims_claimant on claims (tenant_id, claimant_id);

create table claim_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  claim_id uuid not null references claims(id) on delete cascade,
  line_no int not null,
  expense_date date not null,
  category_id uuid not null references expense_categories(id),
  category_code text not null,
  category_name text not null,
  receipt_required boolean not null default false,
  description text,
  amount numeric(18,4) not null check (amount >= 0),
  vat numeric(18,4) not null default 0 check (vat >= 0),
  total numeric(18,4) not null,
  receipt_no text,
  unique (claim_id, line_no)
);
-- @tenant claim_lines
create index claim_lines_category on claim_lines (tenant_id, category_id, expense_date);

create table advances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  requester_id uuid not null,
  requester_name text,
  department text,
  purpose text not null,
  amount numeric(18,4) not null check (amount > 0),
  needed_by date,
  status text not null default 'requested' check (status in ('requested', 'approved', 'paid', 'cleared', 'rejected', 'cancelled')),
  last_note text,
  approved_by uuid,
  approved_at timestamptz,
  paid_date date,
  pay_method text check (pay_method is null or pay_method in ('transfer', 'cash', 'cheque')),
  pay_reference text,
  claim_id uuid unique references claims(id),
  claim_no text,
  claim_total numeric(18,4),
  -- claim_total - amount: > 0 company pays the employee more, < 0 employee returns cash
  settle_amount numeric(18,4),
  cleared_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant advances
create index advances_status on advances (tenant_id, status);
