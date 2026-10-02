create table items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  type text not null check (type in ('raw', 'semi', 'finished', 'spare', 'service')),
  uom text not null default 'pcs',
  std_price numeric(18,4),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant items

create table partners (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  code text not null,
  name text not null,
  kind text not null check (kind in ('customer', 'supplier', 'both')),
  tax_id text,
  branch text not null default '00000',
  address text,
  phone text,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, code)
);
-- @tenant partners
