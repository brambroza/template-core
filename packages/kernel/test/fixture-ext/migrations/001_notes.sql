create table notes (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, body text not null);
-- @tenant notes
