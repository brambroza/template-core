-- Wave 4 "who": names of the people who approved / paid, snapshotted from the login token (for print and the payout list).
alter table claims add column approved_by_name text;
alter table claims add column paid_by_name text;
alter table advances add column approved_by_name text;
alter table advances add column paid_by uuid;
alter table advances add column paid_by_name text;
