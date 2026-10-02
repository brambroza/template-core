-- C8 (accountant round 2): the supplier's tax invoice that came with the goods — for the purchase VAT register (ภาษีซื้อ).
-- Optional at receipt (the invoice may arrive later); carried in purchasing.goods_received.
alter table po_receipts add column supplier_invoice_no text;
alter table po_receipts add column supplier_invoice_date date;
alter table po_receipts add column supplier_tax_id text;
alter table po_receipts add column supplier_branch text;
