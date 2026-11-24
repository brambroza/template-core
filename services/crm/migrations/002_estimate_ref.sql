-- A quotation drafted from a confirmed print estimate (event estimating.estimate_confirmed) remembers which one.
alter table quotations add column estimate_id uuid;
-- one quotation per estimate (idempotent event handling); revisions of it leave the column empty
create unique index quotations_estimate on quotations (tenant_id, estimate_id) where estimate_id is not null;
