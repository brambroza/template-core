alter table notes add column priority int not null default 0;
create table note_tags (id uuid primary key default gen_random_uuid(), tenant_id uuid not null, note_id uuid not null, tag text not null);
-- @tenant note_tags
