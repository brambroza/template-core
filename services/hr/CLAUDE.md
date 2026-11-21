# hr — HR & Attendance (บุคคลและลงเวลา) · feature

Employee register, leave with quotas and approval, mobile check-in/out with late minutes. Requires only `identity`
(an employee can be linked to a login via `user_id` so "me" endpoints and self-service work). Never store national ID numbers here.

## Data
- `departments` (code, name, `manager_employee_id` = department head (an employee), `manager_name` = text snapshot of the head, active) · `positions` (code, name)
- `employees` (code, prefix นาย/นาง/นางสาว, first/last name, nickname, department, position, start/birth date, phone, email,
  `active | probation | resigned` + `resigned_on`, `user_id` = identity user, unique per tenant, `manager_id` = direct manager (an employee))
- `holidays` (holiday_date, name) · `work_settings` (one row per tenant: start_time, end_time, grace_minutes, saturday_workday)
- `leave_types` (code, name, `days_per_year` null = unlimited, allow_half_day, active, sort_order, `unpaid` = ลาไม่รับค่าจ้าง (migration 003; seeded `UNPAID` is true))
- `leave_requests` (`LV-2569-0001`, employee, type, from/to, half_day, `days` = working days, reason, `pending → approved | rejected | cancelled`,
  requested_by + `requested_by_name`, decided_by + `decided_by_name`, decided_at, decision_note)
- `attendance` (one row per employee per `work_date`: check_in_at/out_at, late_minutes, early_minutes, work_minutes, GPS in/out, note, `source self | admin`, recorded_by + `recorded_by_name`)

## Behaviour
- Time zone is Asia/Bangkok (`src/calendar.ts`); "now" (check-in time, today, resign date default, balances year) is the kernel business clock `now()` (wave 8 — tests freeze it with `setClock`). Working day = Mon–Fri (+ Sat if `saturday_workday`) and not a holiday.
- Leave `days` counts working days only; half day = 0.5 and only for a single day of a type with `allow_half_day`.
  One request may not cross a calendar year nor start before the employee's start date (400). Approvers cannot approve or reject their own leave (409). Overlapping pending/approved leave → 409.
- Balance per type and year (by `from_date`): quota, used (approved), pending, remaining = quota − used − pending.
  A request bigger than remaining → **400** `วันลาคงเหลือไม่พอ: ลากิจ ปี 2570 คงเหลือ 1 วัน แต่ขอลา 2 วัน`.
- Without `employeeId` a request/check-in is for the employee linked to the token's user; for someone else you need
  `hr.leave.approve` (leave) or `hr.attendance.manage` (attendance).
- **Org chart approvals.** The leave approver of an employee = their `manager_id`, else their department's `manager_employee_id` (never themself),
  counted only when that manager is not resigned and has a linked login (`user_id`). Computed live (SQL `APPROVER_JOIN`), so changing a manager re-routes pending leave.
  Who may approve / reject: that manager (needs only a leave perm such as `hr.leave.request`), or `hr.leave.approve-all` (HR override, any leave);
  leave with **no** approver (no manager, or the manager has no login) goes to `hr.leave.approve` (HR). Anyone else → 403 naming the manager.
  Nobody decides their own leave (409 for HR approvers, 403 for others). Leave rows carry `approver_user_id`, `approver_name`, `approver_label` (name or "ฝ่ายบุคคล"), `can_decide`, `is_my_team`.
  The manager may read their team's leave (`GET /leave-requests/:id`). Manager = self or a loop (A → B → A) → 400.
- Names come from the token (`auth(req).userName`): `requested_by_name`, `decided_by_name`, attendance `recorded_by_name` (falls back to the linked employee's name for old tokens acting for themselves).
- Staff cancel their own *pending* leave; approvers (`hr.leave.approve`, approve-all, or the employee's manager) can also cancel *approved* leave.
- Check-in uses server time; `late_minutes` = minutes after start_time when beyond `grace_minutes` (0 on non-working days).
  Only `hr.attendance.manage` may pass `at` or `date`+`time` (forgotten scans; recorded as `source = admin`); impossible dates (30 Feb) → 400.
  Check-out closes the latest open check-in within 20 h (night shifts), stores work and early-leave minutes.
- Resigning cancels the employee's pending leave after the last day; resigned staff cannot check in or file leave.
- `POST /leave-types/defaults` seeds Thai Labour Protection Act types (ลาป่วย 30, ลากิจ 3, ลาพักร้อน 6, ลาคลอด 98, ลาบวช, ลารับราชการทหาร, ลาไม่รับค่าจ้าง `unpaid`); idempotent.
- Leave types take `unpaid: boolean` on create / PATCH (Payroll deducts approved days of unpaid types).

## API
- `GET/POST /departments` (`managerEmployeeId` sets the head; `manager_name` follows it) · `GET/PATCH /departments/:id` · `GET/POST /positions`
- `GET /employees` (`?q=` code/name/nickname, `status` active|probation|resigned|current, `departmentId`, `positionId`) · `POST /employees`
- `GET/PATCH /employees/:id` (`managerId`; detail has `manager_name`, `approver_label`, `reports[]` = direct reports) · `POST /employees/:id/confirm` (probation → active) · `POST /employees/:id/resign { resignedOn }`
- `GET /employees/:id/balance?year=` (ค.ศ. or พ.ศ.) · `GET /employees/:id/attendance?month=YYYY-MM`
- `POST /employees/:id/check-in | check-out { date, time, note }` (perm `hr.attendance.manage`)
- `GET/POST /holidays` (`?year=`) · `DELETE /holidays/:id` · `GET/PUT /schedule`
- `GET/POST /leave-types` · `GET/PATCH /leave-types/:id` · `POST /leave-types/defaults`
- `POST /leave-requests` · `GET /leave-requests` (`q`, status, employeeId, departmentId, leaveTypeId, from, to)
- `GET /leave-requests/pending` (HR: approve-all = all pending; `hr.leave.approve` = leave without a manager + own team) · `GET /leave-requests/inbox` (manager: pending leave of my team; any leave perm)
- `GET /leave-requests/:id` (with balance) · `POST /leave-requests/:id/approve { note } | reject { note* } | cancel { note }`
- `POST /attendance/check-in | check-out { lat, lng, note, employeeId?, at?/date+time? }`
- `GET /attendance?date=&status=&departmentId=&q=` (daily board: present/late/leave/not_in/absent/off) · `GET /attendance/monthly?month=`
- `GET /me` (linked employee, today, balance, recent leave, `approverName`, `teamPending`) · `GET /me/leave-requests` · `GET /summary`

Permissions: `hr.employee.read|write`, `hr.setup.write`, `hr.leave.request|approve|approve-all`, `hr.attendance.self|read|manage`.
Managers need no special permission — being the approver in the org chart (with any leave perm) is enough.

## Events
- publishes `hr.leave_requested` (leaveId, no, employeeName, typeName, from, to, days, employeeUserId, approverUserId, approverName — approver null = HR) when a leave request is filed.
- publishes `hr.leave_decided` (leaveId, no, employeeName, typeName, decision approved|rejected, employeeUserId, byName, note) on approve / reject;
  wave 5 adds `employeeId`, `employeeCode`, `from`, `to`, `days`, `unpaid` (the type's flag) and `byMonth[{ period: YYYY-MM, days }]` (working days per month
  by the HR calendar; one month = the stored days) → Payroll puts unpaid days into that month's run.
- publishes `hr.employee_upserted` (employeeId, code, name (prefix + first + last), departmentName, positionName, status, startDate, resignedDate, userId) after
  `POST /employees`, `PATCH /employees/:id`, `confirm` and `resign` → Payroll creates / updates the pay profile. No salary or ID numbers.
  Automation alerts the manager (`field:approverUserId`) and the employee (`field:employeeUserId`) personally.
- subscribes `automation.line_decision` (target `hr.leave`): the manager pressed อนุมัติ + ยืนยัน on the LINE card → `lineLeaveDecision()` runs
  `decideLeaveAs()` (shared with `POST /leave-requests/:id/approve`: `canDecide`, never own leave; note "อนุมัติผ่าน LINE"). Refused when the user's
  revocation cutoff is later than `permsAt` or they hold no leave permission. Never throws. Publishes `hr.line_decision_result` (lineActionId, userId, ok, message).
- Candidates (not added): identity deactivation on resign (could subscribe to `hr.employee_upserted` status resigned);
  an event for cancelling approved leave (Payroll would undo unpaid days).

## Screens
`src/ui.ts`: self-service `me` (check-in/out buttons, balance, recent leave), `checkIn`/`checkOut`/`leaveNew`/`myLeaves` (mobile),
manager inbox `teamLeaveInbox` (ใบลาลูกทีมรอฉันอนุมัติ, mobile), HR inbox `leaveInbox` (approve/reject per row when `can_decide`, mobile), `leaveList`, `leaveDetail` (flow, printable), daily board and monthly summary,
employees (+edit with หัวหน้างาน lookup, confirm, resign, record time for them, direct reports), departments (หัวหน้าแผนก lookup), positions, leave types, holidays, schedule.
Widgets: kpi (present/late/on leave/pending), leave pipeline, approved-leave trend. ⌘K: `ลา ป่วย ไข้หวัด`, `ลงเวลา`, `ออกงาน`, `พนักงาน EMP-001`.

## Extension ideas
Shifts per department, OT requests, payroll export of the monthly summary, geofence check on GPS, carry-over of annual leave, leave attachments (medical certificate URL).
