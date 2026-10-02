-- Wave 4 "who": notifications addressed to one person, and per-user read state for broadcast notifications.

-- null = broadcast (everyone with automation.notify.read); otherwise only this identity user sees it
alter table notifications add column recipient_user_id uuid;
create index notifications_recipient on notifications (tenant_id, recipient_user_id, created_at desc);

-- who has read a broadcast notification (personal ones use notifications.read_at)
create table notification_reads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  notification_id uuid not null references notifications(id) on delete cascade,
  user_id uuid not null,
  read_at timestamptz not null default now(),
  unique (notification_id, user_id)
);
-- @tenant notification_reads
