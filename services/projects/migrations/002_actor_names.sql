-- Wave 4 "who": who approved / sent back a timesheet week, snapshotted from the login token.
alter table timesheet_weeks add column approved_by_name text;
alter table timesheet_weeks add column rejected_by_name text;
