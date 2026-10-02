-- C7/C8 (accountant round 2): the VAT registers (รายงานภาษีซื้อ / รายงานภาษีขาย) must show the tax invoice itself — its number and date
-- (the supplier's, not our PO / claim number), the other party's name, 13-digit tax ID and branch. Stored on the VAT journal line when
-- the source event carries them; null = not known (old postings show the JV reference instead).
alter table journal_lines add column tax_invoice_no text;
alter table journal_lines add column tax_invoice_date date;
alter table journal_lines add column tax_party_name text;
alter table journal_lines add column tax_party_tax_id text;
alter table journal_lines add column tax_party_branch text;
