-- C3 (accountant round 2): input VAT eligibility (§82/5 ประมวลรัษฎากร).
-- Category: may its VAT be claimed as ภาษีซื้อ? null = not decided yet → the service decides from the name
-- (ค่ารับรอง / entertainment and รถยนต์นั่ง / passenger cars are ภาษีซื้อต้องห้าม; everything else claimable).
-- Done in code because migrations run under row-level security and cannot update existing tenants' categories.
alter table expense_categories add column vat_claimable boolean;

-- Line: what the employee got from the seller, and who the seller is (purchase VAT register: name, tax ID, branch, invoice no/date).
-- Only a full tax invoice (ใบกำกับภาษีเต็มรูป) with the seller's tax ID in a claimable category lets the VAT be claimed;
-- otherwise the VAT is part of the expense. receipt_type null = line written before this migration (treated as claimable, as posted).
alter table claim_lines add column receipt_type text check (receipt_type is null or receipt_type in ('full_tax_invoice', 'abbreviated', 'none'));
alter table claim_lines add column vendor_name text;
alter table claim_lines add column vendor_tax_id text;
alter table claim_lines add column vendor_branch text;
alter table claim_lines add column vat_claimable boolean;
