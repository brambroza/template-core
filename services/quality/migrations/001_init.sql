-- Quality Control (ควบคุมคุณภาพ): inspection plans, inspections with per-checkpoint results, NCR and corrective actions.
-- Items, suppliers and users are snapshots (id + code/name) — this module never reads another module's tables.

create table inspection_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  stage text not null check (stage in ('incoming', 'in_process', 'final')),
  sampling_mode text not null default 'fixed' check (sampling_mode in ('fixed', 'percent')),
  sampling_value numeric(18,4) not null check (sampling_value > 0),
  note text,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (sampling_mode <> 'percent' or sampling_value <= 100)
);
-- @tenant inspection_plans
-- one active plan per item + stage
create unique index inspection_plans_active_uq on inspection_plans (tenant_id, item_id, stage) where active;

create table plan_checkpoints (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  plan_id uuid not null references inspection_plans(id) on delete cascade,
  seq int not null,
  name text not null,
  method text,
  type text not null check (type in ('measure', 'pass_fail', 'visual')),
  unit text,
  target numeric(18,4),
  min_value numeric(18,4),
  max_value numeric(18,4),
  critical boolean not null default false,
  check (min_value is null or max_value is null or min_value <= max_value)
);
-- @tenant plan_checkpoints

create table inspections (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  stage text not null check (stage in ('incoming', 'in_process', 'final')),
  plan_id uuid references inspection_plans(id),
  plan_name text,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  lot_no text,
  source_type text not null default 'manual' check (source_type in ('manual', 'purchase_order', 'production_order')),
  source_ref text,
  source_id uuid,
  supplier_id uuid,
  supplier_name text,
  warehouse_code text,
  qty numeric(18,4) not null check (qty > 0),
  sample_size numeric(18,4) not null check (sample_size > 0),
  inspector_id uuid,
  inspector_name text,
  status text not null default 'pending' check (status in ('pending', 'in_progress', 'completed', 'cancelled')),
  result text check (result in ('pass', 'fail', 'conditional')),
  accepted_qty numeric(18,4),
  rejected_qty numeric(18,4),
  note text,
  source_event_id uuid,
  source_line int,
  created_by uuid,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique (tenant_id, no),
  -- event handlers create at most one inspection per received/produced line
  unique (tenant_id, source_event_id, source_line)
);
-- @tenant inspections
create index inspections_status_idx on inspections (tenant_id, status);

create table inspection_results (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  inspection_id uuid not null references inspections(id) on delete cascade,
  checkpoint_id uuid,
  seq int not null,
  name text not null,
  method text,
  type text not null check (type in ('measure', 'pass_fail', 'visual')),
  unit text,
  target numeric(18,4),
  min_value numeric(18,4),
  max_value numeric(18,4),
  critical boolean not null default false,
  value numeric(18,4),
  passed boolean,
  note text,
  recorded_by uuid,
  recorded_at timestamptz
);
-- @tenant inspection_results

create table ncrs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  inspection_id uuid references inspections(id),
  inspection_no text,
  stage text check (stage in ('incoming', 'in_process', 'final')),
  item_id uuid,
  item_code text,
  item_name text,
  lot_no text,
  source_ref text,
  supplier_id uuid,
  supplier_name text,
  description text not null,
  qty_affected numeric(18,4) check (qty_affected is null or qty_affected >= 0),
  severity text not null default 'minor' check (severity in ('minor', 'major', 'critical')),
  disposition text check (disposition in ('rework', 'scrap', 'use_as_is', 'return_to_supplier')),
  why_analysis text,
  root_cause text,
  status text not null default 'open' check (status in ('open', 'investigating', 'action', 'closed')),
  raised_by uuid,
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  closed_by uuid,
  unique (tenant_id, no)
);
-- @tenant ncrs
-- one NCR per inspection
create unique index ncrs_inspection_uq on ncrs (tenant_id, inspection_id) where inspection_id is not null;

create table corrective_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  ncr_id uuid not null references ncrs(id),
  action text not null,
  owner_id uuid,
  owner_name text,
  due_on date,
  status text not null default 'open' check (status in ('open', 'done', 'verified')),
  done_note text,
  done_at timestamptz,
  verified_note text,
  verified_at timestamptz,
  verified_by uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant corrective_actions
