-- Company profile per tenant: the seller details printed on every document (letterhead, tax invoice §86/4).
create table company_profiles (
  tenant_id uuid primary key,
  legal_name text not null,
  name_en text,
  branch_code text not null default '00000' check (branch_code ~ '^[0-9]{5}$'),
  branch_label text,
  address text not null,
  tax_id text check (tax_id is null or tax_id ~ '^[0-9]{13}$'),
  phone text,
  email text,
  website text,
  logo text,
  footer_note text,
  signature_labels text[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now()
);
-- @tenant company_profiles
