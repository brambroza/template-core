create table records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant records
