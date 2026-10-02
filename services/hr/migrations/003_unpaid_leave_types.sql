-- Wave 5: leave types flag unpaid leave (ลาไม่รับค่าจ้าง) so Payroll can deduct approved unpaid days automatically (hr.leave_decided.unpaid).
alter table leave_types add column unpaid boolean not null default false;
-- the seeded Labour Protection Act type UNPAID is unpaid (RLS is forced even for the owner, so lift it for the backfill only)
alter table leave_types no force row level security;
update leave_types set unpaid = true where upper(code) = 'UNPAID';
alter table leave_types force row level security;
