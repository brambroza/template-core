-- Wave 5: PM tickets from MA contracts (contracts.visit_due) — a reference to the source document and one ticket per PM visit.
alter table tickets add column ref text;
alter table tickets add column source_visit_id uuid;
create unique index tickets_source_visit on tickets (tenant_id, source_visit_id) where source_visit_id is not null;
