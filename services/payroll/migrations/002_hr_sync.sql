-- Wave 5: HR → Payroll through events.
-- hr.employee_upserted keeps the profile snapshot in sync (never the salary); hr.leave_decided (approved, unpaid type) records
-- unpaid leave days per month, added to that month's open run automatically.

-- when the profile was last updated from an HR event (null = keyed in / imported here)
alter table pay_profiles add column hr_synced_at timestamptz;
create index pay_profiles_employee on pay_profiles (tenant_id, employee_id) where employee_id is not null;

create table leave_inputs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- the HR leave request (LV-2569-0001) — snapshot, never joined
  leave_id uuid not null,
  leave_no text not null,
  type_name text,
  employee_id uuid,
  employee_code text not null,
  employee_name text,
  profile_id uuid references pay_profiles(id),
  -- pay month YYYY-MM and the working days of the leave in it
  period text not null check (period ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  days numeric(6,2) not null check (days >= 0),
  from_date date,
  to_date date,
  -- pending (no open run / no line yet: picked up when the run's lines are created) | applied (added to run_id's line) |
  -- late (the month's run was already approved / paid — key it in by hand)
  status text not null default 'pending' check (status in ('pending', 'applied', 'late')),
  run_id uuid references pay_runs(id),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, leave_id, period)
);
-- @tenant leave_inputs
create index leave_inputs_period on leave_inputs (tenant_id, period, employee_code);
