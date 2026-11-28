-- Sign-up is confirmed with a 6-digit code typed into the page, not with a link in the mail.
-- `signups.token_hash` now holds the hash of the "ticket" the browser that started the sign-up keeps (the code alone opens nothing:
-- it only counts together with that ticket). The code is stored as an HMAC, lives a few minutes and dies after a few wrong tries.
-- Rows written before this migration have no code and can no longer be confirmed (sign up again).

alter table signups add column code_hash text;
alter table signups add column code_expires_at timestamptz;
alter table signups add column code_attempts int not null default 0;
-- the e-mail already had an account when the sign-up was sent: the row can never be confirmed, it only makes "send the code again"
-- and wrong codes cost and answer the same as for a new e-mail (no account discovery)
alter table signups add column account_exists boolean not null default false;
