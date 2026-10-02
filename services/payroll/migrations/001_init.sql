-- Payroll (เงินเดือน): pay profiles, recurring items, monthly runs with one payslip line per employee, settings.
-- Privacy: no national ID numbers and no full bank account numbers are stored anywhere in this module.

create table payroll_settings (
  tenant_id uuid primary key,
  -- PayrollRules overrides (see src/calc.ts); missing keys fall back to the built-in defaults
  rules jsonb not null default '{}'::jsonb,
  -- for สปส.1-10 / ภ.ง.ด.1 headers
  sso_employer_account text,
  sso_branch text,
  updated_at timestamptz not null default now()
);
-- @tenant payroll_settings

create table pay_profiles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- snapshot of the HR employee (hr owns employees; we never read its tables)
  employee_code text not null,
  employee_name text not null,
  employee_id uuid,
  department text,
  position text,
  -- identity user linked to this profile: sees their own payslips (GET /my-payslips)
  user_id uuid,
  user_name text,
  pay_type text not null default 'monthly' check (pay_type in ('monthly', 'daily')),
  base_salary numeric(18,4) not null default 0 check (base_salary >= 0),
  daily_wage numeric(18,4) not null default 0 check (daily_wage >= 0),
  start_date date,
  end_date date,
  bank_name text,
  -- last 4 digits only
  bank_account_last4 text check (bank_account_last4 is null or bank_account_last4 ~ '^[0-9]{4}$'),
  sso_enrolled boolean not null default true,
  pvd_employee_pct numeric(6,2) not null default 0 check (pvd_employee_pct between 0 and 15),
  pvd_employer_pct numeric(6,2) not null default 0 check (pvd_employer_pct between 0 and 15),
  -- tax allowances declared by the employee (ล.ย.01)
  tax_spouse boolean not null default false,
  tax_children int not null default 0 check (tax_children >= 0),
  tax_children2018 int not null default 0 check (tax_children2018 >= 0),
  tax_parents int not null default 0 check (tax_parents between 0 and 4),
  tax_life_insurance numeric(18,4) not null default 0 check (tax_life_insurance >= 0),
  tax_health_insurance numeric(18,4) not null default 0 check (tax_health_insurance >= 0),
  tax_parent_health numeric(18,4) not null default 0 check (tax_parent_health >= 0),
  tax_home_loan numeric(18,4) not null default 0 check (tax_home_loan >= 0),
  tax_other numeric(18,4) not null default 0 check (tax_other >= 0),
  -- year-to-date figures from the previous payroll system (same employer) when going live mid-year
  opening_year int,
  opening_income numeric(18,4) not null default 0,
  opening_tax numeric(18,4) not null default 0,
  opening_sso numeric(18,4) not null default 0,
  opening_pvd numeric(18,4) not null default 0,
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, employee_code)
);
-- @tenant pay_profiles
create unique index pay_profiles_user on pay_profiles (tenant_id, user_id) where user_id is not null;

create table pay_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  profile_id uuid not null references pay_profiles(id) on delete cascade,
  kind text not null check (kind in ('earning', 'deduction')),
  code text not null,
  name text not null,
  amount numeric(18,4) not null check (amount >= 0),
  taxable boolean not null default true,
  sso boolean not null default false,
  -- loans: remaining balance, reduced when a run is paid; null = no balance
  balance numeric(18,4) check (balance is null or balance >= 0),
  active boolean not null default true,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- @tenant pay_items
create index pay_items_profile on pay_items (profile_id);

create table pay_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  pay_date date not null,
  status text not null default 'draft' check (status in ('draft', 'calculated', 'approved', 'paid', 'cancelled')),
  note text,
  headcount int not null default 0,
  salary numeric(18,4) not null default 0,
  overtime numeric(18,4) not null default 0,
  allowances numeric(18,4) not null default 0,
  bonus numeric(18,4) not null default 0,
  other_income numeric(18,4) not null default 0,
  gross numeric(18,4) not null default 0,
  unpaid_leave numeric(18,4) not null default 0,
  sso_employee numeric(18,4) not null default 0,
  sso_employer numeric(18,4) not null default 0,
  pvd_employee numeric(18,4) not null default 0,
  pvd_employer numeric(18,4) not null default 0,
  wht numeric(18,4) not null default 0,
  loans numeric(18,4) not null default 0,
  other_deduction numeric(18,4) not null default 0,
  total_deductions numeric(18,4) not null default 0,
  net numeric(18,4) not null default 0,
  created_by uuid,
  created_by_name text,
  calculated_at timestamptz,
  approved_by uuid,
  approved_by_name text,
  approved_at timestamptz,
  paid_by uuid,
  paid_by_name text,
  paid_at timestamptz,
  pay_reference text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant pay_runs
-- one live run per month
create unique index pay_runs_period on pay_runs (tenant_id, period) where status <> 'cancelled';

create table pay_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  run_id uuid not null references pay_runs(id) on delete cascade,
  profile_id uuid not null references pay_profiles(id),
  -- snapshots (refreshed on every calculation until approval)
  employee_code text not null,
  employee_name text not null,
  department text,
  position text,
  user_id uuid,
  bank_name text,
  bank_account_last4 text,
  pay_type text not null,
  base_salary numeric(18,4) not null default 0,
  daily_wage numeric(18,4) not null default 0,
  sso_enrolled boolean not null default true,
  -- inputs of the month (entered or imported)
  work_days numeric(6,2),
  ot1_hours numeric(8,2) not null default 0,
  ot15_hours numeric(8,2) not null default 0,
  ot2_hours numeric(8,2) not null default 0,
  ot3_hours numeric(8,2) not null default 0,
  unpaid_leave_days numeric(6,2) not null default 0,
  bonus numeric(18,4) not null default 0,
  other_income numeric(18,4) not null default 0,
  other_deduction numeric(18,4) not null default 0,
  input_note text,
  -- results
  employed_days int,
  salary numeric(18,4) not null default 0,
  overtime numeric(18,4) not null default 0,
  allowances numeric(18,4) not null default 0,
  gross numeric(18,4) not null default 0,
  unpaid_leave numeric(18,4) not null default 0,
  sso_wage numeric(18,4) not null default 0,
  sso_employee numeric(18,4) not null default 0,
  sso_employer numeric(18,4) not null default 0,
  pvd_employee numeric(18,4) not null default 0,
  pvd_employer numeric(18,4) not null default 0,
  wht numeric(18,4) not null default 0,
  loans numeric(18,4) not null default 0,
  total_deductions numeric(18,4) not null default 0,
  net numeric(18,4) not null default 0,
  taxable_regular numeric(18,4) not null default 0,
  taxable_irregular numeric(18,4) not null default 0,
  earnings jsonb not null default '[]'::jsonb,
  deductions jsonb not null default '[]'::jsonb,
  recurring_taken jsonb not null default '[]'::jsonb,
  tax_detail jsonb not null default '{}'::jsonb,
  warnings jsonb not null default '[]'::jsonb,
  calculated boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (run_id, profile_id)
);
-- @tenant pay_lines
create index pay_lines_profile on pay_lines (profile_id);
