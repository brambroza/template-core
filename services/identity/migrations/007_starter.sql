-- Sample data of a trial company (phase 2, @erp/starter): which industry it started with and how far seeding got. The owner
-- may clear the sample data once ("ล้างข้อมูลตัวอย่าง" → event identity.tenant_data_cleared → every module deletes the
-- company's rows); the row then stays with state 'cleared' so it can never be cleared again.
create table tenant_starter (
  tenant_id uuid primary key references tenants(id) on delete cascade,
  industry text not null,
  state text not null check (state in ('seeding', 'ready', 'failed', 'cleared')),
  summary jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  cleared_at timestamptz,
  cleared_by text
);
-- @tenant tenant_starter

-- the industry picked on the sign-up page (null = no sample data)
alter table signups add column industry text;
