-- Accounting (บัญชี): chart of accounts, journal vouchers (JV), fiscal periods, auto-posting rules and errors.

create table accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  name_en text,
  -- asset | liability | equity | revenue | expense
  type text not null check (type in ('asset', 'liability', 'equity', 'revenue', 'expense')),
  -- statement line: current_asset | non_current_asset | current_liability | non_current_liability | equity |
  -- revenue | other_income | cost_of_sales | expense | income_tax
  category text not null,
  parent_id uuid references accounts(id),
  -- group (header) accounts only sum their children; journals cannot post to them
  is_group boolean not null default false,
  -- what the system uses the account for: cash, bank, ar, ap, inventory, vat_output, vat_input, wht_receivable, … (null = ordinary)
  role text,
  active boolean not null default true,
  -- seeded by the standard chart (may still be renamed / deactivated)
  is_system boolean not null default false,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant accounts
create index accounts_parent on accounts (parent_id);

create table journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  entry_date date not null,
  description text not null,
  ref text,
  -- draft → posted (→ reversed when a reversing entry was made) | cancelled (drafts only)
  status text not null default 'draft' check (status in ('draft', 'posted', 'reversed', 'cancelled')),
  -- manual | sales.invoiced | sales.payment_received | purchasing.goods_received | purchasing.goods_returned | expense.claim_paid | reversal
  source_type text not null default 'manual',
  -- business id of the source document (invoice / receipt / claim id; the event id for goods receipts)
  source_id text,
  source_event_id uuid,
  note text,
  total_debit numeric(18,4) not null default 0,
  total_credit numeric(18,4) not null default 0,
  reversal_of uuid references journal_entries(id),
  reversed_by uuid references journal_entries(id),
  created_by uuid,
  created_by_name text,
  posted_at timestamptz,
  posted_by uuid,
  posted_by_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant journal_entries
create index journal_entries_date on journal_entries (tenant_id, entry_date);
-- one journal per source document (idempotent auto-posting even if an event is re-sent with a new id)
create unique index journal_entries_source on journal_entries (tenant_id, source_type, source_id) where source_id is not null and status <> 'cancelled';
create unique index journal_entries_event on journal_entries (tenant_id, source_event_id) where source_event_id is not null;

create table journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  journal_id uuid not null references journal_entries(id) on delete cascade,
  line_no int not null,
  account_id uuid not null references accounts(id),
  description text,
  debit numeric(18,4) not null default 0 check (debit >= 0),
  credit numeric(18,4) not null default 0 check (credit >= 0),
  -- partner snapshot (customer / supplier / employee) — no link to another module's database
  partner_id uuid,
  partner_name text,
  -- VAT / WHT lines: the amount the tax was computed on (ฐานภาษี), for the VAT and WHT reports
  tax_base numeric(18,4),
  check (not (debit > 0 and credit > 0))
);
-- @tenant journal_lines
create index journal_lines_journal on journal_lines (journal_id);
create index journal_lines_account on journal_lines (tenant_id, account_id);

create table fiscal_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- 'YYYY-MM' (Christian year); a month without a row is open
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  closed_by uuid,
  closed_by_name text,
  reopened_at timestamptz,
  reopened_by_name text,
  note text,
  unique (tenant_id, period)
);
-- @tenant fiscal_periods

create table posting_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_type text not null,
  -- the account slot inside the event's journal, e.g. ar, revenue, vat (see RULES in service.ts)
  leg text not null,
  label text not null,
  side text not null check (side in ('debit', 'credit', 'both')),
  account_id uuid references accounts(id),
  sort int not null default 0,
  updated_at timestamptz not null default now(),
  unique (tenant_id, event_type, leg)
);
-- @tenant posting_rules

create table posting_errors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  event_id uuid,
  event_type text not null,
  source_id text,
  source_no text,
  occurred_at timestamptz,
  reason text not null,
  payload jsonb not null,
  -- open → resolved (posted on retry) | dismissed
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  journal_id uuid references journal_entries(id),
  attempts int not null default 1,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by_name text
);
-- @tenant posting_errors
create unique index posting_errors_event on posting_errors (tenant_id, event_id) where event_id is not null;
