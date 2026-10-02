-- tenants is global (no RLS): login must find the tenant before a tenant context exists.
create table tenants (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  created_at timestamptz not null default now()
);

create table users (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  email text not null,
  name text not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (tenant_id, email)
);
-- @tenant users

create table roles (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  permissions text[] not null default '{}',
  unique (tenant_id, name)
);
-- @tenant roles

create table user_roles (
  tenant_id uuid not null,
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);
-- @tenant user_roles
