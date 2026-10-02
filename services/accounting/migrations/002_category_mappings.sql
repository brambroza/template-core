-- Wave 5: expense-claim category → expense account (paid claims post one debit line per mapped account + input VAT).
-- Seeded with defaults (TRAVEL → ค่าเดินทาง, FUEL → ค่าน้ำมันเชื้อเพลิง, ENTERTAIN → ค่ารับรอง …) the first time the chart is set up.

create table category_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  -- the expense module's category code (matched case-insensitively), e.g. FUEL
  category_code text not null,
  -- optional: also matched by name (exact, case-insensitive) when the code is not mapped, e.g. ค่าน้ำมัน
  category_name text,
  account_id uuid not null references accounts(id),
  note text,
  -- inserted by the standard setup (may still be edited / deleted)
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- @tenant category_mappings
create unique index category_mappings_code on category_mappings (tenant_id, lower(category_code));
create index category_mappings_account on category_mappings (account_id);
