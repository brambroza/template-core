-- Wave 8 (round-2 blocker #1): segregation of duties and approval limits for purchase orders, plus a receipt log.

-- per-company controls; no row = the secure defaults below
create table settings (
  tenant_id uuid primary key,
  -- the person who created a PO cannot approve it
  creator_cannot_approve boolean not null default true,
  -- ascending tiers on the PO's gross (incl. VAT): the first tier whose upTo >= gross (null = no upper bound) names the permission needed;
  -- holders of a later tier's permission may approve lower tiers too
  approval_tiers jsonb not null default '[{"upTo": 50000, "perm": "purchasing.po.approve"}, {"upTo": null, "perm": "purchasing.po.approve-high"}]'
);
-- @tenant settings

alter table purchase_orders add column created_by_name text;
alter table purchase_orders add column approved_by_name text;

-- one row per goods receipt: who received what; `by_approver` = the approver of the PO received it themself
-- (allowed, but an internal-control exception the auditor wants to see)
create table po_receipts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  po_id uuid not null references purchase_orders(id) on delete cascade,
  po_no text not null,
  received_by uuid,
  received_by_name text,
  by_approver boolean not null default false,
  lines jsonb not null default '[]',
  gross numeric(18,4) not null default 0,
  note text,
  created_at timestamptz not null default now()
);
-- @tenant po_receipts
create index po_receipts_po on po_receipts (tenant_id, po_id, created_at);
create index po_receipts_by_approver on po_receipts (tenant_id, created_at desc) where by_approver;
