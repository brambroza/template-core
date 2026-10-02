-- e-Tax wave 9 (finish): cancel inside this module, and replacement documents (ออกใบกำกับภาษีฉบับใหม่แทนฉบับเดิม).
--
-- cancelled = the user decided this document will NOT be issued as an e-Tax document from here (e.g. a paper tax invoice was
--             issued instead, or it was a duplicate). Only documents never recorded as sent may be cancelled. It does NOT
--             cancel the tax invoice in Sales (that module owns it).
-- replaced  = the document was delivered (sent_manual / sent_sp) and a replacement e-Tax invoice was prepared here to correct
--             non-amount data (buyer name / address …), ETDA purpose codes TIVC01 / TIVC02 / TIVC99. Amount errors are corrected
--             with a credit / debit note in Sales instead (มาตรา 86/9, 86/10), never with a replacement.

alter table etax_documents drop constraint etax_documents_status_check;
alter table etax_documents add constraint etax_documents_status_check
  check (status in ('incomplete', 'draft', 'generated', 'signed', 'sent_manual', 'sent_sp', 'cancelled', 'replaced'));

alter table etax_documents drop constraint etax_documents_source_check;
alter table etax_documents add constraint etax_documents_source_check check (source in ('invoice', 'note', 'replacement'));

alter table etax_documents
  add column cancel_reason text,
  add column cancelled_at timestamptz,
  add column cancelled_by_name text,
  -- replacement chain: the new document points at the one it replaces, and the replaced one at its successor
  add column replaces_id uuid references etax_documents (id),
  add column replaces_no text,
  add column replaces_date date,
  add column replaces_type_code text,
  add column replaced_by_id uuid references etax_documents (id),
  add column replaced_by_no text,
  -- set when a user corrected the buyer here: a re-sent sales event then keeps the corrected buyer
  add column buyer_edited_at timestamptz;

create index etax_documents_by_replaces on etax_documents (tenant_id, replaces_id);
