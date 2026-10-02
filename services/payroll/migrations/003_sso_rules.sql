-- C1: effective-dated social security (มาตรา 33) rates and wage band.
-- Rows with tenant_id null are the statutory schedule shipped with the software (readable by every tenant, writable by none);
-- rows with a tenant_id are that company's own overrides (e.g. a temporary rate cut). The calculation picks, per pay month,
-- the latest row with effective_from <= the 1st of the month (company row wins on the same date).
create table sso_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  effective_from date not null,
  employee_rate numeric(6,3) not null check (employee_rate >= 0 and employee_rate <= 20),
  employer_rate numeric(6,3) not null check (employer_rate >= 0 and employer_rate <= 20),
  wage_min numeric(18,4) not null check (wage_min >= 0),
  wage_max numeric(18,4) not null check (wage_max >= wage_min),
  note text,
  created_by text,
  created_by_name text,
  created_at timestamptz not null default now()
);
create unique index sso_rules_tenant_from on sso_rules (coalesce(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), effective_from);

-- statutory schedule (mirrors STATUTORY_SSO_SCHEDULE in src/calc.ts): ceiling 15,000 → 17,500 (1 Jan 2026 / 2569, cabinet Dec 2025)
-- → 20,000 (2029 / 2572) → 23,000 (2032 / 2575); floor 1,650; 5% + 5%
insert into sso_rules (tenant_id, effective_from, employee_rate, employer_rate, wage_min, wage_max, note) values
  (null, '1990-01-01', 5, 5, 1650, 15000, 'เพดานค่าจ้างเดิม 15,000 บาท'),
  (null, '2026-01-01', 5, 5, 1650, 17500, 'ครม. อนุมัติ ธ.ค. 2568 — เพดาน 17,500 สมทบสูงสุด 875'),
  (null, '2029-01-01', 5, 5, 1650, 20000, 'ขั้นที่ 2 ตามแผน (2572–2574) — เพดาน 20,000'),
  (null, '2032-01-01', 5, 5, 1650, 23000, 'ขั้นที่ 3 ตามแผน (2575 เป็นต้นไป) — เพดาน 23,000');

-- Companies that had customised the SSO numbers in payroll_settings.rules keep them: the service reads a non-default stored
-- rate/band as a company row from the month the settings were last saved (see loadRules in src/service.ts) — done in code because
-- migrations run under row-level security and cannot read other tenants' settings.

-- statutory rows are visible to every tenant (read only: the tenant_isolation policy below governs every write)
create policy sso_rules_statutory_read on sso_rules for select using (tenant_id is null);
-- @tenant sso_rules
