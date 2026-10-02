-- LINE to the person: link ERP users to LINE users of the company's LINE Official Account.
-- The LINE webhook URL is /line/webhook/<key>, key = tenant id (32 hex) + webhook_secret (32 hex):
-- the tenant comes from the key, every lookup then runs inside that tenant's RLS transaction.

create table line_settings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique,
  webhook_secret text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  rotated_at timestamptz
);
-- @tenant line_settings

-- one LINE account per ERP user and one ERP user per LINE account (per tenant)
create table line_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  user_name text,
  line_user_id text not null,
  line_name text,
  linked_at timestamptz not null default now(),
  unique (tenant_id, user_id),
  unique (tenant_id, line_user_id)
);
-- @tenant line_links

-- 6-digit one-time codes ("ผูกบัญชี 123456"), valid 10 minutes, single use
create table line_link_codes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null,
  user_name text,
  code text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  line_user_id text,
  created_at timestamptz not null default now()
);
-- @tenant line_link_codes
create index line_link_codes_code on line_link_codes (tenant_id, code);

-- wrong codes sent from a LINE account (brute-force brake: 5 per 15 minutes)
create table line_link_attempts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  line_user_id text not null,
  created_at timestamptz not null default now()
);
-- @tenant line_link_attempts
create index line_link_attempts_recent on line_link_attempts (tenant_id, line_user_id, created_at desc);
