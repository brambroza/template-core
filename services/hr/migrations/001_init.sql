-- HR & Attendance (บุคคลและลงเวลา)
-- Deliberately NO national ID / bank account columns: this module never stores government ID numbers.

create table departments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  manager_name text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant departments

create table positions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant positions

create table employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  prefix text check (prefix in ('นาย', 'นาง', 'นางสาว')),
  first_name text not null,
  last_name text,
  nickname text,
  department_id uuid references departments(id),
  position_id uuid references positions(id),
  start_date date not null,
  birth_date date,
  phone text,
  email text,
  status text not null default 'active' check (status in ('active', 'probation', 'resigned')),
  resigned_on date,
  -- identity user id (snapshot link, no FK: identity owns users) so "me" endpoints work
  user_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant employees
create unique index employees_user_once on employees (tenant_id, user_id) where user_id is not null;

create table holidays (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  holiday_date date not null,
  name text not null,
  unique (tenant_id, holiday_date)
);
-- @tenant holidays

create table work_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  start_time time not null default '08:00',
  end_time time not null default '17:00',
  grace_minutes int not null default 0 check (grace_minutes between 0 and 240),
  saturday_workday boolean not null default false,
  updated_at timestamptz not null default now()
);
-- @tenant work_settings

create table leave_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  days_per_year numeric(6,1) check (days_per_year is null or days_per_year >= 0),
  allow_half_day boolean not null default true,
  active boolean not null default true,
  sort_order int not null default 100,
  unique (tenant_id, code)
);
-- @tenant leave_types

create table leave_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  employee_id uuid not null references employees(id),
  leave_type_id uuid not null references leave_types(id),
  from_date date not null,
  to_date date not null,
  half_day boolean not null default false,
  days numeric(6,1) not null check (days > 0),
  reason text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by uuid,
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date),
  unique (tenant_id, no)
);
-- @tenant leave_requests
create index leave_requests_emp on leave_requests (employee_id, from_date);

create table attendance (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  employee_id uuid not null references employees(id),
  work_date date not null,
  check_in_at timestamptz not null,
  check_out_at timestamptz,
  late_minutes int not null default 0,
  early_minutes int not null default 0,
  work_minutes int,
  in_lat numeric(9,6),
  in_lng numeric(9,6),
  out_lat numeric(9,6),
  out_lng numeric(9,6),
  note text,
  source text not null default 'self' check (source in ('self', 'admin')),
  recorded_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, employee_id, work_date)
);
-- @tenant attendance
create index attendance_date on attendance (work_date);
