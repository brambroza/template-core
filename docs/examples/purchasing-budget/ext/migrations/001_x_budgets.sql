-- Customer extension: budget codes for purchasing (example — see docs/extending-with-ai.md)
create table x_budgets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  amount numeric(18,4) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant x_budgets

alter table purchase_orders add column x_budget_code text;
