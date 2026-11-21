-- Payments for cloud plans (bank transfers confirmed by GO Along staff in the back office). Stored with the paying company
-- (tenant-isolated); the back office lists them through the SELECT-only `ops_read` policy like tenant_subscriptions.
create table tenant_payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  plan text not null,
  months int not null check (months between 1 and 36),
  -- before VAT, THB
  amount numeric(14,2) not null check (amount >= 0),
  paid_on date not null,
  period_from date not null,
  period_to date not null,
  ref text,
  note text,
  by_name text not null,
  created_at timestamptz not null default now()
);
-- @tenant tenant_payments
create policy ops_read on tenant_payments for select using (current_setting('app.ops_read', true) = 'on');
create index tenant_payments_tenant on tenant_payments (tenant_id, paid_on desc);
