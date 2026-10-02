# projects — Projects & Timesheets (โครงการ งาน และ timesheet) · feature

Projects for service companies, contractors, IT/consulting teams and internal factory projects.
A manager opens a project (budget, customer, members with an hourly cost rate, milestones), the team works a
task board (todo → doing → review → done) and logs hours every day; each week is submitted and approved.
The project page shows progress, hours vs estimate and labour cost vs budget. Requires only `identity` + `master-data`.

## Data
- `projects` (`PJ-2569-0001`, `planning → active → on_hold → done | cancelled`, budget `numeric(18,4)`, customer + manager snapshots)
- `project_members` (user snapshot, role, `hourly_rate`; unique per project/user — POST upserts)
- `milestones` (name, due_date, done) · `tasks` (title, assignee snapshot, `todo | doing | review | done`, priority `low | normal | high | urgent`, due_date, estimate_hours, milestone)
- `timesheet_weeks` (one per user per ISO week, `week_start` = Monday, `draft → submitted → approved`, reject → draft with reason)
- `timesheet_entries` (work_date, project, task optional, hours 0.25–24, note, user from the token)

## Behaviour
- Progress % = done estimate hours / all estimate hours; when no task has an estimate, done tasks / all tasks.
- Cost = Σ hours × the logging user's `hourly_rate` on that project (0 if not a member; rate changes re-price history).
  `budget_at_risk` = budget > 0 and cost > 90% of budget.
- Project moves: activate (planning|on_hold), hold (active), complete (active|on_hold), cancel (planning|active|on_hold), reopen (done → active). Anything else → 409.
- Task moves: start (todo|review → doing — from review it means "sent back"), review (doing), done (todo|doing|review), reopen (done → todo). 409 otherwise; no moves in a cancelled project.
- Done/cancelled projects refuse new tasks, members and milestones (409). Cancelled projects refuse hours (409).
- Milestone of a task must belong to the same project (400). A timesheet task must belong to the entry's project (400).
- Hours: one user may not exceed 24 h per day (400), no future dates (400). Approvers cannot approve their own week (403). End date before start date → 400 `fieldErrors.endDate`. Entries of a submitted/approved week cannot be added or deleted (409).
  Users only see/delete their own entries unless they hold `projects.timesheet.approve`.
- Overdue = not done and due_date < today (tasks and milestones).

## API
- `POST/GET /projects` (`?q=&status=&open=true&customerId=&managerId=`) · `GET/PATCH /projects/:id` (detail has members, milestones, tasks and all numbers)
- `POST /projects/:id/activate | hold | complete | cancel | reopen` · `POST /projects/:id/members` · `POST /projects/:id/milestones`
- `GET /milestones` (`?projectId=&done=&overdue=`) · `POST /milestones/:id/done | undo`
- `POST/GET /tasks` (`?q=&projectId=&status=&assigneeId=&priority=&overdue=&open=`) · `GET /tasks/board` (`{ counts, rows }`) · `GET /tasks/mine`
- `GET/PATCH /tasks/:id` · `POST /tasks/:id/start | review | done | reopen`
- `POST/GET /timesheets` · `DELETE /timesheets/:id` · `GET /timesheets/week?start=&userId=` (days[7], byProject, rows, status `empty|draft|submitted|approved`) · `POST /timesheets/week/submit { start? }`
- `GET /timesheet-weeks` (approver) · `GET /timesheet-weeks/:id` · `POST /timesheet-weeks/:id/approve` · `POST /timesheet-weeks/:id/reject { reason }`
- `GET /summary` → activeProjects, overdueTasks, tasksDueThisWeek, hoursThisWeek, budgetAtRisk, weeksToApprove, months[6] `{month, hours}`, rows (open tasks), budgetRows

Permissions: `projects.project.read` · `projects.project.write` (projects, members, milestones) · `projects.task.write` · `projects.timesheet.log` (own hours) · `projects.timesheet.approve`.

## Events
- publishes: none · subscribes: none.
- Candidates (not added): `projects.task_overdue`, `projects.timesheet_submitted`, `projects.budget_at_risk` for automation alerts; `projects.hours_approved` for HR/payroll or costing.

## Screens
`src/ui.ts` — projectList/New/Edit/Detail (flow, member + milestone actions, printable), milestoneList, myTasks (mobile home),
taskList/New/Edit/Detail (flow), timesheetNew (mobile), myWeek (rows of `/timesheets/week`, submit + delete), entryList,
weekApprovals + weekDetail. Widgets: kpi, pipeline (task board), trend (hours), bars (budget used %).
⌘K: `งาน <โครงการ> <ชื่องาน>`, `ลงชั่วโมง <โครงการ> <หมายเหตุ>`, `งานของฉัน`, `อนุมัติชั่วโมง`; search projects and tasks.

## Extension ideas
Billable hours + invoice to Sales, Gantt export, recurring tasks, task comments/attachments (URLs), per-role default rates, LINE reminders for missing timesheets.
