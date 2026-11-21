-- Cloud plans (Factory OS Cloud): one row per company that signed up for a plan. Companies without a row have no plan limit
-- (self-hosted installs keep every installed module). Tenant-isolated like every table; login reads it inside the company's
-- transaction. GO Along's own back office (internal /_ops routes only) lists every company through the SELECT-only `ops_read`
-- policy, on only while the transaction sets `app.ops_read = 'on'`. Plans themselves (modules, user limit, price) live in src/plans.ts.
create table tenant_subscriptions (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  plan text not null check (plan in ('starter', 'factory', 'business')),
  status text not null default 'trial' check (status in ('trial', 'active', 'suspended', 'cancelled')),
  -- overrides of the plan (null = the plan's own)
  modules text[],
  max_users int check (max_users is null or max_users > 0),
  trial_ends_at timestamptz,
  -- last Bangkok day paid for (bank transfer confirmed by GO Along staff)
  paid_through date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- @tenant tenant_subscriptions
create policy ops_read on tenant_subscriptions for select using (current_setting('app.ops_read', true) = 'on');

-- every change (plan, status, payment) for the record: who at GO Along did it and why
create table tenant_subscription_log (
  id bigserial primary key,
  tenant_id uuid not null references tenants(id) on delete cascade,
  change jsonb not null,
  by_name text,
  created_at timestamptz not null default now()
);
-- @tenant tenant_subscription_log
create index tenant_subscription_log_tenant on tenant_subscription_log (tenant_id, created_at desc);
