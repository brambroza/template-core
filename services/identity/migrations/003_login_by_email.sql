-- Log in with e-mail + password only (no company code): an e-mail belongs to one user in the whole system.
--
-- 1. `login_lookup`: a SELECT-only policy that lets /auth/login, and the e-mail-taken check before creating a user, find a user by
--    e-mail in any company before a tenant context exists. It applies only while the transaction sets `app.login_lookup = 'on'`
--    (set_config(..., true), so it is local to that transaction). Every other query still sees its own tenant only.
create policy login_lookup on users for select using (current_setting('app.login_lookup', true) = 'on');

-- 2. Global unique e-mail. Older databases may already hold the same e-mail in two companies; then the index is skipped (the
--    migration must not fail at boot), identity still refuses new duplicates in code, and those users log in with the company code.
select set_config('app.login_lookup', 'on', true);
do $$
begin
  if not exists (select 1 from users group by email having count(*) > 1) then
    create unique index users_email_global on users (email);
  else
    raise notice 'identity: duplicate e-mails across companies, users_email_global not created';
  end if;
end $$;
select set_config('app.login_lookup', '', true);
