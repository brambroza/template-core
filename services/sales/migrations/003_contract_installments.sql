-- Wave 5: an MA contract installment (contracts.installment_due) becomes one draft service sales order — once per installment.
alter table sales_orders add column contract_installment_id uuid;
create unique index sales_orders_contract_installment on sales_orders (tenant_id, contract_installment_id) where contract_installment_id is not null;
