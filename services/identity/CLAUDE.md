# identity — Identity & Access (ผู้ใช้และสิทธิ์) · core

Companies (tenants), users, roles, login. Issues the JWT every module trusts (`tid` = tenant, `perms` = union of role permissions).

## Data
- `tenants` (global, no RLS — login looks it up before a tenant context exists)
- `users`, `roles` (`permissions text[]`), `user_roles` — tenant tables

## API
- `POST /tenants` (internal token) — provision company + Administrator role (`*`) + first admin
- `POST /auth/login` (public) `{ tenant, email, password }` → `{ token, permissions, … }`
- `GET /me` · `GET/POST /users` · `PUT /users/:id/roles` · `POST /users/:id/deactivate` · `GET/POST /roles`

## Rules
- Never return `password_hash`. Passwords: scrypt via kernel `hashPassword`.
- Permission strings: `<module>.<thing>.<action>`, wildcards `<module>.*` and `*`. The list of available permissions comes from installed modules' manifests (`GET /api/_catalog`), not from this module.
- Changing roles affects tokens at next login (tokens live `JWT_TTL_SECONDS`, default 12h).

## Extension ideas
LINE Login (new route + `users.line_user_id` in a new migration), 2FA, password reset, SSO.
