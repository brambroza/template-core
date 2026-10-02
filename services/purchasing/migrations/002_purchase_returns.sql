-- Wave 4: return to supplier (ใบส่งคืนสินค้า RT-2569-0001) against a received PO.

alter table po_lines add column returned_qty numeric(18,4) not null default 0;

create table purchase_returns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  no text not null,
  po_id uuid not null references purchase_orders(id),
  po_no text not null,
  supplier_id uuid,
  supplier_name text not null,
  -- the warehouse the goods leave from (QC-HOLD for rejected material)
  warehouse_code text not null,
  return_date date not null default current_date,
  vat_mode text not null default 'exclusive' check (vat_mode in ('exclusive', 'inclusive')),
  net numeric(18,4) not null,
  vat numeric(18,4) not null,
  gross numeric(18,4) not null,
  -- e.g. the NCR number that decided "return to supplier" (text snapshot, no link into quality)
  ref_no text,
  note text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz not null default now(),
  unique (tenant_id, no)
);
-- @tenant purchase_returns
create index purchase_returns_po on purchase_returns (tenant_id, po_id);

create table purchase_return_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  return_id uuid not null references purchase_returns(id) on delete cascade,
  po_line_id uuid not null references po_lines(id),
  line_no int not null,
  item_id uuid not null,
  item_code text not null,
  item_name text,
  qty numeric(18,4) not null check (qty > 0),
  unit_price numeric(18,4) not null,
  amount numeric(18,4) not null,
  reason text,
  unique (return_id, line_no)
);
-- @tenant purchase_return_lines
