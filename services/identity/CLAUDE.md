# identity — Identity & Access (ผู้ใช้และสิทธิ์) · core

Companies (tenants), users, roles, login. Issues the JWT every module trusts (`tid` = tenant, `perms` = union of role permissions).

## Data
- `tenants` (global, no RLS — login looks it up before a tenant context exists)
- `users`, `roles` (`permissions text[]`), `user_roles` — tenant tables
- `company_profiles` (one row per tenant, `tenant_id` is the key) — seller details printed on every document

## API
- `POST /tenants` (internal token) — provision company + Administrator role (`*`) + first admin
- `POST /auth/login` (public) `{ tenant, email, password }` → `{ token, permissions, … }`
- `GET /company` (any signed-in user) — letterhead/seller details: `legal_name, name_en, branch_code, branch_label` (as typed, may be null), `branch_text` (what to print), `address, tax_id, phone, email, website, logo, footer_note, signature_labels, configured`. Before setup it answers `configured: false` with the tenant name and empty fields.
- `PUT /company` (`identity.company.write`) — full replace (missing optional fields become null). `taxId` must pass the 13-digit check (`isValidThaiTaxId`, dashes/spaces stripped), `branchCode` 5 digits (`00000` = สำนักงานใหญ่; `branch_text` = `branchLabel` or "สำนักงานใหญ่" / "สาขาที่ 0000x"), `logo` = base64 data URL of PNG/JPEG/SVG ≤ 300 KB whose bytes match the type, `signatureLabels` = array or comma-separated text (≤ 6).
- `GET /me` · `GET/POST /users` · `PUT /users/:id/roles` · `POST /users/:id/deactivate` · `GET/POST /roles`
- `GET /role-templates?modules=a,b&q=` (`identity.user.read`) — suggested Thai roles (ผู้บริหาร, พนักงานทั่วไป, หัวหน้างาน, ฝ่ายบุคคล, บัญชีและการเงิน, จัดซื้อ, ฝ่ายขาย, คลังสินค้า, ช่างซ่อมบำรุง, QC, ไอที, ผู้จัดการโครงการ) → `{ id, name, description, permissions, permission_count, skipped }`.
- `POST /roles/from-template { template, name?, modules? }` (`identity.role.write`) — creates the role (name defaults to the template's; taken → 409) with only the permissions of the
  installed modules (`modules` from the client's catalog, else an `x-erp-modules` header, else all). Returns the role + `skipped` + Thai `message`.

## Rules
- The company profile is what makes a printed tax invoice legal (Revenue Code §86/4: seller name, address, tax ID, branch). apps/web reads it once per session for every printed document.
- Never return `password_hash`. Passwords: scrypt via kernel `hashPassword`.
- Permission strings: `<module>.<thing>.<action>`, wildcards `<module>.*` and `*`. The list of available permissions comes from installed modules' manifests (`GET /api/_catalog`), not from this module.
- Role templates live in `src/role-templates.ts` (static — identity cannot read other modules). A permission belongs to module `m` when its prefix is `m`
  or `m` starts with `<prefix>-` (`master.*` → `master-data`). `tests/ui/role-templates.test.ts` checks every key against the repo's module.json files.
- Changing roles affects tokens at next login (tokens live `JWT_TTL_SECONDS`, default 12h).

## Extension ideas
LINE Login (new route + `users.line_user_id` in a new migration), 2FA, password reset, SSO.

## Screens
`src/ui.ts` — list/form/detail definitions rendered by apps/web and apps/mobile (see docs/ui.md). Keep endpoints identical to the routes above.
