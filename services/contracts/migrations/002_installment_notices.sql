-- Wave 5: installments due for invoicing are sent to Sales once (`contracts.installment_due` → draft sales order).
alter table installments add column notified_at timestamptz;
alter table installments add column notified_by_name text;
