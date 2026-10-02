-- Wave 4: QC quarantine (hold warehouses), QC hold log, negative-stock anomalies, receive-into-hold setting.

-- a hold warehouse (QC-HOLD) keeps stock on hand but never "available"; moving stock out of it needs inventory.hold.release
alter table warehouses add column is_hold boolean not null default false;

alter table settings add column receive_into_hold boolean not null default false;

-- one row per QC inspection that put stock into quarantine
create table qc_holds (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  inspection_id uuid not null,
  inspection_no text not null,
  stage text,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  lot_no text,
  -- where the lot came from (and where accepted qty goes back to)
  warehouse_code text not null,
  hold_warehouse_code text not null,
  source_ref text,
  -- qty that went into hold, and what is still there for this inspection
  held_qty numeric(18,4) not null default 0,
  qty numeric(18,4) not null default 0,
  rejected_qty numeric(18,4),
  status text not null default 'pending' check (status in ('pending', 'rejected', 'released', 'returned')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, inspection_id)
);
-- @tenant qc_holds
create index qc_holds_status on qc_holds (tenant_id, status);

-- stock that went below zero (event-driven issues are recorded anyway; allowNegative issues too) — surfaced, never silent
create table stock_anomalies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  kind text not null default 'negative_stock' check (kind in ('negative_stock')),
  item_id uuid not null,
  item_code text not null,
  item_name text,
  warehouse_code text not null,
  qty_delta numeric(18,4) not null,
  on_hand_before numeric(18,4) not null,
  on_hand_after numeric(18,4) not null,
  ref_type text,
  ref_id text,
  -- 'event' = recorded from another module's event (force), 'user' = allowed by settings.allow_negative
  source text not null default 'event' check (source in ('event', 'user')),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledged_note text,
  created_at timestamptz not null default clock_timestamp()
);
-- @tenant stock_anomalies
create index stock_anomalies_open on stock_anomalies (tenant_id, created_at) where acknowledged_at is null;
