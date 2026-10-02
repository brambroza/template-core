create table rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  event_type text not null,
  conditions jsonb not null default '[]',
  actions jsonb not null,
  enabled boolean not null default true,
  template_id text,
  fire_count int not null default 0,
  last_fired_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now()
);
-- @tenant rules

create table runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  rule_id uuid not null references rules(id) on delete cascade,
  rule_name text not null,
  event_type text not null,
  event_id uuid not null,
  status text not null check (status in ('done', 'failed', 'skipped')),
  detail text,
  created_at timestamptz not null default now()
);
-- @tenant runs
create index runs_recent on runs (tenant_id, created_at desc);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  rule_id uuid references rules(id) on delete set null,
  level text not null default 'info' check (level in ('info', 'warn', 'stop', 'ok')),
  title text not null,
  body text,
  link text,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
-- @tenant notifications
create index notifications_recent on notifications (tenant_id, created_at desc);
