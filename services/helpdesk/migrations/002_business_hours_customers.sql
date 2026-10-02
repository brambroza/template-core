-- Wave 4: business-hours SLA calendar, holidays, tickets linked to a customer / asset, reported time.

-- One row per tenant (missing row = defaults: Mon–Fri 08:00–17:00 Asia/Bangkok, business hours on, urgent 24×7).
create table sla_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  business_hours boolean not null default true,
  timezone text not null default 'Asia/Bangkok',
  work_days int[] not null default '{1,2,3,4,5}',
  work_start time not null default '08:00',
  work_end time not null default '17:00',
  urgent_24x7 boolean not null default true,
  updated_at timestamptz not null default now(),
  check (work_end > work_start)
);
-- @tenant sla_settings

create table holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  date date not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, date)
);
-- @tenant holidays

-- Customer snapshot (master-data partner) and asset / serial text; SLA clock starts at reported_at.
alter table tickets add column customer_id uuid;
alter table tickets add column customer_code text;
alter table tickets add column customer_name text;
alter table tickets add column asset_ref text;
alter table tickets add column reported_at timestamptz;
alter table tickets add column sla_mode text not null default 'clock' check (sla_mode in ('clock', 'business'));
alter table tickets no force row level security;
update tickets set reported_at = created_at where reported_at is null;
alter table tickets force row level security;
alter table tickets alter column reported_at set not null;
alter table tickets alter column reported_at set default now();
create index tickets_customer on tickets (tenant_id, customer_id);
