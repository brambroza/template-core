-- Wave 4: parts come out of the spare-parts store by default, configurable per tenant.
create table settings (
  tenant_id uuid primary key,
  default_parts_warehouse text not null default 'SPARE'
);
-- @tenant settings

-- the warehouse the parts of a closed job were issued from (snapshot shown on the work order)
alter table work_orders add column parts_warehouse_code text;
