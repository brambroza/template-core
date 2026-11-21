-- "ตั้งค่าเริ่มต้น" wizard of a self-serve company (phase 2): which of the 5 steps the owner finished or skipped, and when the
-- wizard was finished. Only cloud companies (provisioned with a plan) get a row; the others never see the wizard.
create table tenant_onboarding (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  done text[] not null default '{}',
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
-- @tenant tenant_onboarding
