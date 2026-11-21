-- เจ้าหนี้ยกมา (phase 2): supplier invoices still unpaid in the old system on the day the company starts, imported from Excel.
-- A bill of kind 'opening': no VAT claimed here (vat_mode none, vat_claimable false), no purchasing.bill_recorded event (no
-- input VAT, no expense or stock posting — the ledger's AP comes from the accounting opening balance); paid with normal payment
-- vouchers.
do $$
declare r record;
begin
  for r in select conname from pg_constraint where conrelid = 'supplier_bills'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%' loop
    execute format('alter table supplier_bills drop constraint %I', r.conname);
  end loop;
end $$;
alter table supplier_bills add constraint supplier_bills_kind_check check (kind in ('goods', 'service', 'expense', 'opening'));
