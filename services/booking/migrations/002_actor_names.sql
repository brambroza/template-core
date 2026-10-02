-- Wave 4 "who": who approved / cancelled, snapshotted from the login token.
alter table bookings add column approved_by_name text;
alter table bookings add column cancelled_by_name text;
