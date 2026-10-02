-- Wave 4 "who": locked approver chains, delegation while an approver is away, and who-acted-for-whom in the trail.

-- true = requesters cannot pick or change approvers; the type's chain is used (approvals admins may still change it)
alter table request_types add column lock_approvers boolean not null default true;

-- who actually acted on a step (an approver or their delegate) and, for a delegate, on whose behalf
alter table request_steps add column acted_by_name text;
alter table request_steps add column on_behalf_of_name text;

alter table request_history add column on_behalf_of_id uuid;
alter table request_history add column on_behalf_of_name text;

-- An approver hands their approvals to someone else for a date range (e.g. while on leave).
create table delegations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  from_user_id uuid not null,
  from_user_name text,
  to_user_id uuid not null,
  to_user_name text,
  starts_on date not null,
  ends_on date not null,
  note text,
  cancelled_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on),
  check (from_user_id <> to_user_id)
);
-- @tenant delegations
create index delegations_to on delegations (tenant_id, to_user_id, starts_on, ends_on);
create index delegations_from on delegations (tenant_id, from_user_id, starts_on, ends_on);
