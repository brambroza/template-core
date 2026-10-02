-- Wave 9: credit notes (ใบลดหนี้ CN-2569-0001, ประมวลรัษฎากร มาตรา 82/10 + 86/10) and debit notes (ใบเพิ่มหนี้ DN-2569-0001,
-- มาตรา 82/9 + 86/9) issued against this module's own tax invoices. A note never edits the invoice: it is a separate tax document
-- in the month it is issued; the invoice keeps running totals of the notes so what the customer owes reflects them.

create table sales_notes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  kind text not null check (kind in ('credit', 'debit')),
  invoice_id uuid not null references invoices(id),
  invoice_no text not null,
  invoice_date date not null,
  order_id uuid not null references sales_orders(id),
  issue_date date not null,
  -- buyer snapshot as printed on the original tax invoice
  customer_id uuid,
  customer_name text not null,
  customer_tax_id text,
  customer_branch text,
  customer_address text,
  -- reason: legal reason code (§82/10 / §82/9) + optional free text; `reason` is the printed sentence
  reason_code text not null,
  reason_text text,
  reason text not null,
  -- price basis of the original invoice (line prices exclusive / inclusive of VAT) and its VAT rate
  vat_mode text not null check (vat_mode in ('exclusive', 'inclusive')),
  vat_rate numeric(6,4) not null,
  -- §86/10: value per the original tax invoice (before this note), correct value, difference (net), VAT on the difference, total
  original_net numeric(18,4) not null,
  correct_net numeric(18,4) not null,
  net numeric(18,4) not null check (net > 0),
  vat numeric(18,4) not null check (vat >= 0),
  gross numeric(18,4) not null check (gross > 0),
  -- credit notes with goods returned: the warehouse they come back into
  warehouse_code text,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant sales_notes
create index sales_notes_invoice on sales_notes (tenant_id, invoice_id);

create table sales_note_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  note_id uuid not null references sales_notes(id) on delete cascade,
  line_no int not null,
  -- the invoice (sales order) line this adjusts, when it adjusts one
  invoice_line_no int,
  item_id uuid,
  item_code text,
  item_name text,
  description text not null,
  qty numeric(18,4) not null check (qty > 0),
  -- in the invoice's price basis (vat_mode of the note)
  unit_price numeric(18,4) not null check (unit_price >= 0),
  amount numeric(18,4) not null,
  -- credit notes only: qty that physically comes back into stock
  return_to_stock numeric(18,4) not null default 0 check (return_to_stock >= 0 and return_to_stock <= qty),
  unique (note_id, line_no)
);
-- @tenant sales_note_lines

-- running totals of the notes on each invoice (gross incl. VAT): amount owed = gross + debit_total − credit_total − paid_amount
alter table invoices add column credit_total numeric(18,4) not null default 0 check (credit_total >= 0);
alter table invoices add column debit_total numeric(18,4) not null default 0 check (debit_total >= 0);

-- payments may now reach the invoice plus its debit notes (the old check was paid_amount <= gross); after a credit note the
-- customer may have paid more than is owed (a credit balance shown in receivables)
do $$
declare r record;
begin
  for r in select conname from pg_constraint
           where conrelid = 'invoices'::regclass and contype = 'c' and pg_get_constraintdef(oid) ~ 'paid_amount <= gross'
  loop
    execute format('alter table invoices drop constraint %I', r.conname);
  end loop;
end $$;
alter table invoices add constraint invoices_paid_le_billed check (paid_amount <= gross + debit_total);

-- buyer's e-mail snapshot on the order (from master-data partners) — carried on sales.invoiced for e-Tax delivery
alter table sales_orders add column customer_email text;
