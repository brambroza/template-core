-- Projects, members, milestones, tasks and timesheets.
-- Customer / manager / assignee / user are snapshots (id + name) from master-data and identity — never joined.

create table projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  name text not null,
  customer_id uuid,
  customer_name text,
  manager_id uuid,
  manager_name text,
  budget numeric(18,4) not null default 0 check (budget >= 0),
  start_date date,
  end_date date,
  status text not null default 'planning' check (status in ('planning', 'active', 'on_hold', 'done', 'cancelled')),
  description text,
  created_by uuid,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  check (end_date is null or start_date is null or end_date >= start_date),
  unique (tenant_id, no)
);
-- @tenant projects

create table project_members (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references projects(id) on delete cascade,
  user_id uuid not null,
  user_name text,
  role text,
  hourly_rate numeric(18,4) not null default 0 check (hourly_rate >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, project_id, user_id)
);
-- @tenant project_members

create table milestones (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references projects(id) on delete cascade,
  name text not null,
  due_date date,
  done boolean not null default false,
  done_at timestamptz,
  created_at timestamptz not null default now()
);
-- @tenant milestones

create table tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null references projects(id),
  milestone_id uuid references milestones(id) on delete set null,
  title text not null,
  description text,
  assignee_id uuid,
  assignee_name text,
  status text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  due_date date,
  estimate_hours numeric(18,4) not null default 0 check (estimate_hours >= 0),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);
-- @tenant tasks
create index tasks_project on tasks (project_id, status);
create index tasks_assignee on tasks (assignee_id, status);

-- One row per user per week (Monday); entries of a submitted/approved week are locked.
create table timesheet_weeks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  user_name text,
  week_start date not null check (extract(isodow from week_start) = 1),
  status text not null default 'draft' check (status in ('draft', 'submitted', 'approved')),
  submitted_at timestamptz,
  approved_by uuid,
  approved_at timestamptz,
  reject_reason text,
  unique (tenant_id, user_id, week_start)
);
-- @tenant timesheet_weeks

create table timesheet_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  week_id uuid not null references timesheet_weeks(id),
  user_id uuid not null,
  user_name text,
  work_date date not null,
  project_id uuid not null references projects(id),
  task_id uuid references tasks(id) on delete set null,
  hours numeric(18,4) not null check (hours >= 0.25 and hours <= 24),
  note text,
  created_at timestamptz not null default now()
);
-- @tenant timesheet_entries
create index timesheet_entries_user_date on timesheet_entries (user_id, work_date);
create index timesheet_entries_project on timesheet_entries (project_id);
