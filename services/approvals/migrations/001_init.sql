-- e-Approval: request types (with a default approver chain), requests, their steps and an audit trail.

create table request_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  description text,
  -- free-text guidance such as "เกิน 50,000 บาท ต้องให้ MD อนุมัติ"
  amount_note text,
  -- ordered default approver chain: [{ "userId": "...", "userName": "..." }] (snapshot from identity /users)
  approvers jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant request_types

create table requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  type_id uuid not null references request_types(id),
  type_code text not null,
  type_name text not null,
  title text not null,
  detail text,
  amount numeric(18,4) check (amount is null or amount >= 0),
  needed_by date,
  requester_id uuid not null,
  requester_name text,
  department text,
  status text not null default 'draft' check (status in ('draft', 'pending', 'approved', 'rejected', 'returned', 'cancelled')),
  -- 1-based step number while pending; 0 otherwise
  current_step int not null default 0,
  step_count int not null default 0,
  last_note text,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant requests
create index requests_status on requests (tenant_id, status);
create index requests_requester on requests (tenant_id, requester_id);

create table request_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  request_id uuid not null references requests(id) on delete cascade,
  step_no int not null,
  approver_id uuid not null,
  approver_name text,
  status text not null default 'waiting' check (status in ('waiting', 'approved', 'rejected', 'returned')),
  acted_by uuid,
  acted_at timestamptz,
  note text,
  unique (request_id, step_no)
);
-- @tenant request_steps
create index request_steps_approver on request_steps (tenant_id, approver_id);

create table request_history (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  request_id uuid not null references requests(id) on delete cascade,
  at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  actor_name text,
  action text not null check (action in ('created', 'edited', 'approvers_changed', 'submitted', 'approved', 'rejected', 'returned', 'cancelled', 'commented')),
  step_no int,
  note text
);
-- @tenant request_history
create index request_history_request on request_history (request_id, at);
