-- Wave 4 "who": org chart (manager per employee, default manager per department) and names of who filed / decided / recorded.

-- direct manager (an employee); their linked login is the leave approver
alter table employees add column manager_id uuid references employees(id);
create index employees_manager on employees (tenant_id, manager_id);

-- the department head (an employee) is the default manager for its members without a direct manager
alter table departments add column manager_employee_id uuid references employees(id);

alter table leave_requests add column requested_by_name text;
alter table leave_requests add column decided_by_name text;
alter table attendance add column recorded_by_name text;
