import {
  auth, badRequest, forbidden, hashPassword, hasPerm, HttpError, loadManifest, one, parse, requirePerm, s, signToken, unauthorized, verifyPassword, z,
  type AuthContext, type Client, type Kernel, type ServiceDefinition,
} from '@erp/kernel';
import { isValidThaiTaxId } from '@erp/thai';
import { fileURLToPath } from 'node:url';
import { applyTemplate, ROLE_TEMPLATES } from './role-templates.ts';

const manifest = loadManifest(new URL('../module.json', import.meta.url));

const email = z.string().trim().toLowerCase().email();
const password = z.string().min(8);

const TenantInput = z.object({
  code: z.string().trim().toLowerCase().regex(/^[a-z0-9-]{2,30}$/),
  name: s.name,
  admin: z.object({ email, name: s.name, password }),
});
const LoginInput = z.object({ tenant: z.string().trim().toLowerCase(), email, password: z.string() });
const UserInput = z.object({ email, name: s.name, password, roleIds: z.array(s.uuid).default([]) });
const PasswordChangeInput = z.object({
  currentPassword: z.string().min(1, 'กรอกรหัสผ่านปัจจุบัน'),
  newPassword: z.string().min(8, 'รหัสผ่านใหม่อย่างน้อย 8 ตัวอักษร').max(200),
});
const RoleInput = z.object({ name: s.name, permissions: z.array(z.string().regex(/^(\*|[a-z-]+\.(\*|[a-z_.]+))$/)) });

/** Largest logo accepted (decoded bytes). It is embedded in every printed document. */
export const LOGO_MAX_BYTES = 300 * 1024;

/**
 * A logo must be a base64 data URL of a PNG, JPEG or SVG image, ≤ 300 KB decoded,
 * and its bytes must really be that kind of image. Returns a Thai problem, or null when fine.
 */
export function logoProblem(dataUrl: string): string | null {
  const m = /^data:image\/(png|jpeg|svg\+xml);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!m) return 'โลโก้ต้องเป็นไฟล์ PNG, JPEG หรือ SVG (data URL แบบ base64)';
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length > LOGO_MAX_BYTES) return 'โลโก้ใหญ่เกิน 300 KB';
  const kind = m[1];
  const ok = kind === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    : kind === 'jpeg' ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    : /<svg[\s>]/i.test(bytes.toString('utf8'));
  if (!ok) return 'ไฟล์โลโก้ไม่ตรงกับชนิดที่ระบุ';
  // an SVG is a document: no scripts, event handlers, embedded HTML, entities or outside resources (security review 0.3, SEC-11)
  if (kind === 'svg+xml' && /<script|<foreignObject|<!ENTITY|\son[a-z]+\s*=|javascript:|(?:xlink:)?href\s*=\s*["']?\s*(?!#|data:image\/)[a-z]/i.test(bytes.toString('utf8'))) {
    return 'โลโก้ SVG ต้องไม่มีสคริปต์หรือลิงก์ภายนอก (บันทึกเป็น PNG แทนได้)';
  }
  return null;
}

const optText = (max: number) => z.string().trim().max(max).transform((v) => v || null).nullable().optional();

/** "ผู้จัดทำ, ผู้อนุมัติ" (form text) or ["ผู้จัดทำ", "ผู้อนุมัติ"] -> trimmed labels. */
const labelList = z
  .union([z.array(z.string()), z.string()])
  .transform((v) => (Array.isArray(v) ? v : v.split(/[,\n]/)).map((x) => x.trim()).filter(Boolean))
  .pipe(z.array(z.string().max(60)).max(6, 'ลายเซ็นได้ไม่เกิน 6 ช่อง'));

const CompanyInput = z.object({
  legalName: z.string().trim().min(1, 'กรอกชื่อนิติบุคคล').max(200),
  nameEn: optText(200),
  branchCode: z.string().trim().regex(/^\d{5}$/, 'รหัสสาขาเป็นตัวเลข 5 หลัก (สำนักงานใหญ่ = 00000)').default('00000'),
  branchLabel: optText(100),
  address: z.string().trim().min(1, 'กรอกที่อยู่').max(500),
  taxId: z.string().transform((v) => v.replace(/[\s-]/g, '')).nullable().optional()
    .refine((v) => !v || isValidThaiTaxId(v), 'เลขประจำตัวผู้เสียภาษีไม่ถูกต้อง (13 หลัก ตรวจ check digit ไม่ผ่าน)')
    .transform((v) => v || null),
  phone: optText(50),
  email: z.string().trim().max(200).transform((v) => v || null).pipe(z.string().email('อีเมลไม่ถูกต้อง').nullable()).nullable().optional(),
  website: optText(200),
  logo: z.string().max(LOGO_MAX_BYTES * 2, 'โลโก้ใหญ่เกิน 300 KB').nullable().optional()
    .superRefine((v, ctx) => { const p = v ? logoProblem(v) : null; if (p) ctx.addIssue({ code: z.ZodIssueCode.custom, message: p }); })
    .transform((v) => v || null),
  footerNote: optText(500),
  signatureLabels: labelList.optional(),
});

/** "สำนักงานใหญ่" for 00000, "สาขาที่ 00012" otherwise — the wording the Revenue Department expects. */
export const branchText = (code: string) => (code === '00000' ? 'สำนักงานใหญ่' : `สาขาที่ ${code}`);
/** "0105559012342" -> "0-1055-59012-34-2", as printed on Thai documents (the company screen shows it this way) */
export const taxIdText = (id: string | null | undefined) => {
  const d = (id ?? '').replace(/\D/g, '');
  return d.length === 13 ? `${d[0]}-${d.slice(1, 5)}-${d.slice(5, 10)}-${d.slice(10, 12)}-${d[12]}` : id ?? null;
};
const companyView = (row: any) => ({ configured: true, ...row, branch_text: row.branch_label || branchText(row.branch_code), tax_id_text: taxIdText(row.tax_id) });

const companyCols = `legal_name, name_en, branch_code, branch_label, address, tax_id, phone, email, website, logo, footer_note, signature_labels, updated_at`;

async function permissionsOf(c: Client, userId: string): Promise<string[]> {
  const r = await c.query<{ p: string }>(
    `select distinct unnest(r.permissions) as p from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1`,
    [userId],
  );
  return r.rows.map((x) => x.p).sort();
}

const publicUser = `id, email, name, active, created_at`;

/**
 * May `a` hand out `perm`? Only what they hold themselves (security review 0.3, SEC-01): `*` needs `*`, `<module>.*` needs
 * `<module>.*` (or `*`), a single permission needs that permission (or a wildcard covering it).
 */
export function canGrant(a: AuthContext, perm: string): boolean {
  if (a.perms.includes('*')) return true;
  if (perm === '*') return false;
  if (perm.endsWith('.*')) return a.perms.includes(perm);
  return hasPerm(a, perm);
}

/** 403 unless the caller holds every permission in `perms` (no granting, removing or taking over more than you have). */
function requireGrantable(a: AuthContext, perms: string[], what: string): void {
  const missing = [...new Set(perms.filter((p) => !canGrant(a, p)))];
  if (missing.length) throw forbidden(`${what}: คุณให้ได้เฉพาะสิทธิ์ที่ตัวเองมี (ขาด ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ' …' : ''})`);
}

/** Permissions of the given roles of this tenant (RLS); 400 when an id is not a role of this company. */
async function permissionsOfRoles(c: Client, roleIds: string[]): Promise<string[]> {
  if (!roleIds.length) return [];
  const rows = (await c.query<{ id: string; permissions: string[] }>('select id, permissions from roles where id = any($1::uuid[])', [roleIds])).rows;
  if (rows.length !== new Set(roleIds).size) throw badRequest('ไม่พบบทบาทที่เลือก');
  return rows.flatMap((r) => r.permissions);
}

/* ---- token revocation (security review 0.3, SEC-07) ---- */

export type RevokeReason = 'logout' | 'password_changed' | 'user_disabled' | 'roles_changed' | 'admin';
const REVOKE_REASON_TH: Record<RevokeReason, string> = {
  logout: 'ออกจากระบบ', password_changed: 'เปลี่ยนรหัสผ่าน', user_disabled: 'ปิดใช้งานบัญชี', roles_changed: 'เปลี่ยนบทบาท', admin: 'ผู้ดูแลบังคับออกจากระบบ',
};

/**
 * Cutoff for "every token issued up to now": the NEXT second. Token `iat` has 1-second resolution, so a cutoff of the current
 * second would let a token issued earlier in this same second survive. A login right after a revocation is issued with
 * `iat` = the cutoff (see `/auth/login`), so it is not refused — which is why a second revocation must go past the previous
 * cutoff (`previous + 1`), not just past now. Real wall-clock time — not the kernel's (freezable) business clock — because
 * token `iat` is real time.
 */
export const revocationCutoff = (nowMs = Date.now(), previous?: number) => Math.max(Math.floor(nowMs / 1000), previous ?? 0) + 1;

/** Refuse every token of `userId` issued up to now: stored here at once (kernel) and delivered to every module by the gateway. */
async function revokeTokens(k: Kernel, c: Client, userId: string, reason: RevokeReason): Promise<number> {
  const before = revocationCutoff(Date.now(), await cutoffOf(c, userId));
  await k.emit(c, 'identity.tokens_revoked', { userId, before, reason });
  return before;
}

/** This user's revocation cutoff from identity's own copy of the kernel table (inside the tenant transaction). */
async function cutoffOf(c: Client, userId: string): Promise<number | undefined> {
  const r = await c.query<{ before: string }>('select before from _revoked_tokens where user_id = $1', [userId]);
  return r.rows[0] ? Number(r.rows[0].before) : undefined;
}

/* ---- login throttling (security review 0.3, SEC-02) ---- */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const loginFailures = new Map<string, number[]>();
const recentFailures = (key: string, now = Date.now()) => (loginFailures.get(key) ?? []).filter((at) => now - at < LOGIN_WINDOW_MS);
function noteLoginFailure(key: string) {
  const now = Date.now();
  loginFailures.set(key, [...recentFailures(key, now), now]);
  if (loginFailures.size > 50_000) for (const [k] of loginFailures) { loginFailures.delete(k); if (loginFailures.size <= 25_000) break; }
}
/** test hook: forget all failed attempts */
export function resetLoginThrottle() { loginFailures.clear(); }
/** compared against when the user does not exist, so a wrong e-mail costs the same time as a wrong password */
const DUMMY_HASH = hashPassword('not-a-real-password-' + Math.random());

export const definition: ServiceDefinition = {
  manifest,
  migrationsDir: fileURLToPath(new URL('../migrations', import.meta.url)),
  routes(app, k) {
    const secret = k.env.JWT_SECRET!;
    const ttl = Number(k.env.JWT_TTL_SECONDS ?? 60 * 60 * 12);

    /** Create a company + its first admin. Called by GO Along's provisioning (internal token), not by end users. */
    app.post('/tenants', { config: { internal: true } }, async (req, reply) => {
      const body = parse(TenantInput, req.body);
      const tenant = await k.db.rawTx(async (c) => (await c.query('insert into tenants (code, name) values ($1, $2) returning *', [body.code, body.name])).rows[0]);
      const user = await k.db.tx(tenant.id, async (c) => {
        const role = (await c.query(`insert into roles (name, permissions) values ('Administrator', '{*}') returning id`)).rows[0];
        const u = (await c.query(`insert into users (email, name, password_hash) values ($1, $2, $3) returning ${publicUser}`, [body.admin.email, body.admin.name, hashPassword(body.admin.password)])).rows[0];
        await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [u.id, role.id]);
        return u;
      });
      reply.code(201);
      return { tenant, admin: user };
    });

    app.post('/auth/login', { config: { public: true } }, async (req) => {
      const body = parse(LoginInput, req.body);
      // one account (company + e-mail) may fail LOGIN_MAX_FAILURES times per LOGIN_WINDOW_MS, then waits (429)
      const key = `${body.tenant}|${body.email}`;
      if (recentFailures(key).length >= LOGIN_MAX_FAILURES) {
        throw new HttpError(429, 'too_many_attempts', 'ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
      }
      const tenant = (await k.db.pool.query('select id, code, name from tenants where code = $1', [body.tenant])).rows[0];
      if (!tenant) {
        verifyPassword(body.password, DUMMY_HASH);
        noteLoginFailure(key);
        throw unauthorized(`รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง`);
      }
      return k.db.tx(tenant.id, async (c) => {
        const u = (await c.query('select * from users where email = $1 and active', [body.email])).rows[0];
        const ok = verifyPassword(body.password, u?.password_hash ?? DUMMY_HASH) && !!u;
        if (!ok) {
          noteLoginFailure(key);
          throw unauthorized(`รหัสบริษัท อีเมล หรือรหัสผ่านไม่ถูกต้อง`);
        }
        loginFailures.delete(key);
        const perms = await permissionsOf(c, u.id);
        // signed at or after the user's revocation cutoff, so a login in the same second as a logout is not refused (SEC-07)
        const token = signToken(secret, { tenantId: tenant.id, userId: u.id, perms, userName: u.name }, ttl, { iat: await cutoffOf(c, u.id) });
        return { token, expiresIn: ttl, tenant, user: { id: u.id, email: u.email, name: u.name }, permissions: perms };
      });
    });

    app.get('/me', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const u = await one(c, `select ${publicUser} from users where id = $1`, [a.userId], 'User');
        return { ...u, tenantId: a.tenantId, permissions: await permissionsOf(c, a.userId) };
      });
    });

    /** Log out everywhere: every token of the signed-in user issued up to now stops working in every module (SEC-07). */
    app.post('/logout', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const before = await revokeTokens(k, c, a.userId, 'logout');
        return { ok: true, revokedBefore: before, message: 'ออกจากระบบทุกอุปกรณ์แล้ว' };
      });
    });

    /**
     * Change own password: the current one must be right (wrong → 400 on `currentPassword`, counted like a wrong login), then every
     * older token is revoked and a fresh token is returned (body `token` + header `x-erp-session-token`, which the web app picks up).
     */
    app.post('/me/password', async (req, reply) => {
      const a = auth(req);
      const b = parse(PasswordChangeInput, req.body);
      const key = `me|${a.tenantId}|${a.userId}`;
      if (recentFailures(key).length >= LOGIN_MAX_FAILURES) {
        throw new HttpError(429, 'too_many_attempts', 'ใส่รหัสผ่านผิดหลายครั้งเกินไป กรุณารอ 15 นาทีแล้วลองใหม่');
      }
      const out = await k.db.tx(a.tenantId, async (c) => {
        const u = (await c.query('select id, name, password_hash from users where id = $1 and active', [a.userId])).rows[0];
        if (!u) throw unauthorized('บัญชีนี้ถูกปิดใช้งาน');
        if (!verifyPassword(b.currentPassword, u.password_hash)) {
          noteLoginFailure(key);
          throw badRequest('รหัสผ่านปัจจุบันไม่ถูกต้อง', { fieldErrors: { currentPassword: ['รหัสผ่านปัจจุบันไม่ถูกต้อง'] }, formErrors: [] });
        }
        if (b.newPassword === b.currentPassword) {
          throw badRequest('รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม', { fieldErrors: { newPassword: ['รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม'] }, formErrors: [] });
        }
        await c.query('update users set password_hash = $2 where id = $1', [a.userId, hashPassword(b.newPassword)]);
        const before = await revokeTokens(k, c, a.userId, 'password_changed');
        const perms = await permissionsOf(c, a.userId);
        return { before, token: signToken(secret, { tenantId: a.tenantId, userId: a.userId, perms, userName: u.name }, ttl, { iat: before }) };
      });
      loginFailures.delete(key);
      reply.header('x-erp-session-token', out.token);
      return { ok: true, message: 'เปลี่ยนรหัสผ่านแล้ว อุปกรณ์อื่นที่เข้าสู่ระบบไว้จะต้องเข้าสู่ระบบใหม่', token: out.token, expiresIn: ttl, revokedBefore: out.before };
    });

    /** Seller details for letterheads and tax invoices. Any signed-in user may read them (they print documents). */
    app.get('/company', async (req) => {
      const a = auth(req);
      return k.db.tx(a.tenantId, async (c) => {
        const row = (await c.query(`select ${companyCols} from company_profiles`)).rows[0];
        if (row) return companyView(row);
        // not set up yet: the company name from provisioning, everything else empty
        const t = (await c.query<{ name: string }>('select name from tenants where id = $1', [a.tenantId])).rows[0];
        return {
          configured: false, legal_name: t?.name ?? '', name_en: null, branch_code: '00000', branch_label: null, branch_text: branchText('00000'),
          address: null, tax_id: null, tax_id_text: null, phone: null, email: null, website: null, logo: null, footer_note: null, signature_labels: [], updated_at: null,
        };
      });
    });

    app.put('/company', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.company.write');
      const b = parse(CompanyInput, req.body);
      return k.db.tx(a.tenantId, async (c) => {
        const row = (await c.query(
          `insert into company_profiles (legal_name, name_en, branch_code, branch_label, address, tax_id, phone, email, website, logo, footer_note, signature_labels, updated_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
           on conflict (tenant_id) do update set legal_name = excluded.legal_name, name_en = excluded.name_en, branch_code = excluded.branch_code,
             branch_label = excluded.branch_label, address = excluded.address, tax_id = excluded.tax_id, phone = excluded.phone, email = excluded.email,
             website = excluded.website, logo = excluded.logo, footer_note = excluded.footer_note, signature_labels = excluded.signature_labels,
             updated_by = excluded.updated_by, updated_at = now()
           returning ${companyCols}`,
          [b.legalName, b.nameEn ?? null, b.branchCode, b.branchLabel ?? null, b.address, b.taxId ?? null, b.phone ?? null, b.email ?? null,
            b.website ?? null, b.logo ?? null, b.footerNote ?? null, b.signatureLabels ?? [], a.userId],
        )).rows[0];
        return companyView(row);
      });
    });

    /**
     * People picker for every signed-in user (approver → delegate, contract technician, ticket assignee, asset custodian…):
     * active users' id, name and work e-mail only — no roles, no admin data. `/users` stays behind identity.user.read (bugs-0.4 ID-04).
     */
    app.get('/users/directory', async (req) => {
      const a = auth(req);
      const q = parse(z.object({ q: z.string().trim().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }), req.query);
      const like = q.q ? `%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%` : null;
      return k.db.tx(a.tenantId, async (c) => (await c.query(
        `select id, name, email from users where active and ($1::text is null or name ilike $1 or email ilike $1) order by name limit $2`, [like, q.limit])).rows);
    });

    app.get('/users', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      return k.db.tx(a.tenantId, async (c) =>
        (await c.query(`select ${publicUser.split(', ').map((f) => 'u.' + f).join(', ')},
          coalesce(array_agg(r.name order by r.name) filter (where r.id is not null), '{}') as roles
          from users u left join user_roles ur on ur.user_id = u.id left join roles r on r.id = ur.role_id
          group by u.id order by u.email`)).rows);
    });

    /** One user (detail screen): roles by name + id, and when their sessions were last revoked. */
    app.get('/users/:id', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const u = await one(c, `select ${publicUser} from users where id = $1`, [id], 'User');
        const roles = (await c.query<{ id: string; name: string }>(
          'select r.id, r.name from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = $1 order by r.name', [id])).rows;
        const rev = (await c.query('select before, reason, updated_at from _revoked_tokens where user_id = $1', [id])).rows[0];
        return {
          ...u, roles: roles.map((r) => r.name), roleIds: roles.map((r) => r.id), permissions: await permissionsOf(c, id),
          sessions_revoked_at: rev ? rev.updated_at : null, sessions_revoked_reason: rev ? REVOKE_REASON_TH[rev.reason as RevokeReason] ?? rev.reason : null,
        };
      });
    });

    app.post('/users', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const body = parse(UserInput, req.body);
      const user = await k.db.tx(a.tenantId, async (c) => {
        requireGrantable(a, await permissionsOfRoles(c, body.roleIds), 'กำหนดบทบาทไม่ได้');
        const u = (await c.query(`insert into users (email, name, password_hash) values ($1, $2, $3) returning ${publicUser}`, [body.email, body.name, hashPassword(body.password)])).rows[0];
        for (const roleId of body.roleIds) await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [u.id, roleId]);
        return u;
      });
      reply.code(201);
      return user;
    });

    app.put('/users/:id/roles', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      const { roleIds } = parse(z.object({ roleIds: z.array(s.uuid) }), req.body);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from users where id = $1', [id], 'User');
        requireGrantable(a, await permissionsOf(c, id), 'แก้บทบาทของผู้ใช้ที่มีสิทธิ์มากกว่าคุณไม่ได้');
        requireGrantable(a, await permissionsOfRoles(c, roleIds), 'กำหนดบทบาทไม่ได้');
        await c.query('delete from user_roles where user_id = $1', [id]);
        for (const roleId of roleIds) await c.query('insert into user_roles (user_id, role_id) values ($1, $2)', [id, roleId]);
        // old tokens still carry the old permissions: refuse them so the change applies now, not at the next login (SEC-07)
        await revokeTokens(k, c, id, 'roles_changed');
        return { userId: id, permissions: await permissionsOf(c, id), message: 'บันทึกบทบาทแล้ว ผู้ใช้ต้องเข้าสู่ระบบใหม่เพื่อใช้สิทธิ์ใหม่' };
      });
    });

    app.post('/users/:id/deactivate', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        await one(c, 'select id from users where id = $1', [id], 'User');
        requireGrantable(a, await permissionsOf(c, id), 'ปิดบัญชีผู้ใช้ที่มีสิทธิ์มากกว่าคุณไม่ได้');
        const u = await one(c, `update users set active = false where id = $1 returning ${publicUser}`, [id], 'User');
        await revokeTokens(k, c, id, 'user_disabled');
        return u;
      });
    });

    /** Admin "บังคับออกจากระบบ": every token of that user stops working now (they can log in again). */
    app.post('/users/:id/revoke-sessions', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.write');
      const { id } = parse(z.object({ id: s.uuid }), req.params);
      return k.db.tx(a.tenantId, async (c) => {
        const u = await one(c, `select ${publicUser} from users where id = $1`, [id], 'User');
        requireGrantable(a, await permissionsOf(c, id), 'บังคับออกจากระบบผู้ใช้ที่มีสิทธิ์มากกว่าคุณไม่ได้');
        const before = await revokeTokens(k, c, id, 'admin');
        return { ...u, revokedBefore: before, message: `บังคับให้ ${u.name} ออกจากระบบทุกอุปกรณ์แล้ว` };
      });
    });

    app.get('/roles', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      return k.db.tx(a.tenantId, async (c) => (await c.query('select * from roles order by name')).rows);
    });

    app.post('/roles', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.role.write');
      const body = parse(RoleInput, req.body);
      requireGrantable(a, body.permissions, 'สร้างบทบาทไม่ได้');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => (await c.query('insert into roles (name, permissions) values ($1, $2) returning *', [body.name, body.permissions])).rows[0]);
    });

    /* ----- role templates (suggested Thai roles; see role-templates.ts) ----- */

    /** Installed module ids: `modules` from the client (web has /api/_catalog), else an `x-erp-modules` header a gateway may add; undefined = unknown. */
    const installed = (req: { headers: Record<string, unknown> }, fromBody?: string[]): string[] | undefined => {
      if (fromBody?.length) return fromBody;
      const h = req.headers['x-erp-modules'];
      return typeof h === 'string' && h.trim() ? h.split(',').map((x) => x.trim()).filter(Boolean) : undefined;
    };
    const ModuleList = z.array(z.string().trim().regex(/^[a-z][a-z0-9-]*$/)).max(100);

    /** `?modules=a,b` limits each template's permissions to installed modules; `?q=` filters by name (lookup). */
    app.get('/role-templates', async (req) => {
      const a = auth(req);
      requirePerm(a, 'identity.user.read');
      const q = parse(z.object({ q: z.string().trim().optional(), modules: z.string().optional() }), req.query);
      const mods = installed(req, q.modules ? parse(ModuleList, q.modules.split(',')) : undefined);
      const needle = q.q?.toLowerCase();
      return ROLE_TEMPLATES
        .filter((tpl) => !needle || tpl.name.toLowerCase().includes(needle) || tpl.id.includes(needle))
        .map((tpl) => {
          const { permissions, skipped } = applyTemplate(tpl, mods);
          return { id: tpl.id, name: tpl.name, description: tpl.description, permissions, permission_count: permissions.length, skipped };
        });
    });

    /** Create a role from a template, keeping only the permissions of installed modules. Name defaults to the template's (409 if taken). */
    app.post('/roles/from-template', async (req, reply) => {
      const a = auth(req);
      requirePerm(a, 'identity.role.write');
      const ids = ROLE_TEMPLATES.map((tpl) => tpl.id) as [string, ...string[]];
      const body = parse(z.object({ template: z.enum(ids), name: s.name.optional(), modules: ModuleList.optional() }), req.body);
      const tpl = ROLE_TEMPLATES.find((x) => x.id === body.template)!;
      const { permissions, skipped } = applyTemplate(tpl, installed(req, body.modules));
      const name = body.name ?? tpl.name;
      requireGrantable(a, permissions, 'สร้างบทบาทไม่ได้');
      reply.code(201);
      return k.db.tx(a.tenantId, async (c) => {
        const role = (await c.query('insert into roles (name, permissions) values ($1, $2) returning *', [name, permissions])).rows[0];
        return { ...role, template: tpl.id, skipped, message: `สร้างบทบาท "${name}" แล้ว (${permissions.length} สิทธิ์)` };
      });
    });
  },
};
