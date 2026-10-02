create table machines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  location text,
  status text not null default 'running' check (status in ('running', 'down', 'retired')),
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant machines

create table pm_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  machine_id uuid not null references machines(id),
  title text not null,
  interval_days int not null check (interval_days > 0),
  next_due_on date not null,
  last_done_on date,
  active boolean not null default true
);
-- @tenant pm_plans

create table work_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  machine_id uuid not null references machines(id),
  kind text not null check (kind in ('breakdown', 'pm')),
  pm_plan_id uuid references pm_plans(id),
  due_on date,
  title text not null,
  description text,
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'cancelled')),
  reported_by uuid,
  reported_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  downtime_minutes int,
  resolution text,
  unique (tenant_id, no),
  unique (tenant_id, pm_plan_id, due_on)
);
-- @tenant work_orders

create table wo_parts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  work_order_id uuid not null references work_orders(id) on delete cascade,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  qty numeric(18,4) not null check (qty > 0)
);
-- @tenant wo_parts
