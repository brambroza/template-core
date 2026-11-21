-- Self-serve sign-up, password reset and a login throttle shared by every identity instance.
-- All three are used before anyone is signed in (no tenant context), so they are global tables that only identity's own
-- code reads; tokens are stored as SHA-256 hashes, never as sent.

-- A sign-up waiting for its e-mail link. The company, first admin and trial are created only when the link is opened.
create table signups (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  company_name text not null,
  name text not null,
  password_hash text not null,
  plan text not null check (plan in ('starter', 'factory', 'business')),
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  verified_at timestamptz,
  tenant_id uuid references tenants(id) on delete set null
);
-- @global signups
create index signups_email on signups (email, created_at desc);

-- "ลืมรหัสผ่าน": one-time links, 1 hour
create table password_resets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  user_id uuid not null,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz
);
-- @global password_resets

-- failed logins and rate-limited requests (sign-up, reset), counted per key over a sliding window
create table auth_attempts (
  key text not null,
  at timestamptz not null default now()
);
-- @global auth_attempts
create index auth_attempts_key on auth_attempts (key, at);
