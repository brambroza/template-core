-- Wave 8 (round-2 blocker #2): stock leaves a hold warehouse only through the hold flow (release / return to supplier);
-- an admin override needs a reason, and every reduction of a hold is logged so the hold list always matches the stock.

-- 'forced_out' = the held stock left by an admin override or another module's document (not by a QC decision)
alter table qc_holds drop constraint qc_holds_status_check;
alter table qc_holds add constraint qc_holds_status_check check (status in ('pending', 'rejected', 'released', 'returned', 'forced_out'));

-- one row per change of a hold's qty after it was created
create table qc_hold_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  hold_id uuid not null references qc_holds(id) on delete cascade,
  -- release (QC decision) | return (to supplier) | override (admin, reason required) | external (another module's document took it)
  kind text not null check (kind in ('release', 'return', 'override', 'external')),
  qty numeric(18,4) not null,
  qty_after numeric(18,4) not null,
  ref_type text,
  ref_id text,
  note text,
  user_id uuid,
  user_name text,
  created_at timestamptz not null default now()
);
-- @tenant qc_hold_log
create index qc_hold_log_hold on qc_hold_log (tenant_id, hold_id, created_at);
