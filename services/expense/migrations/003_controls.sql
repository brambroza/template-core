-- Wave 8 (round-2 blocker #1): segregation of duties for paying claims and advances.
-- No row = the secure default (the approver of a claim/advance cannot record its payment).
create table settings (
  tenant_id uuid primary key,
  separate_payer boolean not null default true
);
-- @tenant settings
