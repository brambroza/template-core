-- Decide from LINE: "อนุมัติ" buttons on personal LINE cards (approval requests, leave).
--
-- line_actions: one row per button pushed to one person. The postback carries only the row id; the webhook checks that the
-- LINE account pressing it is linked to `user_id`, that it has not expired or been used, then publishes automation.line_decision
-- and the owning module decides with its own rules. result_* = what the module answered (also pushed back to the person).
create table line_actions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  target text not null,
  entity_id uuid not null,
  decision text not null default 'approved',
  title text not null,
  expires_at timestamptz not null,
  confirmed_at timestamptz,
  result_at timestamptz,
  result_ok boolean,
  result_message text,
  created_at timestamptz not null default now()
);
create index line_actions_user on line_actions (tenant_id, user_id, created_at desc);
-- @tenant line_actions

-- the permissions automation last saw on a valid token of the linked user (refreshed whenever they use the app);
-- sent with a LINE decision so the deciding module can refuse when roles changed since (identity revokes their tokens then)
alter table line_links add column perms text[];
alter table line_links add column perms_at timestamptz;
alter table line_link_codes add column perms text[];
